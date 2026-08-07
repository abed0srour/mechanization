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

export const PAYMENT_METHOD = ['CASH', 'WHISH_MONEY'] as const;
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
    method: paymentMethodSchema,
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

export const settlePaymentSchema = z.object({
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
