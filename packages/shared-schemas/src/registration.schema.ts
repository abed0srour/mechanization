import { z } from 'zod';
import { contactDetailsSchema, personalDetailsSchema } from './citizen.schema';
import { propertyEntriesSchema } from './property.schema';
import { documentTypeSchema, reportStatusSchema } from './enums';
import { uuid } from './primitives';

/**
 * The full citizen submission (Steps 1–6), sent as the JSON `payload` part of a
 * single multipart request alongside the raw files.
 */
export const submitRegistrationSchema = z
  .object({
    personal: personalDetailsSchema,
    contact: contactDetailsSchema,
    properties: propertyEntriesSchema,
    /**
     * Client-side descriptors that let the server match each uploaded file part to
     * the right property card. The file bytes themselves arrive as multipart parts.
     */
    documentSlots: z
      .array(
        z.object({
          field: z.string({ required_error: 'حقل المستند مطلوب' }).min(1, 'حقل المستند مطلوب'),
          type: documentTypeSchema,
          propertyIndex: z.number().int().min(0).optional(),
        }),
      )
      .default([]),
    declarationAccepted: z
      .literal(true, { errorMap: () => ({ message: 'يجب الإقرار بصحة المعلومات' }) }),
  })
  /**
   * خيمة is only available to a لاجئ. The wizard already hides the option, but
   * the rule spans two steps — صفة الإقامة in step 1 and نوع العقار in step 3 —
   * so it can only be checked here, where both are in hand. Hiding a control is
   * not enforcement.
   */
  .superRefine((data, ctx) => {
    if (data.personal.residentStatus === 'REFUGEE') return;

    data.properties.forEach((property, index) => {
      if (property.propertyType === 'TENT') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['properties', index, 'propertyType'],
          message: 'الخيمة متاحة لصفة الإقامة «لاجئ» فقط',
        });
      }
    });
  });

export type SubmitRegistration = z.infer<typeof submitRegistrationSchema>;

export const submitRegistrationResponseSchema = z.object({
  registrationId: uuid,
  referenceNumber: z.string(),
  status: reportStatusSchema,
  propertyCount: z.number().int(),
});

export type SubmitRegistrationResponse = z.infer<typeof submitRegistrationResponseSchema>;

/** Blur-check used by Step 3–4 while the citizen types رقم العقار. */
export const propertyNumberCheckSchema = z.object({
  propertyNumber: z.string().trim().min(1).max(40),
});

/**
 * Answers two separate questions about a رقم العقار, which the form reports
 * differently: `available` is "nobody has registered it yet", `inCadastre` is
 * "it is a real parcel in this municipality". A number can be free and still
 * wrong, and that is the common case — a typo.
 *
 * `inCadastre` is null for a municipality that has not imported its cadastre, so
 * the form knows to stay quiet rather than claim the number is invalid.
 */
export const propertyNumberCheckResponseSchema = z.object({
  propertyNumber: z.string(),
  available: z.boolean(),
  inCadastre: z.boolean().nullable(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      approximate: z.boolean(),
    })
    .nullable(),
  suggestions: z.array(z.string()).default([]),
});

export type PropertyNumberCheckResponse = z.infer<typeof propertyNumberCheckResponseSchema>;

/**
 * The fields a reviewer may flag as wrong, and their Arabic captions.
 *
 * One shared registry rather than a list hard-coded in the admin UI: the
 * reviewer picks from it, the applicant's view resolves the stored keys back
 * to captions with it, and the server validates against it. Three places that
 * must agree on the same vocabulary, so they read it from one place.
 *
 * Keys are dot-paths into the submission payload, matching
 * `submitRegistrationSchema` — which is what lets a future edit-mode form map
 * a flag straight onto the input that produced it.
 */
export const REJECTABLE_FIELDS = {
  'personal.name': 'الاسم',
  'personal.gender': 'الجنس',
  'personal.nationality': 'الجنسية',
  'personal.residentStatus': 'صفة الإقامة',
  'personal.identityDocType': 'نوع وثيقة الإثبات',
  'personal.identityDocNumber': 'رقم الوثيقة',
  'personal.civilRecordNumber': 'رقم السجل',
  'personal.residencyNumber': 'رقم الإقامة',
  'contact.phone': 'رقم الهاتف',
  'contact.whatsapp': 'رقم واتساب',
  'contact.maritalStatus': 'الحالة الاجتماعية',
  'contact.familySize': 'عدد أفراد الأسرة',
  'property.neighborhood': 'الحي',
  'property.propertyNumber': 'رقم العقار',
  'property.propertyType': 'نوع العقار',
  'property.occupancyType': 'نوع الإشغال',
  'property.landlord': 'بيانات المالك',
  'property.buildingName': 'اسم المبنى',
  'property.unitArea': 'المساحة',
  'property.units': 'الوحدات',
  'property.location': 'موقع العقار',
  'documents.identity': 'صورة وثيقة الإثبات',
  'documents.ownership': 'إثبات الملكية',
  'documents.rental': 'عقد الإيجار',
  'documents.other': 'مرفقات أخرى',
} as const satisfies Record<string, string>;

export type RejectableField = keyof typeof REJECTABLE_FIELDS;

export const REJECTABLE_FIELD_KEYS = Object.keys(REJECTABLE_FIELDS) as [
  RejectableField,
  ...RejectableField[],
];

/** Groups the registry for the reviewer's checklist, in wizard order. */
export const REJECTABLE_FIELD_GROUPS: ReadonlyArray<{
  title: string;
  fields: readonly RejectableField[];
}> = [
  {
    title: 'البيانات الشخصية',
    fields: REJECTABLE_FIELD_KEYS.filter((key) => key.startsWith('personal.')),
  },
  {
    title: 'التواصل والأسرة',
    fields: REJECTABLE_FIELD_KEYS.filter((key) => key.startsWith('contact.')),
  },
  {
    title: 'العقارات',
    fields: REJECTABLE_FIELD_KEYS.filter((key) => key.startsWith('property.')),
  },
  {
    title: 'المرفقات',
    fields: REJECTABLE_FIELD_KEYS.filter((key) => key.startsWith('documents.')),
  },
];

/**
 * Staff status transition. Rejection must carry a reason, and may additionally
 * name the specific fields at fault.
 *
 * `rejectedFields` is optional and may be empty even on a rejection: a claim
 * refused outright is not the same as one with three correctable mistakes, and
 * forcing the reviewer to name a field would misrepresent the first as the
 * second.
 */
export const changeStatusSchema = z
  .object({
    status: reportStatusSchema,
    reason: z.string().trim().min(5).max(500).optional(),
    rejectedFields: z.array(z.enum(REJECTABLE_FIELD_KEYS)).max(40).default([]),
    /**
     * Whether the citizen may fix the flagged fields online. Defaults to true —
     * see the field's note on the Registration model. When false the citizen
     * is asked to visit the municipality instead, optionally at `revisitAt`.
     */
    allowCitizenCorrection: z.boolean().default(true),
    revisitAt: z
      .string()
      .datetime({ offset: true })
      .or(z.string().min(1).transform((value) => new Date(value).toISOString()))
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'REJECTED' && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'A rejection reason is required',
      });
    }
    // Flagged fields without a rejection have nowhere to be shown — the
    // applicant only ever sees them on a refused submission.
    if (data.status !== 'REJECTED' && data.rejectedFields.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectedFields'],
        message: 'Flagged fields are only meaningful on a rejection',
      });
    }
    // An appointment only means something when the citizen is being asked to
    // come in; attached to a self-service correction it would be a date with
    // nothing to attend.
    if (data.revisitAt && data.allowCitizenCorrection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revisitAt'],
        message: 'A visit time only applies when the citizen cannot correct online',
      });
    }
  });

export type ChangeStatus = z.infer<typeof changeStatusSchema>;
