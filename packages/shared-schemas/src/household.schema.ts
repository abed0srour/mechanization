import { z } from 'zod';
import { genderSchema } from './enums';
import { arabicOrLatinName, uuid } from './primitives';

/**
 * الأسرة — the household, and the roster of people in it.
 *
 * `familySize` was an integer, and an integer is the one shape this fact cannot
 * survive in: an officer who writes «٦» has recorded that six people live here
 * and destroyed the only opportunity anyone will get to learn who they are.
 * Knocking again to find out is exactly the second visit the register exists to
 * avoid, and a count also cannot be deduplicated — a husband and a wife who each
 * register are two rows each claiming the same six, which is how the dashboard's
 * population figure came to be roughly double the town.
 *
 * A roster fixes both. It is also the half of the register that serves anything
 * other than billing: النفوس, school and waste planning, and the lists a
 * municipality keeps of who is elderly or alone.
 */

/**
 * Relation to the **head of the household**, which is how every census anchors
 * this and the only anchor that stays meaningful when the roster is read by
 * someone who was not in the room.
 *
 * `HEAD` is a value rather than an absence: the head is a member like any other,
 * so the roster is the household's whole population and `residesHere` filtering
 * gives an occupancy count without a separate rule for the person at the top.
 *
 * There is deliberately no `SON` / `DAUGHTER` pair. Gender is its own field on
 * the same row, so splitting the relation by it would let a row say `SON` and
 * `FEMALE` at once — a contradiction the storage would happily keep and no
 * reader could resolve. `CHILD` plus `gender` says everything the pair said and
 * cannot disagree with itself.
 */
export const HOUSEHOLD_RELATION = [
  'HEAD',
  'SPOUSE',
  'CHILD',
  'PARENT',
  'SIBLING',
  'RELATIVE',
  'OTHER',
] as const;
export const householdRelationSchema = z.enum(HOUSEHOLD_RELATION, {
  errorMap: () => ({ message: 'صلة القرابة مطلوبة' }),
});
export type HouseholdRelation = (typeof HOUSEHOLD_RELATION)[number];

/**
 * A year, not a date.
 *
 * The person filling this in is describing somebody else — a father listing his
 * children, a wife listing her husband — and they reliably know the year. Asking
 * for the day would produce a confident wrong answer on most rows, and a wrong
 * date of birth is worse than an absent one: it is the field
 * `matchesBirthYear` scores identity on.
 *
 * The registrant's *own* birth date is a separate field on `User`, read off the
 * document in their hand, and is a full date for that reason.
 */
export const birthYearField = z.coerce
  .number({ invalid_type_error: 'سنة الولادة يجب أن تكون رقماً' })
  .int('سنة الولادة يجب أن تكون رقماً صحيحاً')
  .min(1900, 'سنة الولادة غير صالحة')
  .max(new Date().getUTCFullYear(), 'سنة الولادة في المستقبل');

/**
 * One person on the roster.
 *
 * `fullName` rather than the three-part split the citizen form uses: this is a
 * name someone else recites, and demanding it be broken into الاسم / اسم الأب /
 * الشهرة at the door produces guesses in the middle field. The linkage features
 * tokenise it and compare tokens, so an undivided name costs nothing there.
 */
export const householdMemberSchema = z.object({
  /**
   * Present on a row already stored, absent on one being added now — the same
   * convention `identifiedPropertyEntrySchema` uses, and load-bearing for the
   * same reason.
   *
   * Without it Zod strips the id on the way in, the edit path can match nothing
   * it holds against anything it is sent, and every save deletes the whole
   * roster and writes it back under fresh ids. The content would survive and the
   * identities would not.
   *
   * An id on the *create* path is ignored rather than refused; nothing reads it
   * there. On the update path it is checked against the rows this citizen's
   * household actually owns before anything is written — see
   * `CitizensService.update`.
   */
  id: uuid.optional(),
  fullName: arabicOrLatinName,
  relationToHead: householdRelationSchema,
  /**
   * An empty input is *no answer*, not the year zero.
   *
   * `z.coerce.number()` turns `''` into `0` before the schema sees it, so an
   * optional field left blank — which is the common case, since a relative
   * frequently does not know — would fail with «سنة الولادة غير صالحة» and the
   * officer would have no way to proceed but to invent one. Inventing a birth
   * year is worse than leaving it out: it is what identity is matched on.
   */
  birthYear: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    birthYearField.optional(),
  ),
  gender: genderSchema.optional(),
  /**
   * Whether this person actually lives in the dwelling.
   *
   * A son in Abidjan is on the family roster and is not in the town, and a
   * municipality planning collection rounds, school places or aid needs the
   * difference. Defaults true because the common case is a household describing
   * itself.
   */
  residesHere: z.boolean().default(true),
});

export type HouseholdMemberInput = z.infer<typeof householdMemberSchema>;

/**
 * A roster with more people than this is a data-entry accident, matching the
 * soft ceilings the property card already uses.
 */
export const householdMembersSchema = z
  .array(householdMemberSchema)
  .max(40, 'عدد أفراد الأسرة كبير جداً — يرجى مراجعة البلدية')
  .default([]);

// ─────────────────────────  Linkage requests  ─────────────────────────

/**
 * Accepting a proposed link.
 *
 * `memberId` is optional and is what separates the two things a link can mean.
 * With it, the arriving citizen *fills a slot somebody already described* — the
 * husband a wife listed weeks ago — and the roster row keeps its relation, its
 * birth year and its place in the family. Without it, the citizen simply joins
 * the household and a new row is written for them.
 */
export const linkHouseholdSchema = z
  .object({
    householdId: uuid,
    memberId: uuid.optional(),
    /**
     * Required only when no slot is being filled.
     *
     * A described slot already carries its relation — the wife who wrote the row
     * said «زوج», and re-asking would invite a clerk to overwrite her answer
     * with a guess. A citizen joining a household nobody described has no
     * relation on record, and the roster is unreadable without one.
     */
    relationToHead: householdRelationSchema.optional(),
  /**
   * What the clerk actually confirmed, in their own words.
   *
   * Required, and it is the only part of a link that a later reader can weigh.
   * A score says the system thought two records matched; this says a person
   * asked and was told. «أكّد أنه زوج فاطمة حرب» is reviewable; a confidence
   * number is not.
   */
    confirmation: z
      .string({ required_error: 'اذكر ما تم التحقق منه' })
      .trim()
      .min(3, 'اذكر ما تم التحقق منه')
      .max(300),
  })
  .superRefine((data, ctx) => {
    if (!data.memberId && !data.relationToHead) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relationToHead'],
        message: 'صلة القرابة مطلوبة عند إضافة فرد جديد إلى الأسرة',
      });
    }
  });

export type LinkHousehold = z.infer<typeof linkHouseholdSchema>;

/** Undoing one. Append-only history lives in the audit log, not here. */
export const unlinkHouseholdSchema = z.object({
  reason: z.string({ required_error: 'اذكر سبب فك الربط' }).trim().min(3, 'اذكر سبب فك الربط').max(300),
});

export type UnlinkHousehold = z.infer<typeof unlinkHouseholdSchema>;

/**
 * Moving headship.
 *
 * Its own operation rather than a side effect of linking, because the head is
 * the anchor every `relationToHead` is written against — changing it silently
 * would relabel a roster nobody re-read. See `HouseholdsService.setHead`, which
 * applies the one swap that is label-preserving and refuses to guess at the
 * rest.
 */
export const setHouseholdHeadSchema = z.object({ citizenId: uuid });
export type SetHouseholdHead = z.infer<typeof setHouseholdHeadSchema>;

/**
 * The citizen's own answer to «هل أحد من أفراد أسرتك مسجّل مسبقاً؟».
 *
 * This is the primary mechanism and everything in `record-linkage.ts` is the
 * fallback for when it goes unanswered. A person knows their own household
 * perfectly, and the رقم مرجعي is already printed on every registered citizen's
 * slip — one optional field beats any amount of inference, and it is the only
 * input here that can produce an automatic link.
 */
export const householdHintSchema = z.object({
  referenceNumber: z.string().trim().max(40).optional().or(z.literal('')),
  relativeName: arabicOrLatinName.optional().or(z.literal('')),
});

export type HouseholdHint = z.infer<typeof householdHintSchema>;
