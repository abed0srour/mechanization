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
          field: z.string().min(1),
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

/** Staff status transition. Rejection must carry a reason. */
export const changeStatusSchema = z
  .object({
    status: reportStatusSchema,
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'REJECTED' && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'A rejection reason is required',
      });
    }
  });

export type ChangeStatus = z.infer<typeof changeStatusSchema>;
