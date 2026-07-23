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
 * Two conditional rules are enforced here rather than in the UI alone:
 *  1. residencyNumber is required when the person is not Lebanese.
 *  2. identityDocNumber is always required, but its UI label varies by doc type
 *     (see `labels.ar.identityDocNumberLabel`).
 */
export const personalDetailsSchema = z
  .object({
    firstName: arabicOrLatinName,
    middleName: arabicOrLatinName.optional().or(z.literal('')),
    lastName: arabicOrLatinName,
    gender: genderSchema,
    identityDocType: identityDocTypeSchema,
    identityDocNumber: documentNumber,
    civilRecordNumber: civilRecordNumber,
    nationality: z.string().trim().min(2).max(60),
    isLebanese: z.boolean(),
    residencyNumber: documentNumber.optional().or(z.literal('')),
    residentStatus: residentStatusSchema,
  })
  .superRefine((data, ctx) => {
    if (!data.isLebanese && !data.residencyNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['residencyNumber'],
        message: 'رقم الإقامة مطلوب لغير اللبنانيين',
      });
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
