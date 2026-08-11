import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
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
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { APP_CONFIG } from '../config/app.config';
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
  private readonly logger = new Logger(FeesController.name);

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

  /**
   * Every invoice, filterable by status, method and by who owes it.
   *
   * `transactionsOnly` flips this from the fees ledger's question ("what is
   * owed") to سجل العمليات' question ("what has been paid"), which also
   * re-orders it by when the money moved. One endpoint rather than two because
   * it is the same rows and the same projection — only the WHERE and ORDER BY
   * differ, and a second route would have drifted from this one the first time
   * a field was added.
   */
  @Roles('SUPER_ADMIN', 'AUDITOR')
  @Get('payments')
  async listPayments(
    @Query('status') status?: string,
    @Query('search') search?: string,
    /** Narrows the ledger to one citizen — the «عرض» drill-down. */
    @Query('citizenId') citizenId?: string,
    @Query('method') method?: string,
    @Query('transactionsOnly') transactionsOnly?: string,
  ) {
    return {
      items: await this.fees.listAllPayments({
        status,
        search,
        citizenId,
        method,
        transactionsOnly: transactionsOnly === 'true',
      }),
    };
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
      whishTransactionRef: body.whishTransactionRef,
      collectedById: body.collectedById,
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

  /**
   * Opens a Whish checkout for one of the signed-in citizen's own bills.
   *
   * The callback and return URLs are built here from configuration rather than
   * taken from the request: a client-supplied `returnUrl` is an open redirect,
   * and a client-supplied `callbackUrl` would let anyone point the provider's
   * confirmation at a server they control.
   */
  @Post('payments/mine/:id/whish/checkout')
  async whishCheckout(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentUser() user: SessionClaims,
  ) {
    if (user.kind !== 'CITIZEN') {
      throw new ForbiddenError('هذا المسار للمواطنين فقط');
    }

    const apiBase = APP_CONFIG.publicApiUrl;
    const portalBase = APP_CONFIG.publicPortalUrl;

    return this.fees.startWhishCheckout({
      paymentId: id,
      citizenId: user.sub,
      callbackUrl: `${apiBase}/t/${tenantSlug}/fees/whish/callback`,
      returnUrl: `${portalBase}/${tenantSlug}/ar/my-file?whish=done`,
    });
  }

  /**
   * Whish's server-to-server confirmation.
   *
   * `@Public()` because the provider holds no session — the signature over the
   * raw body is the authentication, and `parseCallback` returns nothing at all
   * unless it verifies. Always answers 200: a provider that gets an error
   * retries, and there is nothing to retry when the payload was never genuine.
   */
  @Public()
  @Post('whish/callback')
  async whishCallback(@Req() request: RawBodyRequest<Request>) {
    const raw = request.rawBody?.toString('utf8') ?? '';
    const signature = request.header('x-whish-signature');

    const callback = this.fees.parseWhishCallback({ rawBody: raw, signature });
    if (!callback) {
      this.logger.warn('Rejected an unverified Whish callback');
      return { received: true };
    }

    await this.fees.settleFromWhishCallback(callback);
    return { received: true };
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
