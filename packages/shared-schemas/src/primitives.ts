import { z } from 'zod';

/** Converts Eastern Arabic / Arabic-Indic digits to ASCII standard digits. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

/** Everything a person might type between the digits of a phone number. */
const PHONE_SEPARATORS = /[\s\-().]/g;

/**
 * A Lebanese mobile, national form: `3XXXXXX`, `7XXXXXXX`, `81XXXXXX`.
 *
 * Kept narrow because the one caller left is the OTP route, and an SMS sent to
 * a landline is a code that never arrives — a door that never opens, silently.
 * Refusing the number is the honest failure.
 */
const LEBANESE_MOBILE_NATIONAL = /^(?:3\d{6}|7\d{7}|81\d{6})$/;

/**
 * A Lebanese landline, national form: an area code (1, 4–9) and six digits.
 *
 * `3` is absent because it is the mobile prefix; the two never collide. `7`
 * appears in both and is separated by length — `07 740123` is a South Lebanon
 * landline at seven digits, `70 740123` a mobile at eight.
 */
const LEBANESE_LANDLINE_NATIONAL = /^[14-9]\d{6}$/;

/** E.164 as the ITU defines it: a country code that cannot start with zero. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * A Lebanese mobile — the number an SMS can actually reach.
 *
 * Was `lebanesePhone`, and was the only phone shape the whole register accepted.
 * It is now used exactly where a message has to be delivered; see `contactPhone`
 * for the field that merely has to be *recorded*, which is most of them.
 */
export const lebaneseMobile = z
  .string({ required_error: 'رقم الهاتف مطلوب' })
  .trim()
  .transform((v) => normalizeDigits(v).replace(PHONE_SEPARATORS, ''))
  .pipe(
    z
      .string()
      .regex(/^(?:\+961|00961|0)?(?:3\d{6}|7\d{7}|81\d{6})$/, 'أدخل رقم خلوي لبناني صالح'),
  )
  .transform((v) => `+961${v.replace(/^(\+961|00961|0)/, '')}`);

/**
 * Any number the municipality might need to write down, stored E.164.
 *
 * The register accepted Lebanese mobiles and nothing else, and that was not a
 * strict validation — it was a refusal to record what the household actually
 * gave the officer. Two groups fell through it, and both matter:
 *
 *  - **Landline-only households.** Disproportionately the elderly, who are
 *    disproportionately who a municipality needs to reach. An officer standing
 *    in the room could not enter `07-740123`.
 *  - **Landlords abroad.** A tenant's card *requires* the owner's number, and a
 *    great many Lebanese landlords are in Abidjan, Dubai or Michigan. The only
 *    way to file that card was to flag the field «غير مؤكَّد» — filling the
 *    review queue with records nobody will ever be able to resolve, because the
 *    number is not missing, it is simply not Lebanese.
 *
 * A bare or `0`-prefixed number is read as Lebanese, which is what everyone
 * types locally. Anything in international form is kept as given: this system
 * has no business asserting what a valid subscriber number looks like in a
 * country it knows nothing about, so beyond E.164's own shape it does not try.
 */
export const contactPhone = z
  .string({ required_error: 'رقم الهاتف مطلوب' })
  .trim()
  .transform((v) => normalizeDigits(v).replace(PHONE_SEPARATORS, '').replace(/^00/, '+'))
  .superRefine((value, ctx) => {
    const invalid = () =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'رقم الهاتف غير صالح' });

    if (value.startsWith('+')) {
      if (!E164.test(value)) return invalid();
      // A number written internationally but pointed at Lebanon still has to be
      // a real Lebanese number — otherwise `+961` becomes a way past the check.
      if (value.startsWith('+961')) {
        const national = value.slice(4);
        if (!LEBANESE_MOBILE_NATIONAL.test(national) && !LEBANESE_LANDLINE_NATIONAL.test(national)) {
          return invalid();
        }
      }
      return;
    }

    const national = value.replace(/^0/, '');
    if (!LEBANESE_MOBILE_NATIONAL.test(national) && !LEBANESE_LANDLINE_NATIONAL.test(national)) {
      invalid();
    }
  })
  .transform((v) => (v.startsWith('+') ? v : `+961${v.replace(/^0/, '')}`));

/**
 * Kept as the old name so nothing that only ever meant "a Lebanese mobile"
 * has to be found and edited. New code should say which it means.
 */
export const lebanesePhone = lebaneseMobile;

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
