import { z } from 'zod';
import { uuid } from './primitives';

/**
 * Fees, and the per-citizen invoices they produce.
 *
 * The money type is the thing to get right here. Amounts are Lebanese pounds,
 * where a routine municipal fee is six or seven digits — `500000` is an
 * ordinary garbage charge. They travel as **integers**: LBP has no minor unit
 * in practice, and a float would eventually render someone's bill as
 * 499999.99999.
 */

export const FEE_FREQUENCY = ['ONCE', 'MONTHLY', 'HALF_YEARLY', 'ANNUALLY'] as const;
export const feeFrequencySchema = z.enum(FEE_FREQUENCY, {
  errorMap: () => ({ message: 'دورية الرسم مطلوبة' }),
});
export type FeeFrequency = (typeof FEE_FREQUENCY)[number];

/**
 * The currencies a Lebanese municipality quotes in.
 *
 * Here rather than in the frontend so the settings form and the endpoint that
 * validates it cannot drift — a currency the form offers and the schema rejects
 * is a save that fails with a validation error naming a field the user chose
 * from a list we gave them.
 */
export const CURRENCY_CODES = ['LBP', 'USD', 'EUR'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** The documents this portal issues a reference number for. */
export const SEQUENCE_KEYS = [
  'invoice',
  'serviceOrder',
  'permit',
  'taxReceipt',
  'refund',
] as const;
export type SequenceKey = (typeof SEQUENCE_KEYS)[number];

/** One document type's reference format, as stored and as sent. */
export interface NumberingSequence {
  prefix: string;
  nextNumber: number;
  padding: number;
}

/** When automatic backups should run. Read by no scheduler yet. */
export interface BackupSchedule {
  frequency: 'off' | 'daily' | 'weekly' | 'monthly';
  timeOfDay: string;
  dayOfWeek: number;
  dayOfMonth: number;
  keepCopies: number;
}

export const FEE_TARGET_TYPE = [
  'ALL_CITIZENS',
  'BUILDING_CATEGORY',
  'INDIVIDUAL_CITIZEN',
] as const;
export const feeTargetTypeSchema = z.enum(FEE_TARGET_TYPE, {
  errorMap: () => ({ message: 'الفئة المستهدفة مطلوبة' }),
});
export type FeeTargetType = (typeof FEE_TARGET_TYPE)[number];

export const PAYMENT_STATUS = ['UNPAID', 'PENDING_REVIEW', 'PAID', 'OVERDUE'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUS);
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const PAYMENT_METHOD = ['CASH', 'WHISH_MONEY', 'COLLECTOR'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHOD);
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

/**
 * What `targetCategory` may hold when targeting a building category.
 *
 * Drawn from the property taxonomy the registry already uses rather than free
 * text: a fee aimed at "المحلات التجارية" has to resolve to rows the database
 * can actually find, and `PropertyType`/`UnitType` are what those rows carry.
 */
export const FEE_TARGET_CATEGORY = [
  'BUILDING',
  'HOUSE',
  'LAND',
  'TENT',
  'APARTMENT',
  'CLINIC',
  'SHOP',
] as const;
export const feeTargetCategorySchema = z.enum(FEE_TARGET_CATEGORY);
export type FeeTargetCategory = (typeof FEE_TARGET_CATEGORY)[number];

/** LBP, whole pounds. The ceiling is a typo guard, not a policy limit. */
const lbpAmount = z.coerce
  .number({
    required_error: 'المبلغ مطلوب',
    invalid_type_error: 'المبلغ يجب أن يكون رقماً',
  })
  .int('المبلغ يجب أن يكون رقماً صحيحاً بالليرة')
  .positive('المبلغ يجب أن يكون أكبر من صفر')
  .max(1_000_000_000, 'المبلغ كبير جداً — يرجى المراجعة');

/**
 * Issuing a fee. The three target types each require different companions,
 * which is what the refinement below enforces — an "individual" fee with no
 * citizen attached would fan out to nobody and look like a silent failure.
 */
export const createFeeNoticeSchema = z
  .object({
    title: z
      .string({ required_error: 'اسم الرسم مطلوب' })
      .trim()
      .min(3, 'اسم الرسم قصير جداً')
      .max(120, 'اسم الرسم طويل جداً'),
    amount: lbpAmount,
    frequency: feeFrequencySchema,
    targetType: feeTargetTypeSchema,
    targetCategory: feeTargetCategorySchema.optional(),
    targetCitizenId: uuid.optional(),
    dueDate: z
      .string({ required_error: 'تاريخ الاستحقاق مطلوب' })
      .min(1, 'تاريخ الاستحقاق مطلوب'),
    instructions: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.targetType === 'BUILDING_CATEGORY' && !data.targetCategory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCategory'],
        message: 'اختر فئة العقارات المستهدفة',
      });
    }
    if (data.targetType === 'INDIVIDUAL_CITIZEN' && !data.targetCitizenId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCitizenId'],
        message: 'اختر المواطن المستهدف',
      });
    }
  });

export type CreateFeeNotice = z.infer<typeof createFeeNoticeSchema>;

/** The municipality-wide settings a clerk edits without a deploy. */
export const systemSettingsSchema = z.object({
  /**
   * Lebanese mobile, same shape as everywhere else in the system — but stored
   * as typed rather than normalised to E.164, because this string is printed
   * for a citizen to copy into the Whish app by hand.
   */
  whishMoneyNumber: z
    .string()
    .trim()
    .max(30, 'الرقم طويل جداً')
    .optional()
    .or(z.literal('')),
  cashOfficeHours: z.string().trim().max(200).optional().or(z.literal('')),
  cashOfficeAddress: z.string().trim().max(300).optional().or(z.literal('')),

  /** The municipality's public number, printed on receipts. */
  contactPhone: z.string().trim().max(30, 'الرقم طويل جداً').optional().or(z.literal('')),

  /**
   * The office WhatsApp account.
   *
   * Stored as typed rather than normalised to E.164 for the same reason as
   * `whishMoneyNumber`: it is printed for a human to read and dial, and
   * rewriting `03 123456` into `+96170123456` makes it unrecognisable to the
   * person who gave it to you. The `wa.me` link builder normalises its own
   * copy at the point of use.
   */
  whatsappNumber: z.string().trim().max(30, 'الرقم طويل جداً').optional().or(z.literal('')),

  // ── Municipality profile ──────────────────────────────────────────────
  nameAr: z.string().trim().max(120, 'الاسم طويل جداً').optional().or(z.literal('')),
  nameEn: z.string().trim().max(120, 'الاسم طويل جداً').optional().or(z.literal('')),
  /**
   * Not `z.string().email()`. Clearing the field posts `''`, which a strict
   * email check rejects — so an administrator could set an address but never
   * remove one. The empty case is allowed through and normalised to NULL
   * server-side; a non-empty value still has to look like an address.
   */
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .email('البريد الإلكتروني غير صالح')
    .optional()
    .or(z.literal('')),
  website: z.string().trim().max(200).url('الرابط غير صالح').optional().or(z.literal('')),
  governorate: z.string().trim().max(120).optional().or(z.literal('')),
  district: z.string().trim().max(120).optional().or(z.literal('')),
  town: z.string().trim().max(120).optional().or(z.literal('')),

  /**
   * The crest as a data URI.
   *
   * The prefix is checked rather than assumed: this string is written into an
   * `<img src>`, and `javascript:` and `data:text/html` are both things a
   * browser will happily execute from there. Restricting the scheme to the
   * three raster/vector image types the upload control offers is what keeps a
   * settings field from becoming a stored-XSS vector for every staff member
   * who opens the page afterwards.
   *
   * 700 KB of base64 ≈ 512 KB of file, matching the client-side cap.
   */
  logoDataUri: z
    .string()
    .trim()
    .max(700_000, 'حجم الصورة كبير جداً')
    .regex(/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+=*$/, 'الصورة غير صالحة')
    .optional()
    .or(z.literal('')),

  // ── Finance defaults ──────────────────────────────────────────────────
  defaultFeeFrequency: feeFrequencySchema.optional(),
  defaultDueDays: z.number().int().min(0).max(365, 'المهلة يجب أن تكون بين 0 و365 يوماً').optional(),
  priceDisplay: z.enum(['compact', 'exact']).optional(),
  defaultRatePercent: z
    .number()
    .min(0, 'النسبة يجب أن تكون بين 0 و100')
    .max(100, 'النسبة يجب أن تكون بين 0 و100')
    .optional(),
  baseCurrency: z.enum(CURRENCY_CODES).optional(),
  /** `null` clears it — which is different from omitting it, i.e. leave as is. */
  secondaryCurrency: z.enum(CURRENCY_CODES).nullable().optional(),
  exchangeRate: z
    .number()
    .positive('سعر الصرف يجب أن يكون أكبر من صفر')
    .max(1_000_000_000)
    .nullable()
    .optional(),

  // ── Configuration held as documents ───────────────────────────────────
  /**
   * Validated per document type rather than accepted as free-form JSON: this
   * lands in a `jsonb` column, and a column that accepts any shape is one every
   * later reader has to defend itself against.
   */
  numberingSequences: z
    .record(
      z.enum(SEQUENCE_KEYS),
      z.object({
        prefix: z
          .string()
          .trim()
          .max(16)
          .regex(/^[A-Z0-9-]*$/, 'البادئة تقبل الحروف اللاتينية والأرقام والشرطات فقط'),
        nextNumber: z.number().int().min(1, 'الرقم التالي يجب أن يكون أكبر من صفر').max(1e12),
        padding: z.number().int().min(1).max(12, 'خانات التصفير يجب أن تكون بين 1 و12'),
      }),
    )
    .optional(),

  backupSchedule: z
    .object({
      frequency: z.enum(['off', 'daily', 'weekly', 'monthly']),
      /** `HH:mm`, 24-hour. */
      timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت غير صالح'),
      /** 0 = Sunday, matching `Date.getDay()`. */
      dayOfWeek: z.number().int().min(0).max(6),
      /**
       * Capped at 28, not 31: a rule that fires on the 31st silently skips five
       * months of the year, and a backup that does not run in February is the
       * kind of gap discovered only when it is needed.
       */
      dayOfMonth: z.number().int().min(1).max(28),
      keepCopies: z.number().int().min(1).max(365),
    })
    .optional(),
});

export type SystemSettingsInput = z.infer<typeof systemSettingsSchema>;

/**
 * A citizen declaring they have paid.
 *
 * This never marks a payment PAID — it moves it to PENDING_REVIEW. Nothing the
 * citizen submits can be verified by this system: the Whish reference is a
 * string they read off their own receipt, and only a clerk holding the
 * municipality's account statement can confirm the money arrived.
 */
export const declarePaymentSchema = z
  .object({
    /**
     * Narrower than `paymentMethodSchema` on purpose: COLLECTOR is a fact only
     * the municipality can assert. A citizen who hands notes to a محصّل has no
     * way to prove it and nothing to quote, so accepting the value here would
     * queue a claim no clerk could ever verify — the collector's own entry is
     * what records that money.
     */
    method: z.enum(['CASH', 'WHISH_MONEY'], { errorMap: () => ({ message: 'طريقة الدفع مطلوبة' }) }),
    whishTransactionRef: z
      .string()
      .trim()
      .min(4, 'رقم العملية قصير جداً')
      .max(60, 'رقم العملية طويل جداً')
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === 'WHISH_MONEY' && !data.whishTransactionRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['whishTransactionRef'],
        message: 'أدخل رقم عملية التحويل',
      });
    }
  });

export type DeclarePayment = z.infer<typeof declarePaymentSchema>;

/**
 * A one-off charge an administrator raises against a single citizen.
 *
 * Separate from `createFeeNoticeSchema` because it is a different act: no
 * rule, no recurrence, nothing to re-issue next month — just this person owes
 * this amount.
 */
export const chargeCitizenSchema = z.object({
  citizenId: uuid,
  title: z
    .string({ required_error: 'اسم الرسم مطلوب' })
    .trim()
    .min(3, 'اسم الرسم قصير جداً')
    .max(120),
  amount: lbpAmount,
  dueDate: z.string({ required_error: 'تاريخ الاستحقاق مطلوب' }).min(1),
});

export type ChargeCitizen = z.infer<typeof chargeCitizenSchema>;

/**
 * A clerk recording money handed over in person.
 *
 * Skips PENDING_REVIEW entirely — see `FeesService.settleInPerson`.
 */
export const noticeActiveSchema = z.object({ isActive: z.boolean() });

export const settlePaymentSchema = z
  .object({
    method: paymentMethodSchema.default('CASH'),
  /**
   * How much was actually handed over.
   *
   * Optional, and omitting it means "the whole outstanding balance" — the
   * common case at the counter, and the behaviour before partial payments
   * existed, so an older client keeps working unchanged. A value below the
   * balance is a partial; above it is refused server-side rather than banked
   * as credit, because nothing here can carry an overpayment forward.
   */
    amount: z.coerce
      .number({ invalid_type_error: 'المبلغ يجب أن يكون رقماً' })
      .positive('المبلغ يجب أن يكون أكبر من صفر')
      .max(1_000_000_000_000, 'المبلغ كبير جداً')
      .optional(),
    note: z.string().trim().max(500).optional(),
    /**
     * The transfer's own number, when the clerk is recording a Whish payment
     * rather than cash.
     *
     * Cash needs nothing of the sort — the money is in the drawer and the وصل
     * is the record. A transfer is only auditable through its reference, which
     * is why `declarePaymentSchema` already demands one from the citizen; the
     * rule is repeated here rather than relaxed, because a clerk banking a
     * transfer they cannot cite is the same gap seen from the other side.
     */
    whishTransactionRef: z.string().trim().max(80).optional(),
    /**
     * The محصّل who took the money, when the method is COLLECTOR.
     *
     * Required for that method and refused for the others, by the same logic
     * as the Whish reference above: each method has exactly one fact that makes
     * it auditable, and a collection nobody is named for is indistinguishable
     * from counter cash — which is the distinction COLLECTOR was added to draw.
     */
    collectedById: uuid.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === 'WHISH_MONEY' && !data.whishTransactionRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['whishTransactionRef'],
        message: 'أدخل رقم عملية التحويل',
      });
    }
    if (data.method === 'COLLECTOR' && !data.collectedById) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['collectedById'],
        message: 'اختر المحصّل الذي استلم المبلغ',
      });
    }
  });

export type SettlePayment = z.infer<typeof settlePaymentSchema>;

/** A clerk's verdict on a declared payment. */
export const reviewPaymentSchema = z
  .object({
    confirmed: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    // Sending a payment back to UNPAID without saying why leaves the citizen
    // with a bill they thought they had settled and no way to find out.
    if (!data.confirmed && !data.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'اذكر سبب رفض الدفعة',
      });
    }
  });

export type ReviewPayment = z.infer<typeof reviewPaymentSchema>;

/**
 * Citizen sign-in by رقم مرجعي.
 *
 * The phone is required alongside it, not optional. A reference number is
 * printed on a receipt and quoted at a counter — treating it as a lone
 * credential would make every citizen record readable by anyone who saw a
 * slip of paper. Two facts that must agree is the weakest defensible bar.
 */
export const referenceLoginSchema = z.object({
  referenceNumber: z
    .string({ required_error: 'الرقم المرجعي مطلوب' })
    .trim()
    .min(4, 'الرقم المرجعي غير صالح')
    .max(40)
    .transform((value) => value.toUpperCase()),
  phone: z.string({ required_error: 'رقم الهاتف مطلوب' }).trim().min(6, 'رقم الهاتف غير صالح'),
});

export type ReferenceLogin = z.infer<typeof referenceLoginSchema>;

/**
 * Citizen sign-in by رقم مرجعي **alone**, for the municipality's front door.
 *
 * A deliberate, documented relaxation of the rule above, made at the
 * municipality's request: the portal's landing page asks for one thing, the
 * number printed on the citizen's own paperwork, because the population it
 * serves does not reliably reach a second factor — the household phone is
 * shared, off, or out of credit, and an SMS code that never arrives is a door
 * that never opens.
 *
 * What makes it defensible rather than merely convenient:
 *
 *  - The suffix is six characters from a 32-symbol alphabet — 2³⁰, about 1.07
 *    billion — so guessing one at the rate limit below would take millennia.
 *    The reference is not a weak secret; it is a *disclosed* one.
 *  - The real exposure is therefore a reference someone **sees**: a receipt
 *    left on a counter, a number read aloud. That is a physical-custody risk
 *    the municipality accepts, not a cryptographic one.
 *  - The format is validated before any lookup, so a malformed guess costs a
 *    regex rather than a query.
 *
 * `referenceLoginSchema` is left exactly as it was. The payments portal keeps
 * asking for both, so this relaxation reaches only the route that opted into it.
 */
export const referenceOnlyLoginSchema = z.object({
  referenceNumber: z
    .string({ required_error: 'الرقم المرجعي مطلوب' })
    .trim()
    // Spaces and lowercase are what a citizen actually types off a slip; the
    // domain's `ReferenceNumber.parse` normalises the same way.
    .transform((value) => value.toUpperCase().replace(/\s/g, ''))
    .pipe(
      z
        .string()
        .regex(
          /^[A-Z]{3}-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
          'الرقم المرجعي غير صالح — مثال: BZR-2608-5HLQBM',
        ),
    ),
});

export type ReferenceOnlyLogin = z.infer<typeof referenceOnlyLoginSchema>;
