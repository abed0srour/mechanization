import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WHISH_GATEWAY } from '../../../domain/interfaces/whish-gateway.interface';
import type {
  WhishCallback,
  WhishGateway,
} from '../../../domain/interfaces/whish-gateway.interface';
import type {
  CreateFeeNotice,
  DeclarePayment,
  PaymentMethod,
  SystemSettingsInput,
} from '@mechanization/shared-schemas';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { withConnectionRetry } from '../../../infrastructure/prisma/with-connection-retry';
import { ConflictError, NotFoundError, ValidationError } from '../../common/exceptions';

/** Property categories that live on `PropertyEntry.propertyType`. */
const PROPERTY_TYPE_CATEGORIES = new Set(['BUILDING', 'HOUSE', 'LAND', 'TENT']);

/** Guards the period walk below against an unreachable target date. */
const MAX_PERIOD_STEPS = 600;

/**
 * Which billing period a date falls in, for a given recurrence.
 *
 * This string is the uniqueness key for an invoice, so its format is load
 * bearing: two dates in the same month must produce byte-identical values or
 * the same citizen gets billed twice for July.
 */
export function periodKeyFor(frequency: string, date: Date): string {
  const year = date.getUTCFullYear();
  switch (frequency) {
    case 'MONTHLY':
      return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'HALF_YEARLY':
      return `${year}-H${date.getUTCMonth() < 6 ? 1 : 2}`;
    case 'ANNUALLY':
      return String(year);
    default:
      // A one-off fee has exactly one period, forever.
      return 'ONCE';
  }
}

/** Advances a date by exactly one billing period. */
function addPeriod(date: Date, frequency: string): Date {
  const next = new Date(date);
  switch (frequency) {
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case 'HALF_YEARLY':
      next.setUTCMonth(next.getUTCMonth() + 6);
      break;
    case 'ANNUALLY':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    default:
      break;
  }
  return next;
}

/**
 * The due date this notice carries in the period containing `now`.
 *
 * Walked forward from the original rather than reconstructed from the month:
 * `setUTCMonth` clamps 31 January + 1 month to early March, so rebuilding the
 * date each period would drift. Stepping from the original keeps a fee due on
 * the 15th due on the 15th.
 */
function dueDateInCurrentPeriod(original: Date, frequency: string, now: Date): Date {
  const target = periodKeyFor(frequency, now);
  let due = new Date(original);

  for (let step = 0; step < MAX_PERIOD_STEPS; step++) {
    const key = periodKeyFor(frequency, due);
    if (key === target) return due;
    // Already past the current period — a notice dated in the future is not
    // billable yet, so hand back what it has.
    if (due > now) return due;
    due = addPeriod(due, frequency);
  }
  return due;
}

export interface PaymentSummary {
  id: string;
  title: string;
  amount: number;
  /** Received so far. Below `amount` on a part-settled invoice. */
  paidAmount: number;
  /** `amount - paidAmount`, floored at zero — what is still owed. */
  remaining: number;
  currency: string;
  dueDate: string;
  paymentStatus: string;
  paymentMethod: string | null;
  whishTransactionRef: string | null;
  paidAt: string | null;
  reviewNote: string | null;
  frequency: string | null;
}

/**
 * Fees, the invoices they generate, and the settings the portal quotes.
 *
 * The one piece of real logic here is `issue`: an administrator writes a rule
 * once ("500,000 LBP, monthly, every resident") and this fans it out into a
 * row per citizen. Everything downstream — the portal's balance, the overdue
 * badge, the clerk's verification queue — reads those rows, never the rule,
 * so a later edit to the rule cannot rewrite a debt someone already settled.
 */
@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly events: EventEmitter2,
    @Inject(WHISH_GATEWAY) private readonly whish: WhishGateway,
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  // ───────────────────────────  Settings  ───────────────────────────

  /**
   * The municipality's payment configuration.
   *
   * Returns nulls rather than creating a row when unset: the portal hides the
   * Whish option entirely without a number, and inventing a blank row here
   * would make "never configured" indistinguishable from "deliberately empty".
   */
  async getSettings() {
    const row = await withConnectionRetry(() =>
      this.db.systemSettings.findFirst({ where: { singleton: true } }),
    );

    return {
      whishMoneyNumber: row?.whishMoneyNumber ?? null,
      cashOfficeHours: row?.cashOfficeHours ?? null,
      cashOfficeAddress: row?.cashOfficeAddress ?? null,
      contactPhone: row?.contactPhone ?? null,
      whatsappNumber: row?.whatsappNumber ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async updateSettings(input: SystemSettingsInput, actor: { id: string; role: string }) {
    // Empty string means "clear it", which has to reach the database as NULL —
    // otherwise the portal would print an empty Whish number as if it were one.
    const blankToNull = (value: string | undefined) =>
      value === undefined ? undefined : value.trim() === '' ? null : value.trim();

    const data = {
      whishMoneyNumber: blankToNull(input.whishMoneyNumber),
      cashOfficeHours: blankToNull(input.cashOfficeHours),
      cashOfficeAddress: blankToNull(input.cashOfficeAddress),
      contactPhone: blankToNull(input.contactPhone),
      whatsappNumber: blankToNull(input.whatsappNumber),
      updatedById: actor.id,
    };

    await this.db.systemSettings.upsert({
      where: { singleton: true },
      create: { singleton: true, ...data },
      update: data,
    });

    this.events.emit('settings.changed', {
      tenantSlug: this.tenantContext.tenantSlug,
      actorId: actor.id,
      actorRole: actor.role,
      changed: Object.keys(data).filter((key) => key !== 'updatedById'),
    });

    return this.getSettings();
  }

  // ──────────────────────────  Fee notices  ──────────────────────────

  async listNotices() {
    const rows = await withConnectionRetry(() =>
      this.db.feeNotice.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          targetCitizen: { select: { firstName: true, lastName: true } },
          _count: { select: { payments: true } },
        },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      amount: Number(row.amount),
      currency: row.currency,
      frequency: row.frequency,
      targetType: row.targetType,
      targetCategory: row.targetCategory,
      targetCitizenName: row.targetCitizen
        ? `${row.targetCitizen.firstName} ${row.targetCitizen.lastName}`
        : null,
      dueDate: row.dueDate.toISOString(),
      instructions: row.instructions,
      /** How many citizens this notice actually billed. */
      issuedCount: row._count.payments,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Writes the rule and bills everyone it applies to, in one transaction.
   *
   * Not two steps: a notice that exists but billed nobody looks identical to
   * one that billed everybody, and a clerk would have no way to tell which
   * happened before re-running it and double-charging the municipality's
   * residents.
   */
  async issue(input: CreateFeeNotice, actor: { id: string; role: string }) {
    const citizenIds = await this.resolveTargets(input);

    if (citizenIds.length === 0) {
      throw new ConflictError(
        'لا يوجد مواطنون مطابقون لهذه الفئة — لن يتم إصدار أي إشعار',
      );
    }

    const dueDate = new Date(input.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      throw new ConflictError('تاريخ الاستحقاق غير صالح');
    }

    const result = await this.db.$transaction(async (tx) => {
      const notice = await tx.feeNotice.create({
        data: {
          title: input.title,
          amount: input.amount,
          frequency: input.frequency as never,
          targetType: input.targetType as never,
          targetCategory: input.targetCategory ?? null,
          targetCitizenId: input.targetCitizenId ?? null,
          dueDate,
          instructions: input.instructions ?? null,
          issuedById: actor.id,
        },
        select: { id: true },
      });

      const created = await tx.citizenPayment.createMany({
        data: citizenIds.map((citizenId) => ({
          citizenId,
          feeNoticeId: notice.id,
          title: input.title,
          amount: input.amount,
          dueDate,
          // The first period is the one the chosen due date falls in; the
          // recurring job takes over from the next one.
          periodKey: periodKeyFor(input.frequency, dueDate),
        })),
        // The unique (citizenId, feeNoticeId, periodKey) triple means a retried
        // request tops up missing rows instead of failing the whole batch.
        skipDuplicates: true,
      });

      return { noticeId: notice.id, issued: created.count };
    });

    this.logger.log(
      `Fee "${input.title}" issued to ${result.issued} citizen(s) in ${this.tenantContext.tenantSlug}`,
    );

    this.events.emit('fee.issued', {
      tenantSlug: this.tenantContext.tenantSlug,
      noticeId: result.noticeId,
      title: input.title,
      amount: input.amount,
      targetType: input.targetType,
      issuedCount: result.issued,
      actorId: actor.id,
      actorRole: actor.role,
    });

    return result;
  }

  /**
   * Re-issues every active recurring notice for the period we are now in.
   *
   * Runs against whichever tenant scope is active — the caller is responsible
   * for establishing one per municipality (see `RecurringBillingJob`).
   *
   * Safe to run repeatedly. The work is a `createMany ... skipDuplicates`
   * against a unique (citizen, notice, period) triple, so a second run in the
   * same month writes nothing; there is no "have I already billed?" flag to
   * get out of step with reality. That also means a municipality that adds a
   * resident mid-month gets them billed on the next run rather than never.
   */
  async runRecurringBilling(now = new Date()): Promise<{
    noticesConsidered: number;
    invoicesCreated: number;
  }> {
    const notices = await withConnectionRetry(() =>
      this.db.feeNotice.findMany({
        where: { isActive: true, frequency: { not: 'ONCE' } },
      }),
    );

    let invoicesCreated = 0;

    for (const notice of notices) {
      const periodKey = periodKeyFor(notice.frequency, now);

      // The notice's own first period. Anything earlier than the notice's
      // start would be back-billing someone for a fee that did not exist.
      if (periodKey === periodKeyFor(notice.frequency, notice.dueDate)) continue;
      if (notice.dueDate > now) continue;

      const dueDate = dueDateInCurrentPeriod(notice.dueDate, notice.frequency, now);

      // Targets are re-resolved every period rather than frozen at issue time:
      // someone who registered a shop last week should be in this month's
      // billing, and someone deactivated should drop out of it.
      const citizenIds = await this.resolveTargets({
        targetType: notice.targetType as never,
        targetCategory: notice.targetCategory ?? undefined,
        targetCitizenId: notice.targetCitizenId ?? undefined,
      } as never);

      if (citizenIds.length === 0) continue;

      const created = await this.db.citizenPayment.createMany({
        data: citizenIds.map((citizenId) => ({
          citizenId,
          feeNoticeId: notice.id,
          title: notice.title,
          amount: notice.amount,
          dueDate,
          periodKey,
        })),
        skipDuplicates: true,
      });

      if (created.count > 0) {
        this.logger.log(
          `Recurring: "${notice.title}" → ${created.count} invoice(s) for ${periodKey}`,
        );
        this.events.emit('fee.issued', {
          tenantSlug: this.tenantContext.tenantSlug,
          noticeId: notice.id,
          title: notice.title,
          amount: Number(notice.amount),
          targetType: notice.targetType,
          issuedCount: created.count,
          recurring: true,
          periodKey,
        });
      }

      invoicesCreated += created.count;
    }

    return { noticesConsidered: notices.length, invoicesCreated };
  }

  /** Stops or resumes a recurring notice without touching its past invoices. */
  async setNoticeActive(id: string, isActive: boolean) {
    const notice = await this.db.feeNotice.findUnique({ where: { id }, select: { id: true } });
    if (!notice) throw new NotFoundError('FeeNotice', id);

    await this.db.feeNotice.update({ where: { id }, data: { isActive } });
    return { isActive };
  }

  /**
   * Which citizens a notice applies to.
   *
   * Only active citizens, and for a category only those with a *registered*
   * property of that kind — billing someone for a shop they never registered
   * is the error this whole feature would be judged on.
   */
  private async resolveTargets(input: CreateFeeNotice): Promise<string[]> {
    if (input.targetType === 'INDIVIDUAL_CITIZEN') {
      const citizen = await this.db.user.findFirst({
        where: { id: input.targetCitizenId, kind: 'CITIZEN', isActive: true },
        select: { id: true },
      });
      if (!citizen) throw new NotFoundError('Citizen', input.targetCitizenId ?? '');
      return [citizen.id];
    }

    if (input.targetType === 'ALL_CITIZENS') {
      const rows = await this.db.user.findMany({
        where: { kind: 'CITIZEN', isActive: true },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    }

    // BUILDING_CATEGORY — the category names either a property type or a unit
    // type, and the two live at different depths of the registration tree.
    const category = input.targetCategory!;
    const propertyWhere = PROPERTY_TYPE_CATEGORIES.has(category)
      ? { propertyType: category as never }
      : { units: { some: { unitType: category as never } } };

    const rows = await this.db.user.findMany({
      where: {
        kind: 'CITIZEN',
        isActive: true,
        registrations: { some: { properties: { some: propertyWhere } } },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  // ────────────────────────────  Payments  ────────────────────────────

  /** One citizen's own bills, newest obligation first. */
  async listForCitizen(citizenId: string): Promise<PaymentSummary[]> {
    const rows = await withConnectionRetry(() =>
      this.db.citizenPayment.findMany({
        where: { citizenId },
        orderBy: [{ paymentStatus: 'asc' }, { dueDate: 'asc' }],
        include: { feeNotice: { select: { frequency: true } } },
      }),
    );

    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      amount: Number(row.amount),
      paidAmount: Number(row.paidAmount),
      remaining: Math.max(Number(row.amount) - Number(row.paidAmount), 0),
      currency: row.currency,
      dueDate: row.dueDate.toISOString(),
      // OVERDUE is derived on read rather than written by a nightly job: a
      // stored status would be wrong for every hour between the due date
      // passing and the job next running.
      paymentStatus:
        row.paymentStatus === 'UNPAID' && row.dueDate < now ? 'OVERDUE' : row.paymentStatus,
      paymentMethod: row.paymentMethod,
      whishTransactionRef: row.whishTransactionRef,
      paidAt: row.paidAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      frequency: row.feeNotice?.frequency ?? null,
    }));
  }

  /**
   * The citizen's claim that they have paid.
   *
   * Moves to PENDING_REVIEW, never to PAID. Nothing here is verifiable by this
   * system — the Whish reference is a string read off the citizen's own
   * receipt — so the money is only confirmed once a clerk has matched it
   * against the municipality's account.
   */
  async declare(input: {
    paymentId: string;
    citizenId: string;
    method: DeclarePayment['method'];
    whishTransactionRef?: string;
  }) {
    const payment = await this.db.citizenPayment.findFirst({
      where: { id: input.paymentId, citizenId: input.citizenId },
      select: { id: true, paymentStatus: true },
    });
    if (!payment) throw new NotFoundError('Payment', input.paymentId);

    if (payment.paymentStatus === 'PAID') {
      throw new ConflictError('هذه الدفعة مسدّدة بالفعل');
    }
    if (payment.paymentStatus === 'PENDING_REVIEW') {
      throw new ConflictError('هذه الدفعة قيد المراجعة بالفعل');
    }

    await this.db.citizenPayment.update({
      where: { id: payment.id },
      data: {
        paymentStatus: 'PENDING_REVIEW',
        paymentMethod: input.method as never,
        whishTransactionRef: input.whishTransactionRef ?? null,
        // Cleared so a previous rejection's note does not sit alongside a
        // fresh claim as though it applied to it.
        reviewNote: null,
      },
    });

    this.events.emit('payment.declared', {
      tenantSlug: this.tenantContext.tenantSlug,
      paymentId: payment.id,
      citizenId: input.citizenId,
      method: input.method,
    });

    return { paymentStatus: 'PENDING_REVIEW' as const };
  }

  /** The clerk's verification queue: everything claimed but not yet confirmed. */
  async listPendingReview() {
    const rows = await withConnectionRetry(() =>
      this.db.citizenPayment.findMany({
        where: { paymentStatus: 'PENDING_REVIEW' },
        orderBy: { updatedAt: 'asc' },
        include: {
          citizen: {
            select: { id: true, firstName: true, lastName: true, phone: true, referenceNumber: true },
          },
        },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      amount: Number(row.amount),
      paidAmount: Number(row.paidAmount),
      remaining: Math.max(Number(row.amount) - Number(row.paidAmount), 0),
      currency: row.currency,
      dueDate: row.dueDate.toISOString(),
      paymentMethod: row.paymentMethod,
      whishTransactionRef: row.whishTransactionRef,
      citizenId: row.citizen.id,
      citizenName: `${row.citizen.firstName} ${row.citizen.lastName}`,
      citizenPhone: row.citizen.phone,
      citizenReference: row.citizen.referenceNumber,
    }));
  }

  /** A clerk confirming the money arrived, or sending the claim back. */
  async review(input: {
    paymentId: string;
    confirmed: boolean;
    note?: string;
    actor: { id: string; role: string };
  }) {
    const payment = await this.db.citizenPayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, paymentStatus: true, citizenId: true, amount: true },
    });
    if (!payment) throw new NotFoundError('Payment', input.paymentId);

    if (payment.paymentStatus !== 'PENDING_REVIEW') {
      throw new ConflictError('لا توجد دفعة معلّقة للمراجعة على هذا السجل');
    }

    await this.db.citizenPayment.update({
      where: { id: payment.id },
      data: input.confirmed
        ? {
            paymentStatus: 'PAID',
            // A citizen declares a transfer for the whole invoice — the portal
            // offers no way to declare part of one — so confirming it receives
            // the whole invoice.
            paidAmount: payment.amount,
            paidAt: new Date(),
            reviewedById: input.actor.id,
            reviewNote: input.note ?? null,
          }
        : {
            // Back to UNPAID, and the method/reference are cleared with it —
            // they described a transfer the municipality could not find.
            // `paidAmount` is deliberately untouched: a refused *transfer* says
            // nothing about cash already taken at the counter on the same row.
            paymentStatus: 'UNPAID',
            paymentMethod: null,
            whishTransactionRef: null,
            reviewedById: input.actor.id,
            reviewNote: input.note ?? null,
          },
    });

    this.events.emit('payment.reviewed', {
      tenantSlug: this.tenantContext.tenantSlug,
      paymentId: payment.id,
      citizenId: payment.citizenId,
      confirmed: input.confirmed,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { paymentStatus: input.confirmed ? ('PAID' as const) : ('UNPAID' as const) };
  }

  /**
   * Raises a one-off charge against a single citizen with no notice behind it.
   *
   * Kept separate from `issue` because it is a different act: no rule, no
   * recurrence, nothing to re-run next month.
   */
  async chargeIndividual(input: {
    citizenId: string;
    title: string;
    amount: number;
    dueDate: string;
    actor: { id: string; role: string };
  }) {
    const citizen = await this.db.user.findFirst({
      where: { id: input.citizenId, kind: 'CITIZEN' },
      select: { id: true },
    });
    if (!citizen) throw new NotFoundError('Citizen', input.citizenId);

    const created = await this.db.citizenPayment.create({
      data: {
        citizenId: citizen.id,
        title: input.title,
        amount: input.amount,
        dueDate: new Date(input.dueDate),
      },
      select: { id: true },
    });

    return { id: created.id };
  }

  /**
   * Every invoice in the municipality, newest obligation first.
   *
   * The admin counterpart to `listForCitizen`: same OVERDUE derivation, plus
   * who owes it — a clerk taking cash at the counter needs to find the row by
   * the name in front of them.
   */
  async listAllPayments(
    filter: {
      status?: string;
      search?: string;
      citizenId?: string;
      /** CASH | WHISH_MONEY. */
      method?: string;
      /**
       * Narrows the ledger to rows where money actually moved — or is claimed
       * to have. An invoice nobody has paid is an obligation, not a
       * transaction, and listing it on a transactions screen means most rows
       * have no method, no reference and no date.
       */
      transactionsOnly?: boolean;
    } = {},
  ) {
    const search = filter.search?.trim();

    const rows = await withConnectionRetry(() =>
      this.db.citizenPayment.findMany({
        where: {
          ...(filter.citizenId ? { citizenId: filter.citizenId } : {}),
          ...(filter.status ? { paymentStatus: filter.status as never } : {}),
          ...(filter.method ? { paymentMethod: filter.method as never } : {}),
          // PENDING_REVIEW belongs here despite `paidAmount` still being zero:
          // the citizen has declared a transfer, so there is a claimed
          // transaction with a method and a reference to show — it is simply
          // not confirmed yet.
          ...(filter.transactionsOnly
            ? { OR: [{ paidAmount: { gt: 0 } }, { paymentStatus: 'PENDING_REVIEW' as never }] }
            : {}),
          ...(search
            ? {
                citizen: {
                  OR: [
                    { firstName: { contains: search, mode: 'insensitive' as const } },
                    { lastName: { contains: search, mode: 'insensitive' as const } },
                    { referenceNumber: { contains: search, mode: 'insensitive' as const } },
                    { phone: { contains: search } },
                  ],
                },
              }
            : {}),
        },
        /**
         * A transactions view is a chronology, so it is ordered by when the
         * money moved — newest first — rather than by what is most overdue.
         * `paidAt` sorts nulls last so a part-payment (which never gets one,
         * see below) falls to `updatedAt` instead of to the top.
         */
        orderBy: filter.transactionsOnly
          ? [{ paidAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }]
          : [{ paymentStatus: 'asc' }, { dueDate: 'asc' }],
        // A single citizen's full history must never be truncated by the
        // municipality-wide page size — the drill-down is where a clerk
        // reconciles arrears one by one.
        take: filter.citizenId ? 500 : 200,
        include: {
          citizen: {
            select: { id: true, firstName: true, lastName: true, phone: true, referenceNumber: true },
          },
          feeNotice: { select: { frequency: true } },
        },
      }),
    );

    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      amount: Number(row.amount),
      paidAmount: Number(row.paidAmount),
      remaining: Math.max(Number(row.amount) - Number(row.paidAmount), 0),
      currency: row.currency,
      dueDate: row.dueDate.toISOString(),
      paymentStatus:
        row.paymentStatus === 'UNPAID' && row.dueDate < now ? 'OVERDUE' : row.paymentStatus,
      paymentMethod: row.paymentMethod,
      whishTransactionRef: row.whishTransactionRef,
      paidAt: row.paidAt?.toISOString() ?? null,
      /**
       * Exposed because `paidAt` is not the whole answer.
       *
       * `settle` stamps `paidAt` only when the invoice is *fully* covered
       * (`paidAt: fullySettled ? new Date() : null`), so a part-payment — real
       * money, taken at the counter — leaves it null. A transactions screen
       * with a blank date on every partial is worse than useless, so the row
       * carries its last-write time too and the UI falls back to it, labelled
       * as approximate rather than passed off as the moment of payment.
       */
      updatedAt: row.updatedAt.toISOString(),
      frequency: row.feeNotice?.frequency ?? null,
      citizenId: row.citizen.id,
      citizenName: `${row.citizen.firstName} ${row.citizen.lastName}`,
      citizenPhone: row.citizen.phone,
      citizenReference: row.citizen.referenceNumber,
    }));
  }

  /**
   * Starts an online Whish payment for one of the signed-in citizen's bills.
   *
   * Ownership is checked here rather than trusted from the route: the payment
   * id comes from the browser, and without this a citizen could open a checkout
   * against somebody else's invoice — which would let them *pay* it, but also
   * disclose its amount and title in the process.
   *
   * In sandbox the invoice moves to PENDING_REVIEW, which is precisely what the
   * existing manual declaration does and is the honest state: the citizen has
   * said they are paying, and nothing has confirmed it. It reaches PAID only
   * through `settleFromWhishCallback`, behind a verified signature.
   */
  async startWhishCheckout(input: {
    paymentId: string;
    citizenId: string;
    callbackUrl: string;
    returnUrl: string;
  }): Promise<{ redirectUrl: string; pending: boolean }> {
    const payment = await this.db.citizenPayment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        citizenId: true,
        amount: true,
        paidAmount: true,
        currency: true,
        paymentStatus: true,
        citizen: { select: { firstName: true, lastName: true } },
      },
    });

    if (!payment || payment.citizenId !== input.citizenId) {
      // Same error for "no such invoice" and "not yours", so the endpoint
      // cannot be used to discover which payment ids exist.
      throw new NotFoundError('Payment', input.paymentId);
    }
    if (payment.paymentStatus === 'PAID') {
      throw new ConflictError('هذه المطالبة مسدّدة بالفعل');
    }
    if (payment.paymentStatus === 'PENDING_REVIEW') {
      throw new ConflictError('هناك دفعة قيد التأكيد على هذه المطالبة');
    }

    const outstanding = Number(payment.amount) - Number(payment.paidAmount);
    if (outstanding <= 0) {
      throw new ConflictError('لا يوجد رصيد مستحق على هذه المطالبة');
    }

    const checkout = await this.whish.createCheckout({
      paymentId: payment.id,
      amount: outstanding,
      currency: payment.currency,
      citizenName: `${payment.citizen.firstName} ${payment.citizen.lastName}`,
      callbackUrl: input.callbackUrl,
      returnUrl: input.returnUrl,
    });

    await this.db.citizenPayment.update({
      where: { id: payment.id },
      data: {
        paymentStatus: 'PENDING_REVIEW',
        paymentMethod: 'WHISH_MONEY',
        // The provider's handle for this attempt. Also what the clerk sees in
        // the verification queue while a live callback is still in flight.
        whishTransactionRef: checkout.externalRef,
      },
    });

    return { redirectUrl: checkout.redirectUrl, pending: !this.whish.isLive };
  }

  /**
   * Verifies a raw callback body. Returns `null` unless the signature checks
   * out — the controller has no other way to obtain a payload, so an unsigned
   * body cannot reach `settleFromWhishCallback` by mistake.
   */
  parseWhishCallback(input: { rawBody: string; signature?: string }): WhishCallback | null {
    return this.whish.parseCallback(input);
  }

  /**
   * Applies a verified Whish callback.
   *
   * Idempotent by construction: it matches on `whishTransactionRef` and skips
   * anything already PAID, because a provider that does not get a 200 will
   * retry, and a retry must not take the money twice or stamp a second
   * `paidAt`. A failed callback returns the invoice to UNPAID and clears the
   * reference, so the citizen can start again rather than being stuck behind a
   * PENDING_REVIEW that will never resolve.
   */
  async settleFromWhishCallback(callback: WhishCallback): Promise<{ applied: boolean }> {
    const payment = await this.db.citizenPayment.findFirst({
      where: { whishTransactionRef: callback.externalRef },
      select: { id: true, amount: true, paymentStatus: true, citizenId: true },
    });

    if (!payment) {
      this.logger.warn(`Whish callback for unknown reference ${callback.externalRef}`);
      return { applied: false };
    }
    if (payment.paymentStatus === 'PAID') return { applied: false };

    if (!callback.succeeded) {
      await this.db.citizenPayment.update({
        where: { id: payment.id },
        data: { paymentStatus: 'UNPAID', paymentMethod: null, whishTransactionRef: null },
      });
      return { applied: true };
    }

    const total = Number(payment.amount);
    // The provider is the authority on what was taken, but it must not exceed
    // what was owed — a mismatch is a bug or a tampered payload, and either way
    // banking more than the invoice would silently create a credit this system
    // has no way to represent.
    const received = Math.min(callback.amount, total);

    await this.db.citizenPayment.update({
      where: { id: payment.id },
      data: {
        paidAmount: received,
        paymentStatus: received >= total - 0.5 ? 'PAID' : 'UNPAID',
        paymentMethod: 'WHISH_MONEY',
        whishTransactionRef: callback.transactionRef,
        paidAt: received >= total - 0.5 ? new Date() : null,
      },
    });

    this.events.emit('payment.reviewed', {
      tenantSlug: this.tenantContext.tenantSlug,
      paymentId: payment.id,
      citizenId: payment.citizenId,
      confirmed: true,
      actorId: null,
      actorRole: 'WHISH',
    });

    return { applied: true };
  }

  /**
   * A clerk recording money taken at the counter — in full, or in part.
   *
   * Goes straight to PAID with no PENDING_REVIEW in between, and that is the
   * point: the person confirming it is the person who took the notes. The
   * review step exists to verify a transfer nobody in the building witnessed —
   * applying it to cash in hand would ask a clerk to verify themselves.
   *
   * `amount` is optional and defaults to whatever is still outstanding, so the
   * common case (someone paying the lot) needs no figure typed. Anything less
   * is a partial: `paidAmount` moves, the row stays UNPAID, and the balance
   * carries. Anything *more* is refused rather than quietly recorded as
   * credit — this system has no notion of an overpayment to carry forward, so
   * accepting one would silently lose the difference.
   */
  async settleInPerson(input: {
    paymentId: string;
    amount?: number;
    // The shared enum's type rather than a hand-written union: this listed two
    // methods and had to be found by the compiler when a third was added.
    method: PaymentMethod;
    /** Required by the schema when `method` is WHISH_MONEY; ignored for cash. */
    whishTransactionRef?: string;
    note?: string;
    actor: { id: string; role: string };
  }) {
    const payment = await this.db.citizenPayment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        paymentStatus: true,
        citizenId: true,
        amount: true,
        paidAmount: true,
      },
    });
    if (!payment) throw new NotFoundError('Payment', input.paymentId);

    if (payment.paymentStatus === 'PAID') {
      throw new ConflictError('هذه الدفعة مسدّدة بالفعل');
    }

    const total = Number(payment.amount);
    const alreadyPaid = Number(payment.paidAmount);
    const outstanding = total - alreadyPaid;

    const received = input.amount ?? outstanding;

    if (!Number.isFinite(received) || received <= 0) {
      throw new ValidationError('المبلغ المستلم يجب أن يكون أكبر من صفر', {
        amount: String(input.amount ?? ''),
      });
    }
    // LBP is whole pounds in practice, so a half-pound tolerance is enough to
    // absorb float noise from the Decimal round-trip without ever letting a
    // real overpayment through.
    if (received > outstanding + 0.5) {
      throw new ConflictError(
        `المبلغ المستلم (${received.toLocaleString('en-US')}) أكبر من الرصيد المستحق (${outstanding.toLocaleString('en-US')})`,
      );
    }

    const paidAmount = alreadyPaid + received;
    const fullySettled = paidAmount >= total - 0.5;

    await this.db.citizenPayment.update({
      where: { id: payment.id },
      data: {
        paidAmount,
        // Only a fully covered invoice becomes PAID. A partial one stays
        // UNPAID on purpose: every "what is outstanding" query in this system
        // keys off that status, and a half-paid row marked PAID would drop out
        // of the arrears the municipality is chasing.
        paymentStatus: fullySettled ? 'PAID' : 'UNPAID',
        paymentMethod: input.method as never,
        /**
         * Cleared when the method is cash.
         *
         * A row can reach here twice — a citizen declares a transfer, it is
         * refused, and the money then arrives at the counter in notes. Leaving
         * the old reference behind would leave a cash payment carrying a Whish
         * number that describes a transfer the municipality never found, which
         * the transactions log would then print underneath a «نقداً» badge.
         */
        whishTransactionRef:
          input.method === 'WHISH_MONEY' ? (input.whishTransactionRef ?? null) : null,
        paidAt: fullySettled ? new Date() : null,
        reviewedById: input.actor.id,
        reviewNote: input.note ?? null,
      },
    });

    this.events.emit('payment.reviewed', {
      tenantSlug: this.tenantContext.tenantSlug,
      paymentId: payment.id,
      citizenId: payment.citizenId,
      confirmed: true,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return {
      paymentStatus: fullySettled ? ('PAID' as const) : ('UNPAID' as const),
      received,
      paidAmount,
      remaining: Math.max(total - paidAmount, 0),
    };
  }

  /** Headline numbers for the admin fee screen. */
  async summary() {
    const [unpaid, pending, collected, settledCount] = await Promise.all([
      this.db.citizenPayment.aggregate({
        where: { paymentStatus: 'UNPAID' },
        // Both sums, because a part-paid invoice owes its *balance*, not its
        // face value — charging the full amount again would double-count every
        // pound already taken at the counter.
        _sum: { amount: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.db.citizenPayment.count({ where: { paymentStatus: 'PENDING_REVIEW' } }),
      // Deliberately unfiltered: money received on a *partly* settled invoice
      // is still in the municipality's drawer, and a PAID-only sum would leave
      // it out of "collected" entirely.
      this.db.citizenPayment.aggregate({ _sum: { paidAmount: true } }),
      this.db.citizenPayment.count({ where: { paymentStatus: 'PAID' } }),
    ]);

    return {
      unpaidTotal:
        Number(unpaid._sum.amount ?? 0) - Number(unpaid._sum.paidAmount ?? 0),
      unpaidCount: unpaid._count._all,
      pendingReviewCount: pending,
      paidTotal: Number(collected._sum.paidAmount ?? 0),
      paidCount: settledCount,
    };
  }
}
