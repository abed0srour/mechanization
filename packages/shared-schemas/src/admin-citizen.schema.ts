import { z } from 'zod';
import { contactDetailsSchema, personalDetailsSchema } from './citizen.schema';
import { propertyEntriesSchema, propertyEntrySchema } from './property.schema';
import { uuid } from './primitives';

/**
 * Staff-entered registrations — the same submission a citizen used to file
 * themselves, minus the two parts that only make sense when the citizen is the
 * one typing.
 *
 * `documentSlots` is gone because a clerk entering a claim from paper has no
 * browser `File` objects to attach, and `declarationAccepted` is gone because a
 * checkbox a clerk ticks on someone else's behalf is not an الإقرار — the
 * legal act belongs to the person whose data it is, and recording a staff tick
 * as though it were theirs would be worse than not recording one at all.
 *
 * Everything else is deliberately the *same schema object* the public wizard
 * validated against, not a parallel copy: the taxonomy rules (a tenant needs
 * units, a plot needs a land type, a tenant occupancy needs a landlord) are the
 * municipality's rules about property, not about who is holding the keyboard.
 */

/**
 * خيمة is only available to a لاجئ.
 *
 * Spans `personal` and `properties`, so — exactly as in
 * `submitRegistrationSchema` — it can only be checked at the top level where
 * both are in hand. Shared between create and update rather than written twice.
 */
function assertTentOnlyForRefugees(
  data: { personal: { residentStatus: string }; properties: Array<{ propertyType: string }> },
  ctx: z.RefinementCtx,
): void {
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
}

/** A staff member filing a new citizen and their first registration. */
export const adminCreateCitizenSchema = z
  .object({
    personal: personalDetailsSchema,
    contact: contactDetailsSchema,
    properties: propertyEntriesSchema,
  })
  .superRefine(assertTentOnlyForRefugees);

export type AdminCreateCitizen = z.infer<typeof adminCreateCitizenSchema>;

/**
 * A property card that may already exist.
 *
 * `id` present means "this is the row you already have, changed"; absent means
 * "this is new". An id the citizen's registration does not own is rejected
 * server-side rather than silently adopted — see `CitizensService.update`.
 */
export const identifiedPropertyEntrySchema = z.intersection(
  propertyEntrySchema,
  z.object({ id: uuid.optional() }),
);

export type IdentifiedPropertyEntry = z.infer<typeof identifiedPropertyEntrySchema>;

/**
 * A staff member correcting a citizen already on file.
 *
 * The whole record is sent, not a patch: the admin form is a single page
 * showing every field at once, so "what is on screen" and "what should be
 * stored" are the same thing — and a diff computed in the browser is one more
 * place for the two to disagree.
 */
export const adminUpdateCitizenSchema = z
  .object({
    personal: personalDetailsSchema,
    contact: contactDetailsSchema,
    properties: z
      .array(identifiedPropertyEntrySchema)
      .min(1, 'يجب تسجيل عقار واحد على الأقل')
      .max(25, 'عدد العقارات كبير جداً — يرجى مراجعة البلدية'),
  })
  .superRefine(assertTentOnlyForRefugees);

export type AdminUpdateCitizen = z.infer<typeof adminUpdateCitizenSchema>;
