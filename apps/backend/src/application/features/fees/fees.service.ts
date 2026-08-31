import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/tenant-client';
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
import { ConflictError, NotFoundError } from '../../common/exceptions';
import { searchTokens } from '../../common/search-terms';
import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';
import { PaymentLedgerService } from './payment-ledger.service';

/** Property categories that live on `PropertyEntry.propertyType`. */
const PROPERTY_TYPE_CATEGORIES = new Set(['BUILDING', 'HOUSE', 'LAND', 'TENT']);

/**
 * Five minutes. Contact details and office hours change a few times a year,
 * and a write drops the entry outright, so the TTL only bounds how long a
 * change made *outside* this service could go unseen.
 */
/** A pasted invoice id, in any casing. Used to route a search to `id` equality. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SETTINGS_CACHE_TTL_SECONDS = 300;

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
    private readonly cache: RedisCacheService,
    private readonly ledger: PaymentLedgerService,
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  // ───────────────────────────  Settings  ───────────────────────────

  /** Namespaced per tenant so one municipality's entry cannot serve another. */
  private settingsCacheKey(includeLogo: boolean): string {
    return `settings:${this.tenantContext.tenantSlug}:${includeLogo ? 'full' : 'lite'}`;
  }

  async getSettings(includeLogo = false) {
    /*
     * Cached, because this is the most-read row in the schema.
     *
     * The fees screen, the payments screen, every citizen profile and the
     * citizen-facing pay dialog all read it on load, for a phone number and
     * some opening hours that change a few times a year. Five minutes rather
     * than the dashboard's sixty seconds for the same reason: nothing here is
     * time-sensitive, and `updateSettings` drops the entry anyway, so an edit
     * is visible immediately regardless of the TTL.
     *
     * Keyed on `includeLogo` so the cheap payload and the one carrying the
     * crest cannot be served for one another.
     */
    const key = this.settingsCacheKey(includeLogo);
    const cached = await this.cache.get<Awaited<ReturnType<FeesService['readSettings']>>>(key);
    if (cached) return cached;

    const settings = await this.readSettings(includeLogo);
    await this.cache.set(key, settings, SETTINGS_CACHE_TTL_SECONDS);
    return settings;
  }

  private async readSettings(includeLogo: boolean) {
    const row = await withConnectionRetry(() =>
      this.db.systemSettings.findFirst({ where: { singleton: true } }),
    );

    return {
      whishMoneyNumber: row?.whishMoneyNumber ?? null,
      cashOfficeHours: row?.cashOfficeHours ?? null,
      cashOfficeAddress: row?.cashOfficeAddress ?? null,
      contactPhone: row?.contactPhone ?? null,
      whatsappNumber: row?.whatsappNumber ?? null,

      nameAr: row?.nameAr ?? null,
      nameEn: row?.nameEn ?? null,
      contactEmail: row?.contactEmail ?? null,
      website: row?.website ?? null,
      governorate: row?.governorate ?? null,
      district: row?.district ?? null,
      town: row?.town ?? null,
      // `undefined` rather than null for a citizen: the key is absent, so a
      // client cannot mistake "not sent to you" for "no logo configured".
      logoDataUri: includeLogo ? (row?.logoDataUri ?? null) : undefined,

      // The defaults here match the column defaults, so a municipality whose
      // settings row predates this migration reads the same as one that has
      // simply never opened the finance section.
      defaultFeeFrequency: row?.defaultFeeFrequency ?? 'ANNUALLY',
      defaultDueDays: row?.defaultDueDays ?? 30,
      priceDisplay: row?.priceDisplay ?? 'compact',
      // Decimal → number at the boundary, for JSON. Anything computing a charge
      // must read the column, not this.
      defaultRatePercent: row ? Number(row.defaultRatePercent) : 0,
      baseCurrency: row?.baseCurrency ?? 'LBP',
      secondaryCurrency: row?.secondaryCurrency ?? null,
      exchangeRate: row?.exchangeRate == null ? null : Number(row.exchangeRate),
      exchangeRateUpdatedAt: row?.exchangeRateUpdatedAt?.toISOString() ?? null,

      numberingSequences: (row?.numberingSequences as SystemSettingsInput['numberingSequences']) ?? null,
      backupSchedule: (row?.backupSchedule as SystemSettingsInput['backupSchedule']) ?? null,

      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async updateSettings(input: SystemSettingsInput, actor: { id: string; role: string }) {
    // Empty string means "clear it", which has to reach the database as NULL —
    // otherwise the portal would print an empty Whish number as if it were one.
    // `undefined` means "not sent", which Prisma leaves alone; that difference
    // is what lets one section of the settings screen save without wiping the
    // fields owned by the five it did not render.
    const blankToNull = (value: string | undefined) =>
      value === undefined ? undefined : value.trim() === '' ? null : value.trim();

    /*
     * Stamped here, not by the client.
     *
     * The timestamp answers "how stale is this rate", and a browser's clock is
     * not evidence of when the server accepted a value — nor should a client be
     * able to claim a rate was refreshed today by sending a date. Only a rate
     * that actually changes moves it: re-saving the finance section with the
     * same number must not make a month-old rate look current.
     */
    const previous =
      input.exchangeRate === undefined
        ? null
        : await withConnectionRetry(() =>
            this.db.systemSettings.findFirst({
              where: { singleton: true },
              select: { exchangeRate: true },
            }),
          );
    const rateChanged =
      input.exchangeRate !== undefined &&
      (previous?.exchangeRate == null
        ? input.exchangeRate !== null
        : Number(previous.exchangeRate) !== input.exchangeRate);

    const data = {
      whishMoneyNumber: blankToNull(input.whishMoneyNumber),
      cashOfficeHours: blankToNull(input.cashOfficeHours),
      cashOfficeAddress: blankToNull(input.cashOfficeAddress),
      contactPhone: blankToNull(input.contactPhone),
      whatsappNumber: blankToNull(input.whatsappNumber),

      nameAr: blankToNull(input.nameAr),
      nameEn: blankToNull(input.nameEn),
      contactEmail: blankToNull(input.contactEmail),
      website: blankToNull(input.website),
      governorate: blankToNull(input.governorate),
      district: blankToNull(input.district),
      town: blankToNull(input.town),
      logoDataUri: blankToNull(input.logoDataUri),

      defaultFeeFrequency: input.defaultFeeFrequency,
      defaultDueDays: input.defaultDueDays,
      priceDisplay: input.priceDisplay,
      defaultRatePercent: input.defaultRatePercent,
      baseCurrency: input.baseCurrency,
      secondaryCurrency: input.secondaryCurrency,
      exchangeRate: input.exchangeRate,
      ...(rateChanged
        ? { exchangeRateUpdatedAt: input.exchangeRate === null ? null : new Date() }
        : {}),

      numberingSequences: input.numberingSequences,
      backupSchedule: input.backupSchedule,

      updatedById: actor.id,
    };

    await this.db.systemSettings.upsert({
      where: { singleton: true },
      create: { singleton: true, ...data },
      update: data,
    });

    /*
     * Dropped before the read below, not left to expire.
     *
     * Both variants go: a clerk who saves and is then shown the value they
     * replaced would reasonably conclude the save failed and do it again. Five
     * minutes of that is worse than no cache at all, which is why the write
     * path owns the invalidation rather than the TTL.
     */
    await this.cache.invalidatePrefix(`settings:${this.tenantContext.tenantSlug}:`);

    this.events.emit('settings.changed', {
      tenantSlug: this.tenantContext.tenantSlug,
      actorId: actor.id,
      actorRole: actor.role,
      // Only what was actually sent. Listing every column on every save would
      // make the audit trail claim a clerk edited the exchange rate whenever
      // they corrected a phone number.
      changed: Object.entries(data)
        .filter(([key, value]) => key !== 'updatedById' && value !== undefined)
        .map(([key]) => key),
    });

    return this.getSettings(true);
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

  /**
   * A clerk confirming the money arrived, or sending the claim back.
   *
   * Confirmation is a *ledger entry*, not a status flip. It used to set
   * `paidAmount = amount` outright, which quietly overwrote any counter cash
   * already recorded against the same invoice and left no record of what the
   * confirmation itself received.
   */
  async review(input: {
    paymentId: string;
    confirmed: boolean;
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
        paymentMethod: true,
        whishTransactionRef: true,
      },
    });
    if (!payment) throw new NotFoundError('Payment', input.paymentId);

    if (payment.paymentStatus !== 'PENDING_REVIEW') {
      throw new ConflictError('لا توجد دفعة معلّقة للمراجعة على هذا السجل');
    }

    if (!input.confirmed) {
      /**
       * Back to UNPAID, and the method and reference go with it — they
       * described a transfer the municipality could not find.
       *
       * Nothing is written to the ledger, and `paidAmount` is untouched: a
       * refused *claim* is not a movement of money, and it says nothing about
       * cash already taken at the counter on the same invoice. That history now
       * lives in its own rows, so refusing a claim can no longer disturb it.
       */
      await this.db.citizenPayment.update({
        where: { id: payment.id },
        data: {
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
        confirmed: false,
        actorId: input.actor.id,
        actorRole: input.actor.role,
      });

      return { paymentStatus: 'UNPAID' as const };
    }

    /**
     * The citizen declared a transfer for the whole *outstanding* balance —
     * the portal offers no way to declare part of one — so confirming it
     * receives exactly that, not the invoice's face value. On an invoice
     * already carrying counter cash those are different numbers, and using the
     * face value is what erased the cash.
     */
    const outstanding = Number(payment.amount) - Number(payment.paidAmount);
    if (outstanding <= 0) {
      throw new ConflictError('لا يوجد رصيد مستحق على هذه المطالبة');
    }

    const settled = await this.ledger.record({
      paymentId: payment.id,
      amount: outstanding,
      method: (payment.paymentMethod ?? 'WHISH_MONEY') as PaymentMethod,
      externalRef: payment.whishTransactionRef,
      recordedById: input.actor.id,
      note: input.note,
    });

    await this.db.citizenPayment.update({
      where: { id: payment.id },
      data: { reviewedById: input.actor.id, reviewNote: input.note ?? null },
    });

    this.events.emit('payment.reviewed', {
      tenantSlug: this.tenantContext.tenantSlug,
      paymentId: payment.id,
      citizenId: payment.citizenId,
      confirmed: true,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      receiptNumber: settled.receiptNumber,
    });

    return { paymentStatus: settled.paymentStatus };
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

  /** The include this app always joins onto a `CitizenPayment` for admin use — kept
   *  in one place so `getPaymentById` and `listAllPayments` read the identical shape. */
  private readonly ADMIN_PAYMENT_INCLUDE = {
    citizen: {
      select: { id: true, firstName: true, lastName: true, phone: true, referenceNumber: true },
    },
    collectedBy: { select: { firstName: true, lastName: true } },
    feeNotice: { select: { frequency: true } },
  } satisfies Prisma.CitizenPaymentInclude;

  /** One row, in the shape the admin ledger and the settle page both read. */
  private toAdminPaymentItem(
    row: Prisma.CitizenPaymentGetPayload<{ include: FeesService['ADMIN_PAYMENT_INCLUDE'] }>,
    now: Date,
  ) {
    return {
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
      /** Set only on a COLLECTOR payment — who is holding the money. */
      collectedByName: row.collectedBy
        ? `${row.collectedBy.firstName} ${row.collectedBy.lastName}`.trim()
        : null,
      frequency: row.feeNotice?.frequency ?? null,
      citizenId: row.citizen.id,
      citizenName: `${row.citizen.firstName} ${row.citizen.lastName}`,
      citizenPhone: row.citizen.phone,
      citizenReference: row.citizen.referenceNumber,
    };
  }

  /**
   * One invoice, loaded directly by id rather than found in an already-loaded
   * list.
   *
   * Exists for تسجيل دفعة as a full page rather than a dialog: a page can be
   * linked to, refreshed, or opened straight from a receipt or a citizen's
   * profile, none of which carry the row in memory the way opening a dialog
   * from a table does. Same shape as a row from `listAllPayments`, so the page
   * and the ledger table render the payment identically.
   */
  async getPaymentById(id: string) {
    const row = await withConnectionRetry(() =>
      this.db.citizenPayment.findUnique({
        where: { id },
        include: this.ADMIN_PAYMENT_INCLUDE,
      }),
    );
    if (!row) throw new NotFoundError('Payment', id);
    return this.toAdminPaymentItem(row, new Date());
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
      /** Page size. Capped server-side so a client cannot ask for everything. */
      limit?: number;
      offset?: number;
    } = {},
  ) {
    /*
      A pasted invoice id is a lookup, not a search.

      Handled as its own branch because `id` is a `uuid` column: it has no
      `LIKE`, so it cannot take part in the substring matching below, and a
      UUID folded into tokens would match nothing anyway. Whole-value equality
      is also the only sensible reading — nobody types a fragment of one.
    */
    const search = filter.search?.trim();
    const exactId = search && UUID.test(search) ? search.toLowerCase() : undefined;
    const tokens = exactId ? [] : searchTokens(search);

    /**
     * The page, and the ceiling on it.
     *
     * A single citizen's drill-down is exempt from the *default* but not from
     * the cap: their whole history has to be reconcilable in one view, while a
     * municipality-wide request for 50,000 invoices is a mistake whatever the
     * caller believes.
     */
    const take = Math.min(Math.max(filter.limit ?? (filter.citizenId ? 500 : 25), 1), 500);
    const skip = Math.max(filter.offset ?? 0, 0);

    const where = {
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
      /*
        Every word of the query, somewhere in the folded text of the invoice or
        its payer.

        What was here could not match a person's name at all. It ORed
        `firstName contains` against `middleName contains` against
        `lastName contains`, so «أحمد نصرالله» asked for a *single column*
        holding both words — and none does. Every two-word search on this
        screen and on إدارة الرسوم returned nothing, which is not a
        near-miss but the most ordinary way anyone looks anyone up.

        `searchText` is a generated column per side of the join (migration
        0018), folded to one alphabet; `searchTokens` folds the query the same
        way. AND across tokens, OR across the two sides: both words have to
        appear, either may appear on either side.

        The payment's `id` is compared whole rather than by substring. It is a
        `uuid` column, which has no `LIKE`, and nobody types a fragment of a
        v4 UUID — it is pasted from a link or a log, entire.
      */
      ...(exactId
        ? { id: exactId }
        : tokens.length
          ? {
              AND: tokens.map((token) => ({
                OR: [
                  { searchText: { contains: token } },
                  { citizen: { searchText: { contains: token } } },
                ],
              })),
            }
          : {}),
    };

    /**
     * The page and the count in one round trip.
     *
     * `$transaction` rather than two awaits so both read the same snapshot — a
     * payment settled between the two would otherwise give a total that
     * disagrees with the rows beside it, and the page counter would flicker
     * against a list that had not changed.
     */
    const [rows, total, collected, byMethod, awaiting] = await withConnectionRetry(() =>
      this.db.$transaction([
        this.db.citizenPayment.findMany({
          where,
          /**
           * A transactions view is a chronology, so it is ordered by when the
           * money moved — newest first — rather than by what is most overdue.
           * `paidAt` sorts nulls last so a part-payment (which never gets one,
           * see below) falls to `updatedAt` instead of to the top.
           *
           * `id` breaks every tie. Without it two rows sharing a timestamp can
           * come back in either order between queries, and a row seen at the
           * foot of page one reappears at the head of page two — the classic
           * unstable-sort duplicate that makes a paginated list untrustworthy.
           */
          orderBy: filter.transactionsOnly
            ? [{ paidAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'asc' }]
            : [{ paymentStatus: 'asc' }, { dueDate: 'asc' }, { id: 'asc' }],
          take,
          skip,
          include: this.ADMIN_PAYMENT_INCLUDE,
        }),
        this.db.citizenPayment.count({ where }),
        /**
         * Aggregates over the *whole filtered set*, not the page.
         *
         * The screen's summary tiles read "إجمالي المحصّل" and "نقداً / Whish /
         * محصّل". Once the rows became one page of many, computing those in the
         * browser would have quietly turned them into "…on this page" — a
         * total that shrinks when the clerk changes the page size, which is the
         * kind of wrong number nobody notices until it is quoted in a meeting.
         */
        this.db.citizenPayment.aggregate({
          where: { ...where, paidAmount: { gt: 0 } },
          _sum: { paidAmount: true },
        }),
        this.db.citizenPayment.groupBy({
          by: ['paymentMethod'],
          where: { ...where, paidAmount: { gt: 0 } },
          _count: { _all: true },
        }),
        this.db.citizenPayment.count({
          where: { ...where, paymentStatus: 'PENDING_REVIEW' },
        }),
      ]),
    );

    const now = new Date();
    const items = rows.map((row) => this.toAdminPaymentItem(row, now));

    const methodCount = (method: string) =>
      byMethod.find((group) => group.paymentMethod === method)?._count._all ?? 0;

    return {
      items,
      total,
      /** Across every row the filters match — never just the page. */
      totals: {
        collected: Number(collected._sum.paidAmount ?? 0),
        cash: methodCount('CASH'),
        whish: methodCount('WHISH_MONEY'),
        collector: methodCount('COLLECTOR'),
        awaiting,
      },
    };
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
      select: { id: true, amount: true, paidAmount: true, paymentStatus: true, citizenId: true },
    });

    if (!payment) {
      this.logger.warn(`Whish callback for unknown reference ${callback.externalRef}`);
      return { applied: false };
    }
    /**
     * Idempotent by construction: a provider that does not get a 200 retries,
     * and a retry must not bank the money twice or stamp a second `paidAt`.
     */
    if (payment.paymentStatus === 'PAID') return { applied: false };

    if (!callback.succeeded) {
      // No money moved, so nothing is written to the ledger. The invoice goes
      // back to UNPAID and releases the reference so the citizen can start
      // again rather than being stuck behind a PENDING_REVIEW that will never
      // resolve.
      await this.db.citizenPayment.update({
        where: { id: payment.id },
        data: { paymentStatus: 'UNPAID', paymentMethod: null, whishTransactionRef: null },
      });
      return { applied: true };
    }

    /**
     * The provider is the authority on what it took, but it must not exceed
     * what was still owed — a mismatch is a bug or a tampered payload, and
     * banking more than the balance would silently create a credit this system
     * has no way to represent.
     *
     * Capped against the *outstanding* balance rather than the invoice face
     * value, because `startWhishCheckout` quotes the outstanding figure to the
     * provider: on a part-settled invoice those two differ, and the face value
     * is the wrong ceiling.
     *
     * The ledger recomputes both under a row lock and refuses an overpayment
     * itself; this only keeps a legitimate callback from being rejected for
     * arithmetic the provider did correctly.
     */
    const outstanding = Number(payment.amount) - Number(payment.paidAmount);
    const received = Math.min(callback.amount, outstanding);

    if (received <= 0) return { applied: false };

    const settled = await this.ledger.record({
      paymentId: payment.id,
      amount: received,
      method: 'WHISH_MONEY',
      externalRef: callback.transactionRef,
      note: 'دفع إلكتروني عبر Whish',
    });

    this.events.emit('payment.reviewed', {
      tenantSlug: this.tenantContext.tenantSlug,
      paymentId: payment.id,
      citizenId: payment.citizenId,
      confirmed: true,
      actorId: null,
      actorRole: 'WHISH',
      receiptNumber: settled.receiptNumber,
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
    /** Required by the schema when `method` is COLLECTOR; ignored otherwise. */
    collectedById?: string;
    note?: string;
    actor: { id: string; role: string };
  }) {
    /**
     * The outstanding balance, read only to default `amount`.
     *
     * Deliberately *not* the figure the settlement is computed from: this read
     * is outside any lock, so it can be stale by the time the write happens.
     * `PaymentLedgerService.record` re-reads under `SELECT … FOR UPDATE` and
     * validates against that, which is what makes two clerks settling the same
     * invoice in the same second safe. This value only answers "how much did
     * they mean, when they typed nothing?".
     */
    const invoice = await this.db.citizenPayment.findUnique({
      where: { id: input.paymentId },
      select: { amount: true, paidAmount: true, citizenId: true },
    });
    if (!invoice) throw new NotFoundError('Payment', input.paymentId);

    const received =
      input.amount ?? Number(invoice.amount) - Number(invoice.paidAmount);

    const settled = await this.ledger.record({
      paymentId: input.paymentId,
      amount: received,
      method: input.method,
      /**
       * Carried on the transaction rather than only on the invoice. A row can
       * reach here twice — a citizen declares a transfer, it is refused, and
       * the money arrives at the counter in notes — and the ledger keeps both
       * movements with their own method and reference instead of the second
       * overwriting the first.
       */
      externalRef: input.method === 'WHISH_MONEY' ? (input.whishTransactionRef ?? null) : null,
      collectedById: input.method === 'COLLECTOR' ? (input.collectedById ?? null) : null,
      recordedById: input.actor.id,
      note: input.note,
    });

    this.events.emit('payment.reviewed', {
      tenantSlug: this.tenantContext.tenantSlug,
      paymentId: input.paymentId,
      citizenId: invoice.citizenId,
      confirmed: true,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return {
      paymentStatus: settled.paymentStatus,
      received: settled.received,
      paidAmount: settled.paidAmount,
      remaining: settled.remaining,
      /** The citizen's handle on this movement, and what a reprint looks up. */
      receiptNumber: settled.receiptNumber,
    };
  }

  /** Every movement of money against one invoice, oldest first. */
  async listTransactions(paymentId: string) {
    return this.ledger.listForPayment(paymentId);
  }

  /**
   * Reverses one recorded movement, as an opposing ledger row.
   *
   * The correction path a mutable `paidAmount` could not offer: a
   * mis-keyed figure used to be fixed by overwriting the total, which left no
   * trace that the first entry had ever existed.
   */
  async reverseTransaction(input: {
    transactionId: string;
    note?: string;
    actor: { id: string; role: string };
  }) {
    const reversed = await this.ledger.reverse({
      transactionId: input.transactionId,
      recordedById: input.actor.id,
      note: input.note,
    });

    this.events.emit('payment.reversed', {
      tenantSlug: this.tenantContext.tenantSlug,
      transactionId: input.transactionId,
      receiptNumber: reversed.receiptNumber,
      amount: reversed.received,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return reversed;
  }

  /** Headline numbers for the admin fee screen. */
  async summary() {
    const key = `fees:summary:${this.tenantContext.tenantSlug}`;
    const cached = await this.cache.get<{
      unpaidTotal: number;
      unpaidCount: number;
      pendingReviewCount: number;
      paidTotal: number;
      paidCount: number;
    }>(key);
    if (cached) return cached;

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

    const result = {
      unpaidTotal:
        Number(unpaid._sum.amount ?? 0) - Number(unpaid._sum.paidAmount ?? 0),
      unpaidCount: unpaid._count._all,
      pendingReviewCount: pending,
      paidTotal: Number(collected._sum.paidAmount ?? 0),
      paidCount: settledCount,
    };
    await this.cache.set(key, result, 30);
    return result;
  }
}
