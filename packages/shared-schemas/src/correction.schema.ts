import { z } from 'zod';
import {
  genderSchema,
  identityDocTypeSchema,
  maritalStatusSchema,
  residentStatusSchema,
} from './enums';
import {
  arabicOrLatinName,
  civilRecordNumber,
  documentNumber,
  lebanesePhone,
  uuid,
} from './primitives';
import type { RejectableField } from './registration.schema';

/**
 * Correcting a refused submission, field by field.
 *
 * The citizen re-answers only what the reviewer flagged — the rest of the
 * claim is untouched, and the server refuses any value for a field that was
 * not flagged. That refusal is the point: without it, "correct your address"
 * would be an open door to rewriting the identity document number on an
 * already-reviewed submission.
 */

/**
 * The flags a citizen can fix from the correction form.
 *
 * Deliberately a subset of `REJECTABLE_FIELDS`. The rest are still legitimate
 * things to flag, they just cannot honestly be repaired by a text input:
 *
 *  - `documents.*` need a file upload, and re-uploading a proof is a new
 *    multipart submission rather than a field edit.
 *  - `property.units` is a repeated sub-form, not a value.
 *  - `property.propertyType` / `occupancyType` decide which *other* fields the
 *    wizard requires — changing one mid-correction would leave the submission
 *    internally inconsistent (a HOUSE carrying a landlord, a LAND with units).
 *  - `property.location` is derived from the municipality's cadastre, never
 *    typed by the citizen.
 *
 * Flagging one of those is still useful; the form says it needs a fresh
 * submission rather than pretending an input would fix it.
 */
export const CORRECTABLE_FIELDS = [
  'personal.name',
  'personal.gender',
  'personal.nationality',
  'personal.residentStatus',
  'personal.identityDocType',
  'personal.identityDocNumber',
  'personal.civilRecordNumber',
  'personal.residencyNumber',
  'contact.phone',
  'contact.whatsapp',
  'contact.maritalStatus',
  'contact.familySize',
  'property.neighborhood',
  'property.propertyNumber',
  'property.buildingName',
  'property.unitArea',
  'property.landlord',
] as const satisfies readonly RejectableField[];

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export function isCorrectable(field: string): field is CorrectableField {
  return (CORRECTABLE_FIELDS as readonly string[]).includes(field);
}

/** Which flags belong to a property card rather than to the person. */
export function isPropertyField(field: string): boolean {
  return field.startsWith('property.');
}

/**
 * Every value the form can send. All optional — a correction carries only the
 * fields that were flagged, and the server discards anything else.
 */
export const correctionSchema = z.object({
  personal: z
    .object({
      firstName: arabicOrLatinName,
      middleName: arabicOrLatinName.or(z.literal('')),
      lastName: arabicOrLatinName,
      gender: genderSchema,
      nationality: z.string().trim().min(2, 'الجنسية قصيرة جداً').max(60),
      residentStatus: residentStatusSchema,
      identityDocType: identityDocTypeSchema,
      identityDocNumber: documentNumber,
      civilRecordNumber,
      residencyNumber: documentNumber,
    })
    .partial()
    .optional(),
  contact: z
    .object({
      phone: lebanesePhone,
      whatsapp: lebanesePhone,
      maritalStatus: maritalStatusSchema,
      familySize: z.coerce
        .number()
        .int('عدد أفراد الأسرة يجب أن يكون رقماً صحيحاً')
        .min(1, 'يجب أن يكون فرداً واحداً على الأقل')
        .max(50, 'العدد كبير جداً — يرجى مراجعة البلدية'),
    })
    .partial()
    .optional(),
  /** Keyed by property id, because a claim may hold several cards. */
  properties: z
    .array(
      z
        .object({
          id: uuid,
          neighborhood: z.string().trim().min(1, 'الحي مطلوب').max(80),
          propertyNumber: z.string().trim().min(1, 'رقم العقار مطلوب').max(40),
          buildingName: z.string().trim().min(1, 'اسم المبنى مطلوب').max(120),
          unitArea: z.coerce
            .number()
            .positive('المساحة يجب أن تكون أكبر من صفر')
            .max(1_000_000),
          landlordName: arabicOrLatinName,
          landlordPhone: lebanesePhone,
        })
        .partial({
          neighborhood: true,
          propertyNumber: true,
          buildingName: true,
          unitArea: true,
          landlordName: true,
          landlordPhone: true,
        }),
    )
    .max(25)
    .optional(),
});

export type Correction = z.infer<typeof correctionSchema>;

/** What the correction form needs to render itself: the note, the flags, and
 *  the values as they currently stand. */
export const correctionContextSchema = z.object({
  registrationId: uuid,
  referenceNumber: z.string(),
  status: z.string(),
  rejectionReason: z.string().nullable(),
  rejectedFields: z.array(z.string()),
  personal: z.record(z.unknown()),
  contact: z.record(z.unknown()),
  properties: z.array(z.record(z.unknown())),
});

export type CorrectionContext = z.infer<typeof correctionContextSchema>;
