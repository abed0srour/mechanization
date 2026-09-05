import { z } from 'zod';
import {
  bloodTypeSchema,
  genderSchema,
  identityDocTypeSchema,
  maritalStatusSchema,
  residentStatusSchema,
} from './enums';
import {
  arabicOrLatinName,
  civilRecordNumber,
  contactPhone,
  documentNumber,
} from './primitives';
import { householdMembersSchema } from './household.schema';

/**
 * Step 1 — البيانات الشخصية ومعلومات الإثبات
 *
 * The bare object is exported alongside the validated schema because two
 * things need the *fields* without the *rules*: `partialPersonalDetailsSchema`
 * below, and nothing else — see the note there for why that separation is not
 * a second, weaker validator.
 */
export const personalDetailsObject = z.object({
  firstName: arabicOrLatinName,
  middleName: arabicOrLatinName,
  lastName: arabicOrLatinName,
  gender: genderSchema,
  bloodType: bloodTypeSchema,
  identityDocType: identityDocTypeSchema,
  identityDocNumber: documentNumber.optional().or(z.literal('')),
  civilRecordNumber: civilRecordNumber.optional().or(z.literal('')),
  /**
   * محل القيد — the town the رقم السجل belongs to, and its قضاء.
   *
   * The town is required of a Lebanese citizen for exactly the reason the سجل
   * number is: without it the number is half a value. Every village in Lebanon
   * has a سجل ٤٥, so a number stored alone collides with strangers by default
   * and cannot tell two records apart — which is the one job it was kept for.
   *
   * The قضاء is never required. It disambiguates the handful of town names that
   * repeat across the country and is otherwise redundant with the town.
   */
  registrationPlaceTown: z
    .string()
    .trim()
    .max(120, 'اسم البلدة طويل جداً')
    .optional()
    .or(z.literal('')),
  registrationPlaceDistrict: z
    .string()
    .trim()
    .max(120, 'اسم القضاء طويل جداً')
    .optional()
    .or(z.literal('')),
  /**
   * اسم الأم — the tie-breaker no other field can be.
   *
   * Printed on the إخراج قيد the citizen is holding, and the only identity field
   * that crosses the patriline: two brothers share a father, a شهرة and a سجل,
   * and two first cousins in one village routinely share all three names.
   * Neither pair shares a mother.
   */
  motherName: arabicOrLatinName.optional().or(z.literal('')),
  /**
   * تاريخ الولادة, `YYYY-MM-DD` as the date input produces it.
   *
   * A string on the wire rather than a `Date`: this crosses JSON, and a value
   * parsed into a local `Date` in the browser and read back on a server in
   * another zone is a birthday that moves by a day. The column is `@db.Date`
   * for the same reason.
   */
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ الولادة غير صالح')
    .refine((value) => {
      const parsed = Date.parse(`${value}T00:00:00Z`);
      return Number.isFinite(parsed) && parsed <= Date.now();
    }, 'تاريخ الولادة لا يمكن أن يكون في المستقبل')
    .refine((value) => Number(value.slice(0, 4)) >= 1900, 'تاريخ الولادة غير صالح')
    .optional()
    .or(z.literal('')),
  nationality: z
    .string({ required_error: 'الجنسية مطلوبة' })
    .trim()
    .min(2, 'الجنسية قصيرة جداً')
    .max(60, 'الجنسية طويلة جداً'),
  isLebanese: z.boolean({ required_error: 'يرجى تحديد الجنسية' }),
  residencyNumber: documentNumber.optional().or(z.literal('')),
  residentStatus: residentStatusSchema,
});

/**
 * Four conditional rules are enforced here rather than in the UI alone:
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
 *  4. residentStatus REFUGEE describes someone displaced from outside Lebanon —
 *     a Lebanese citizen cannot hold it. The UI hides the option once لبناني
 *     is chosen; this is what actually stops it reaching the server if that
 *     selection is ever bypassed or left stale from before a nationality switch.
 */
export const personalDetailsSchema = personalDetailsObject.superRefine((data, ctx) => {
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
    if (data.residentStatus === 'REFUGEE') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['residentStatus'],
        message: 'صفة «لاجئ» غير متاحة للمواطنين اللبنانيين',
      });
    }
    /*
      Rules 5 and 6, both about telling one person from another.

      Both values are on the إخراج قيد in the citizen's hand, and both are
      required of a Lebanese citizen for the same reason رقم السجل is: without
      them, two cousins carrying an identical three-part name are two records
      nobody — not a clerk, not the resolver — can separate. An officer who
      genuinely cannot establish either still files the record, because both are
      flaggable like every other field here.
    */
    if (!data.motherName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motherName'],
        message: 'اسم الأم مطلوب للبنانيين',
      });
    }
    if (!data.registrationPlaceTown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationPlaceTown'],
        message: 'محل القيد مطلوب — رقم السجل وحده لا يميّز شخصاً',
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
 * The same fields with nothing required of them.
 *
 * This is **not** a looser rulebook. Whether a record is acceptable is still
 * decided by `personalDetailsSchema` above — a submission carrying flags is
 * validated against it and passes only if every complaint it raises lands on a
 * field the officer explicitly flagged (see `parseCitizenSubmission`). What
 * this schema does is the other half of the job: shape and normalise what
 * *is* there — a phone into E.164, a household size into an integer — once the
 * strict pass has already ruled on it.
 *
 * Built from `personalDetailsObject` rather than restated, so a field added
 * above is carried here automatically and cannot be silently dropped on the
 * way to the database.
 *
 * The three that stay required are `NON_FLAGGABLE_FIELDS` — no flag can excuse
 * them, so no shape derived from flags can make them optional. Stating it here
 * as well as there means everything downstream reads them as plain `string` /
 * `boolean` and never has to defend against an absence that cannot happen.
 */
export const partialPersonalDetailsSchema = personalDetailsObject
  .partial()
  .required({ firstName: true, lastName: true, isLebanese: true });

export type PartialPersonalDetails = z.infer<typeof partialPersonalDetailsSchema>;

/**
 * Step 2 — معلومات التواصل والأسرة
 *
 * `whatsappSameAsPhone` is a UI affordance that also carries meaning on the wire:
 * when true the backend copies `phone` rather than trusting a client-sent duplicate.
 */
export const contactDetailsObject = z.object({
  maritalStatus: maritalStatusSchema,
  /**
   * `contactPhone`, not `lebaneseMobile`.
   *
   * A household whose only number is an Ogero landline could not be recorded at
   * all — see the note on `contactPhone`. The consequence is worth stating
   * plainly: a citizen registered on a landline cannot receive an SMS code, so
   * the OTP route still demands a mobile and they sign in with their رقم مرجعي
   * instead. Being reachable on paper beats being absent from the register.
   */
  phone: contactPhone,
  whatsappSameAsPhone: z.boolean().default(true),
  whatsapp: contactPhone.optional(),
  /**
   * A second number, and whose it is.
   *
   * The `@@unique` on the users table already records that a household commonly
   * shares one phone; when that number dies, nothing else reaches them. The
   * relation («ابنه», «الجارة») is asked alongside it because a bare second
   * number nobody can place is one a clerk will not ring.
   */
  altPhone: contactPhone.optional().or(z.literal('')),
  altPhoneRelation: z.string().trim().max(60, 'الصلة طويلة جداً').optional().or(z.literal('')),
  /**
   * أفراد الأسرة — who lives here, not merely how many.
   *
   * Carried in this section because this section *is* «التواصل والأسرة», and
   * because `familySize`, the integer it supersedes, has always lived beside it.
   *
   * Optional, and deliberately so: every record filed before the roster existed
   * still validates, and an officer who could not enumerate a household still
   * files one. What is not optional is the choice between them — see
   * `residentCountOf`, which prefers the roster wherever there is one.
   */
  householdMembers: householdMembersSchema,
  /**
   * «هل أحد من أفراد أسرتك مسجّل مسبقاً؟» — the relative's رقم مرجعي.
   *
   * The primary way a household gets linked, and the only one that is not a
   * judgement: a person knows their own family perfectly, and this number is
   * already printed on the slip that relative was given. Everything in
   * `record-linkage.ts` is the fallback for when this goes unanswered.
   *
   * It travels **inside the submission** rather than as a second request the
   * browser makes after the citizen is created, because this form works
   * offline. A queued record that carried the link as a separate call would
   * sync the household and silently lose the family it belongs to.
   *
   * Uppercased and stripped of spaces on the way in, the same normalisation the
   * reference-number sign-in performs, because this is read off paper.
   */
  householdReference: z
    .string()
    .trim()
    .max(40)
    // Spaces and lowercase are what a clerk actually types off a slip — the
    // same normalisation the reference sign-in performs.
    .transform((value) => value.toUpperCase().replace(/\s/g, ''))
    /*
      Checked here rather than left to the lookup, because the two failures need
      different words. A well-formed reference that matches nobody is «we cannot
      find this person»; a value that is not a reference at all — a citizen id
      pasted out of a URL, a phone number, a name — is «this is not a reference
      number», and saying so at the field beats saying nothing until save and
      then reporting that the family could not be linked.
    */
    .refine(
      (value) =>
        value === '' ||
        /^[A-Z]{3}-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(value),
      'الرقم المرجعي غير صالح — مثاله BZR-2608-5HLQBM (ليس رقم الهوية أو معرّف السجل)',
    )
    .optional(),
  /**
   * Optional now, and required by `contactDetailsSchema` only when no roster
   * was given — see the refinement there.
   *
   * A form that asks both "who lives here" and "how many live here" is a form
   * that can contradict itself, and nothing downstream would know which answer
   * the municipality believed. Where the household has been enumerated the
   * count is derived from it; where it has not, this is still the only thing
   * anyone knows and is still demanded.
   */
  familySize: z.coerce
    .number({ invalid_type_error: 'عدد أفراد الأسرة يجب أن يكون رقماً' })
    .int('عدد أفراد الأسرة يجب أن يكون رقماً صحيحاً')
    .min(1, 'يجب أن يكون فرداً واحداً على الأقل')
    .max(50, 'العدد كبير جداً — يرجى مراجعة البلدية')
    .optional(),
});

/**
 * How many people live here, preferring the roster over the integer.
 *
 * Derived wherever the household has been enumerated rather than asked twice: a
 * form carrying both a roster and a free-typed number is a form that can
 * contradict itself, and nothing downstream would know which the municipality
 * believed. `residesHere` is the filter, so a son in Abidjan stays on the family
 * roster and out of the occupancy count.
 *
 * Prefers the roster wherever one was supplied, counting resident members and
 * including the registrant (+1) when the roster does not already contain an
 * explicit HEAD row (the form instructs the citizen not to list themselves).
 *
 * Falls back to `familySize` for every record filed before the roster existed,
 * which is the whole reason that column was not dropped. See migration 0025.
 */
export function residentCountOf(contact: {
  householdMembers?: ReadonlyArray<{ residesHere?: boolean; relationToHead?: string }>;
  familySize?: number | null;
}): number | null {
  const roster = contact.householdMembers ?? [];
  if (roster.length > 0) {
    const hasExplicitHead = roster.some((member) => member.relationToHead === 'HEAD');
    const residentOtherMembers = roster.filter((member) => member.residesHere !== false).length;
    return (hasExplicitHead ? 0 : 1) + residentOtherMembers;
  }
  return contact.familySize ?? null;
}

export const contactDetailsSchema = contactDetailsObject
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
    /*
      One of the two, never neither.

      The household size is still required of a record that names nobody — it is
      the only thing such a record knows about the home, and letting it through
      empty would lose the figure without replacing it. A record carrying a
      roster is exempt because the roster *is* the count.
    */
    if ((data.householdMembers?.length ?? 0) === 0 && data.familySize == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['familySize'],
        message: 'عدد أفراد الأسرة مطلوب — أو أدخل أفراد الأسرة',
      });
    }
  });

export type ContactDetails = z.infer<typeof contactDetailsSchema>;

/**
 * Contact details with nothing required — the counterpart of
 * `partialPersonalDetailsSchema`, and the same division of labour.
 *
 * The copy-from-phone rule is kept because it is normalisation rather than
 * validation: `whatsappSameAsPhone` describes what the officer *meant*, and
 * dropping it here would store a null WhatsApp number for a household that has
 * one. An absent `whatsappSameAsPhone` reads as true, exactly as its default
 * does on the strict schema; when the phone itself is flagged there is nothing
 * to copy and both end up empty, which is the honest outcome.
 */
export const partialContactDetailsSchema = contactDetailsObject
  .partial()
  .transform((data) => ({
    ...data,
    whatsapp: data.whatsappSameAsPhone === false ? data.whatsapp : (data.phone ?? data.whatsapp),
  }));

export type PartialContactDetails = z.infer<typeof partialContactDetailsSchema>;
