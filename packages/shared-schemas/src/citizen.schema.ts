import { z } from 'zod';
import {
  genderSchema,
  identityDocTypeSchema,
  residentStatusSchema,
} from './enums';
import {
  arabicOrLatinName,
  civilRecordNumber,
  documentNumber,
  lebanesePhone,
} from './primitives';

/**
 * Step 1 — البيانات الشخصية ومعلومات الإثبات
 *
 * Three conditional rules are enforced here rather than in the UI alone:
 *  1. civilRecordNumber (رقم السجل) is a Lebanese civil-registry number — it is
 *     required for a Lebanese person and meaningless for anyone else, so it is
 *     required only when `isLebanese` is true.
 *  2. identityDocNumber is required for a Lebanese person, whichever document
 *     type they picked. Its UI label varies by doc type (see
 *     `labels.ar.identityDocNumberLabel`).
 *  3. A non-Lebanese person is not asked for both a passport number and a
 *     رقم إقامة — someone who has given the municipality either one is
 *     identifiable, and requiring the other on top would block someone who
 *     simply does not have it yet (a passport pending renewal, a residency
 *     permit still in process). At least one of identityDocNumber /
 *     residencyNumber must be present; neither is required on its own.
 */
export const personalDetailsSchema = z
  .object({
    firstName: arabicOrLatinName,
    middleName: arabicOrLatinName.optional().or(z.literal('')),
    lastName: arabicOrLatinName,
    gender: genderSchema,
    identityDocType: identityDocTypeSchema,
    identityDocNumber: documentNumber.optional().or(z.literal('')),
    civilRecordNumber: civilRecordNumber.optional().or(z.literal('')),
    nationality: z.string().trim().min(2).max(60),
    isLebanese: z.boolean(),
    residencyNumber: documentNumber.optional().or(z.literal('')),
    residentStatus: residentStatusSchema,
  })
  .superRefine((data, ctx) => {
    if (data.isLebanese) {
      if (!data.identityDocNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['identityDocNumber'],
          message: 'رقم الوثيقة مطلوب',
        });
      }
      if (!data.civilRecordNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['civilRecordNumber'],
          message: 'رقم السجل مطلوب للبنانيين',
        });
      }
      return;
    }

    if (!data.identityDocNumber && !data.residencyNumber) {
      const message = 'أدخل رقم جواز السفر أو رقم الإقامة — يكفي إدخال واحد منهما';
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identityDocNumber'], message });
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['residencyNumber'], message });
    }
  });

export type PersonalDetails = z.infer<typeof personalDetailsSchema>;

/**
 * Step 2 — معلومات التواصل والأسرة
 *
 * `whatsappSameAsPhone` is a UI affordance that also carries meaning on the wire:
 * when true the backend copies `phone` rather than trusting a client-sent duplicate.
 */
export const contactDetailsSchema = z
  .object({
    phone: lebanesePhone,
    whatsappSameAsPhone: z.boolean().default(true),
    whatsapp: lebanesePhone.optional(),
    familySize: z.coerce.number().int().min(1, 'يجب أن يكون فرداً واحداً على الأقل').max(50),
  })
  .transform((data) => ({
    ...data,
    whatsapp: data.whatsappSameAsPhone ? data.phone : data.whatsapp,
  }))
  .superRefine((data, ctx) => {
    if (!data.whatsappSameAsPhone && !data.whatsapp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['whatsapp'],
        message: 'رقم الواتساب مطلوب',
      });
    }
  });

export type ContactDetails = z.infer<typeof contactDetailsSchema>;
