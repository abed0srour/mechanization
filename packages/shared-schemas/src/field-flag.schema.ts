import { z } from 'zod';

/**
 * «غير مؤكَّد / بانتظار المعلومة» — a field the officer could not fill, with
 * their stated reason for it.
 *
 * A field officer standing in a tent settlement does not always leave with a
 * complete record: the deed is with a relative in another town, the parcel
 * number is on a paper nobody has today, the household has no phone. Before
 * this existed the form's only answers were "invent something" or "do not
 * register the person" — and the register was quietly getting the first one.
 *
 * So a flag is not a way around validation, it is a *recorded* exception: the
 * field is emptied rather than guessed at, the officer says in their own words
 * why, and the whole record lands as `REQUIRES_REVIEW` so it appears on a work
 * queue instead of dissolving into the register looking finished.
 */

/**
 * The fields a flag may never cover.
 *
 * Two different reasons, both structural rather than a judgement about how
 * important the field is:
 *
 *  - `firstName` / `lastName` are `NOT NULL` on `users`, and a record with no
 *    name cannot be searched for again — a "pending info" citizen nobody can
 *    find is worse than an unregistered one.
 *  - `isLebanese`, `occupancyType` and `propertyType` are the discriminators
 *    the rest of the form branches on. Unset, there is no answer to "which
 *    fields does this record even have", so there is nothing left to flag
 *    against. All three are answerable by looking at the person or the
 *    building, which is why they are the safe ones to insist on.
 */
export const NON_FLAGGABLE_FIELDS = [
  'firstName',
  'lastName',
  'isLebanese',
  'occupancyType',
  'propertyType',
] as const;

/** `properties.3.landlordPhone` → `landlordPhone`. */
function leafOf(path: string): string {
  const segments = path.split('.');
  return segments[segments.length - 1] ?? '';
}

/**
 * Paths this form is allowed to raise a flag on.
 *
 * Shape-checked rather than matched against an enumeration of every field:
 * the sections are `personal`, `contact` and an indexed `properties`, and a
 * path outside them cannot resolve to an input whatever it says. A misspelled
 * but well-formed path is harmless — it silences no real validation issue,
 * because issues are matched by exact path.
 */
const FLAG_PATH = /^(personal|contact)\.[a-zA-Z][a-zA-Z0-9]*$|^properties\.\d{1,2}\.[a-zA-Z][a-zA-Z0-9]*$/;

export function isFlaggablePath(path: string): boolean {
  if (!FLAG_PATH.test(path)) return false;
  return !(NON_FLAGGABLE_FIELDS as readonly string[]).includes(leafOf(path));
}

/**
 * One flagged field.
 *
 * The reason is required and has a floor of four characters for the same
 * reason the flag exists at all: «لا» or «x» records that someone clicked the
 * button, not why the data is missing, and the whole point is that the person
 * who completes this record later can tell whether to phone the citizen, wait
 * for a document, or visit.
 */
export const fieldFlagSchema = z.object({
  path: z
    .string({ required_error: 'الحقل المعلَّم مطلوب' })
    .trim()
    .max(80)
    .refine(isFlaggablePath, 'لا يمكن تعليم هذا الحقل كـ«غير مؤكَّد»'),
  reason: z
    .string({ required_error: 'يرجى ذكر سبب عدم اكتمال هذه المعلومة' })
    .trim()
    .min(4, 'يرجى ذكر سبب عدم اكتمال هذه المعلومة')
    .max(300, 'السبب طويل جداً'),
});

export type FieldFlag = z.infer<typeof fieldFlagSchema>;

/**
 * The flags on one submission.
 *
 * The ceiling is not a data-quality rule — it is the point past which the
 * record has stopped being a registration with gaps and become a blank form
 * with excuses attached, which is a conversation to have with the officer
 * rather than a row to store.
 */
export const fieldFlagsSchema = z
  .array(fieldFlagSchema)
  .max(40, 'عدد الحقول غير المؤكَّدة كبير جداً — يرجى استكمال البيانات')
  .default([])
  .superRefine((flags, ctx) => {
    const seen = new Set<string>();
    flags.forEach((flag, index) => {
      if (seen.has(flag.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'path'],
          message: 'هذا الحقل معلَّم أكثر من مرة',
        });
      }
      seen.add(flag.path);
    });
  });

export function flaggedPaths(flags: readonly FieldFlag[]): Set<string> {
  return new Set(flags.map((flag) => flag.path));
}

/**
 * Blanks every flagged field before anything is validated or stored.
 *
 * A flag means "we did not establish this", so whatever is sitting in the
 * input for that field — a half-typed number, a value left over from before
 * the officer flagged it — is exactly the thing not to keep. Emptying it here
 * rather than trusting the client to do it also collapses the validation
 * problem: with the value gone, every issue a flag is meant to excuse arrives
 * on that field's own path, so flags can be matched to issues exactly rather
 * than by prefix.
 */
export function withoutFlagged<T extends Record<string, unknown>>(
  section: T,
  prefix: string,
  paths: ReadonlySet<string>,
): T {
  const out: Record<string, unknown> = { ...section };
  for (const key of Object.keys(out)) {
    if (paths.has(`${prefix}.${key}`)) delete out[key];
  }
  return out as T;
}

/** The dot-path an issue landed on, in the same vocabulary the flags use. */
export function issuePath(prefix: string, path: ReadonlyArray<string | number>): string {
  return [prefix, ...path].join('.');
}
