import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  chargeCitizenSchema,
  createFeeNoticeSchema,
  declarePaymentSchema,
  noticeActiveSchema,
  reviewPaymentSchema,
  settlePaymentSchema,
  systemSettingsSchema,
  type ChargeCitizen,
  type CreateFeeNotice,
  type DeclarePayment,
  type SettlePayment,
  type SystemSettingsInput,
} from '@mechanization/shared-schemas';
import { FeesService } from '../../application/features/fees/fees.service';
import { RecurringBillingJob } from '../../application/background-jobs/recurring-billing.job';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import { ForbiddenError } from '../../application/common/exceptions';
import type { SessionClaims } from '../../application/features/identity/identity.service';

/**
 * Fees, invoices, and the settings the citizen portal quotes.
 *
 * Two audiences share this controller because they share the data, but not the
 * routes: everything under `/payments/mine` is scoped to the signed-in citizen
 * by their own token, and everything else is staff-gated. The split is by path
 * rather than by guard so it is visible in the route table.
 */
@Controller('t/:tenantSlug/fees')
export class FeesController {
  constructor(
    private readonly fees: FeesService,
    private readonly recurring: RecurringBillingJob,
  ) {}

  // ───────────────────────────  Settings  ───────────────────────────

  /**
   * Readable by any signed-in user, including citizens: the portal has to
   * print the Whish number and the office hours on the payment instructions.
   * Nothing else lives on this record.
   */
  @Get('settings')
  async getSettings() {
    return this.fees.getSettings();
  }

  @Roles('SUPER_ADMIN')
  @Patch('settings')
  async updateSettings(
    @Body(new ZodValidationPipe(systemSettingsSchema)) body: SystemSettingsInput,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.fees.updateSettings(body, { id: user.sub, role: user.role ?? '' });
  }

  // ──────────────────────────  Fee notices  ──────────────────────────

  @Roles('SUPER_ADMIN', 'AUDITOR')
  @Get('notices')
  async listNotices() {
    return { items: await this.fees.listNotices() };
  }

  /**
   * Issuing a fee bills every matching citizen at once, so it is SUPER_ADMIN
   * only — an AUDITOR reads the municipality's books, it does not add to them.
   */
  @Roles('SUPER_ADMIN')
  @Post('notices')
  async issue(
    @Body(new ZodValidationPipe(createFeeNoticeSchema)) body: CreateFeeNotice,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.fees.issue(body, { id: user.sub, role: user.role ?? '' });
  }

  @Roles('SUPER_ADMIN', 'AUDITOR')
  @Get('summary')
  async summary() {
    return this.fees.summary();
  }

  /** Stops or resumes the recurring biller for one notice. */
  @Roles('SUPER_ADMIN')
  @Patch('notices/:id/active')
  async setNoticeActive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(noticeActiveSchema)) body: { isActive: boolean },
  ) {
    return this.fees.setNoticeActive(id, body.isActive);
  }

  /**
   * Runs the recurring biller now, instead of waiting for tonight's cron.
   *
   * Deliberately safe to press twice: the job is idempotent within a period,
   * so a clerk who clicks it again gets "0 new invoices" rather than a second
   * round of bills. Runs across every municipality, same as the schedule —
   * this is the platform-level job, not a per-tenant one.
   */
  @Roles('SUPER_ADMIN')
  @Post('recurring/run')
  async runRecurring() {
    return this.recurring.runForAllTenants();
  }

  // ──────────────────────  Staff payment ledger  ──────────────────────

  /** Every invoice, filterable by status and by who owes it. */
  @Roles('SUPER_ADMIN', 'AUDITOR')
  @Get('payments')
  async listPayments(
    @Query('status') status?: string,
    @Query('search') search?: string,
    /** Narrows the ledger to one citizen — the «عرض» drill-down. */
    @Query('citizenId') citizenId?: string,
  ) {
    return { items: await this.fees.listAllPayments({ status, search, citizenId }) };
  }

  /**
   * Raises a one-off charge against one citizen — the counterpart to issuing a
   * notice, for a debt that has no rule behind it.
   */
  @Roles('SUPER_ADMIN')
  @Post('payments')
  async charge(
    @Body(new ZodValidationPipe(chargeCitizenSchema)) body: ChargeCitizen,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.fees.chargeIndividual({
      ...body,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  /**
   * Records money taken at the counter — in full, or in part.
   *
   * An omitted `amount` settles the whole outstanding balance, which is both
   * the common case and the pre-partial-payment behaviour.
   */
  @Roles('SUPER_ADMIN')
  @Patch('payments/:id/settle')
  async settle(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlePaymentSchema)) body: SettlePayment,
    @CurrentUser() user: SessionClaims,
  ) {
    return this.fees.settleInPerson({
      paymentId: id,
      amount: body.amount,
      method: body.method,
      note: body.note,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  // ────────────────────  Staff verification queue  ────────────────────

  @Roles('SUPER_ADMIN', 'AUDITOR')
  @Get('payments/pending')
  async pending() {
    return { items: await this.fees.listPendingReview() };
  }

  /** Confirming money arrived is a financial act — SUPER_ADMIN only. */
  @Roles('SUPER_ADMIN')
  @Patch('payments/:id/review')
  async review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewPaymentSchema))
    body: { confirmed: boolean; note?: string },
    @CurrentUser() user: SessionClaims,
  ) {
    return this.fees.review({
      paymentId: id,
      confirmed: body.confirmed,
      note: body.note,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }

  // ─────────────────────────  Citizen portal  ─────────────────────────

  /**
   * The signed-in citizen's own bills.
   *
   * Scoped by `user.sub`, and refused outright for a staff token: a clerk
   * asking for "my payments" is a bug, and answering it with an empty list
   * would hide that rather than surface it.
   */
  @Get('payments/mine')
  async mine(@CurrentUser() user: SessionClaims) {
    if (user.kind !== 'CITIZEN') {
      throw new ForbiddenError('هذا المسار للمواطنين فقط');
    }
    return { items: await this.fees.listForCitizen(user.sub) };
  }

  /** The citizen declaring they have paid — moves to PENDING_REVIEW only. */
  @Post('payments/mine/:id/declare')
  async declare(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(declarePaymentSchema)) body: DeclarePayment,
    @CurrentUser() user: SessionClaims,
  ) {
    if (user.kind !== 'CITIZEN') {
      throw new ForbiddenError('هذا المسار للمواطنين فقط');
    }
    return this.fees.declare({
      paymentId: id,
      citizenId: user.sub,
      method: body.method,
      whishTransactionRef: body.whishTransactionRef,
    });
  }
}
