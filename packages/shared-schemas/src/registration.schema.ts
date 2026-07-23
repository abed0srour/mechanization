import { z } from 'zod';
import { contactDetailsSchema, personalDetailsSchema } from './citizen.schema';
import { propertyEntriesSchema } from './property.schema';
import { documentTypeSchema, reportStatusSchema } from './enums';
import { uuid } from './primitives';

/**
 * The full citizen submission (Steps 1–6), sent as the JSON `payload` part of a
 * single multipart request alongside the raw files.
 */
export const submitRegistrationSchema = z.object({
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

export const propertyNumberCheckResponseSchema = z.object({
  propertyNumber: z.string(),
  available: z.boolean(),
});

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
