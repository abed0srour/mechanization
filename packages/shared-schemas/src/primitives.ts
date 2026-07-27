import { z } from 'zod';

/** Lebanese mobile numbers: +961 3/70/71/76/78/79/81 XXXXXX, stored E.164. */
export const lebanesePhone = z
  .string({ required_error: 'رقم الهاتف مطلوب' })
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^(\+961|00961|0)?(3|7[0-9]|8[1])\d{6}$/, 'رقم الهاتف غير صالح'),
  )
  .transform((v) => {
    const digits = v.replace(/^(\+961|00961|0)/, '');
    return `+961${digits}`;
  });

export const arabicOrLatinName = z
  .string({ required_error: 'الاسم مطلوب' })
  .trim()
  .min(2, 'الاسم قصير جداً')
  .max(60, 'الاسم طويل جداً')
  .regex(/^[\u0600-\u06FFa-zA-Z\s'-]+$/u, 'الاسم يحتوي على رموز غير مسموحة');

export const documentNumber = z
  .string({ required_error: 'رقم الوثيقة مطلوب' })
  .trim()
  .min(3, 'رقم الوثيقة قصير جداً')
  .max(40, 'رقم الوثيقة طويل جداً');

/**
 * رقم السجل — Lebanese civil register numbers are frequently 1–3 digits, so the
 * generic `documentNumber` minimum would wrongly reject valid records.
 */
export const civilRecordNumber = z
  .string({ required_error: 'رقم السجل مطلوب' })
  .trim()
  .min(1, 'رقم السجل مطلوب')
  .max(20, 'رقم السجل طويل جداً')
  .regex(/^[0-9\u0660-\u0669]+$/u, 'رقم السجل يجب أن يحتوي أرقاماً فقط');

/** Municipality slug used for tenant resolution in the URL path. */
export const tenantSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid municipality slug');

export const uuid = z.string().uuid();
