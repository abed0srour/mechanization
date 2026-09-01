import { z } from 'zod';

/**
 * Municipal expenses — money the municipality spends, the mirror of
 * `fee.schema.ts`, which is money it receives.
 */

/**
 * Narrower than `CURRENCY_CODES` in `fee.schema.ts` (which also offers EUR
 * for citizen billing): this municipality only ever pays out in LBP or USD.
 */
export const EXPENSE_CURRENCY = ['LBP', 'USD'] as const;
export const expenseCurrencySchema = z.enum(EXPENSE_CURRENCY, {
  errorMap: () => ({ message: 'العملة مطلوبة' }),
});
export type ExpenseCurrency = (typeof EXPENSE_CURRENCY)[number];

export const EXPENSE_CATEGORY = [
  'SALARIES',
  'UTILITIES',
  'MAINTENANCE',
  'INFRASTRUCTURE',
  'FUEL',
  'EQUIPMENT',
  'ADMINISTRATIVE',
  'OTHER',
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORY, {
  errorMap: () => ({ message: 'فئة المصروف مطلوبة' }),
});
export type ExpenseCategory = (typeof EXPENSE_CATEGORY)[number];

/**
 * How the municipality actually pays out, in practice: cash from the office,
 * or a Whish transfer. A separate enum from `paymentMethodSchema` in
 * `fee.schema.ts` because that one also carries COLLECTOR, which describes a
 * محصّل's round — meaningless for money going out to a vendor or an employee.
 */
export const EXPENSE_PAYMENT_METHOD = ['CASH', 'WHISH_MONEY'] as const;
export const expensePaymentMethodSchema = z.enum(EXPENSE_PAYMENT_METHOD, {
  errorMap: () => ({ message: 'طريقة الدفع مطلوبة' }),
});
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHOD)[number];

/**
 * Unlike `lbpAmount` in `fee.schema.ts`, this allows cents: an expense can be
 * invoiced in USD by a contractor, where whole-pound rounding would be wrong.
 */
const expenseAmount = z.coerce
  .number({
    required_error: 'المبلغ مطلوب',
    invalid_type_error: 'المبلغ يجب أن يكون رقماً',
  })
  .positive('المبلغ يجب أن يكون أكبر من صفر')
  .max(1_000_000_000, 'المبلغ كبير جداً — يرجى المراجعة');

export const createExpenseSchema = z.object({
  category: expenseCategorySchema,
  description: z
    .string({ required_error: 'وصف المصروف مطلوب' })
    .trim()
    .min(3, 'الوصف قصير جداً')
    .max(300, 'الوصف طويل جداً'),
  amount: expenseAmount,
  currency: expenseCurrencySchema.default('LBP'),
  /** ISO date string; defaults to today when omitted. */
  expenseDate: z.string().min(1).optional(),
  payee: z.string().trim().max(120, 'اسم المستفيد طويل جداً').optional().or(z.literal('')),
  paymentMethod: expensePaymentMethodSchema.default('CASH'),
  reference: z.string().trim().max(80, 'المرجع طويل جداً').optional().or(z.literal('')),
  notes: z.string().trim().max(500, 'الملاحظات طويلة جداً').optional().or(z.literal('')),
});

export type CreateExpense = z.infer<typeof createExpenseSchema>;

/** Every field optional: a clerk correcting one field should not have to resend the rest. */
export const updateExpenseSchema = createExpenseSchema.partial();

export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
