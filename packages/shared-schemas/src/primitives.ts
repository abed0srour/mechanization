import { z } from 'zod';

/** Converts Eastern Arabic / Arabic-Indic digits to ASCII standard digits. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

/**
 * The one definition of "a Lebanese mobile", shared by `lebanesePhone` below
 * and `contactPhone` further down so the two cannot drift into disagreeing
 * about which numbers normalise to +961.
 */
const LEBANESE_MOBILE = /^(\+961|00961|0)?(3|7[0-9]|8[1])\d{6}$/;

/** Lebanese mobile numbers: +961 3/70/71/76/78/79/81 XXXXXX, stored E.164. */
export const lebanesePhone = z
  .string({ required_error: 'رقم الهاتف مطلوب' })
  .trim()
  .transform((v) => normalizeDigits(v).replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .regex(LEBANESE_MOBILE, 'رقم الهاتف غير صالح'),
  )
  .transform((v) => {
    const digits = v.replace(/^(\+961|00961|0)/, '');
    return `+961${digits}`;
  });

/**
 * A phone the municipality can *reach*, which is not the same thing as a phone
 * someone can *log in with*.
 *
 * `lebanesePhone` above is the login identity: OTP goes to it, so it has to be
 * a Lebanese mobile and there is nothing to discuss. This one is a contact
 * detail — a landlord's number, a citizen's number abroad — and requiring
 * +961 of it was a hard blocker on two of the commonest cases in the register:
 *
 *  - The diaspora landlord. A TENANT property requires `landlordPhone`, and the
 *    owner of a village building very often lives in Germany or Australia. A
 *    fully cooperative tenant, with every other field in hand, could not be
 *    saved because their landlord's number began +49.
 *  - The citizen abroad, who owns property here, owes fees here, and is exactly
 *    who the municipality most wants on file.
 *
 * A Lebanese number normalises through the identical path as before — same
 * regex, same `+961` output — so every number already stored, and every lookup
 * against one, is byte-for-byte unchanged. Anything else must be written in
 * full international form, which is the only shape that is unambiguous once
 * the country is no longer assumed.
 *
 * Note this does NOT make OTP work for a foreign number; delivery is open
 * decision #2 and unchanged. A citizen abroad is reached through their رقم
 * مرجعي or a proxy, and the field flow records them as `ABROAD` rather than
 * pretending a code was sent.
 */
export const contactPhone = z
  .string({ required_error: 'رقم الهاتف مطلوب' })
  .trim()
  .transform((v) => normalizeDigits(v).replace(/[\s-()]/g, ''))
  .superRefine((v, ctx) => {
    if (LEBANESE_MOBILE.test(v)) return;
    if (/^(\+|00)[1-9]\d{6,14}$/.test(v)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'رقم الهاتف غير صالح — لرقم أجنبي أدخله بصيغة دولية كاملة مثل ‎+49...',
    });
  })
  .transform((v) => {
    if (LEBANESE_MOBILE.test(v)) return `+961${v.replace(/^(\+961|00961|0)/, '')}`;
    return `+${v.replace(/^(\+|00)/, '')}`;
  });

/** True when a stored contact number is not a Lebanese one — i.e. unreachable by OTP. */
export function isForeignNumber(phone: string): boolean {
  return phone.startsWith('+') && !phone.startsWith('+961');
}

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
