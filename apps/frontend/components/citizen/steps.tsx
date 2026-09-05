'use client';

import { useCallback, useEffect } from 'react';
import {
  BLOOD_TYPE,
  GENDER,
  getLabels,
  HOUSEHOLD_RELATION,
  IDENTITY_DOC_TYPE,
  MARITAL_STATUS,
  residentCountOf,
  RESIDENT_STATUS,
} from '@mechanization/shared-schemas';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';

type Values = Record<string, unknown>;
type Errors = Record<string, string>;

const str = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';

/** Step 1 — البيانات الشخصية ومعلومات الإثبات */
export function PersonalStep({
  value,
  errors,
  onChange,
  locale = 'ar',
}: {
  value: Values;
  errors: Errors;
  onChange: (next: Values) => void;
  locale?: string;
}) {
  const labels = getLabels(locale);
  const set = useCallback((patch: Values) => onChange({ ...value, ...patch }), [onChange, value]);
  const isLebanese = value.isLebanese !== false;

  /**
   * صفة الإقامة options a Lebanese citizen may choose from. لاجئ describes
   * someone displaced from outside Lebanon — a Lebanese citizen cannot hold
   * that status, so the choice is not offered once لبناني is selected.
   */
  const residentStatusOptions = isLebanese
    ? RESIDENT_STATUS.filter((status) => status !== 'REFUGEE')
    : RESIDENT_STATUS;

  useEffect(() => {
    if (isLebanese) {
      const patch: Values = {};
      if (value.nationality !== 'لبناني' && value.nationality !== 'Lebanese') {
        patch.nationality = locale === 'en' ? 'Lebanese' : 'لبناني';
      }
      if (value.residentStatus === 'REFUGEE') patch.residentStatus = undefined;
      if (Object.keys(patch).length > 0) set(patch);
    } else if (value.identityDocType !== 'PASSPORT') {
      set({ identityDocType: 'PASSPORT' });
    }
  }, [isLebanese, value.nationality, value.residentStatus, value.identityDocType, locale, set]);

  const identityDocNumberLabel =
    labels.identityDocNumberLabel?.[value.identityDocType as never] ??
    (locale === 'en' ? 'Document Number' : 'رقم الوثيقة');

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 1. Name block */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={locale === 'en' ? 'First Name' : 'الاسم الأول'}
          htmlFor="firstName"
          path="personal.firstName"
          required
          error={errors['personal.firstName']}
        >
          <Input
            id="firstName"
            autoComplete="given-name"
            placeholder={locale === 'en' ? 'e.g. Ahmad' : 'مثال: أحمد'}
            invalid={Boolean(errors['personal.firstName'])}
            value={str(value.firstName)}
            onChange={(e) => set({ firstName: e.target.value })}
          />
        </Field>

        <Field
          label={locale === 'en' ? "Father's Name" : 'اسم الأب'}
          htmlFor="middleName"
          path="personal.middleName"
          required
          error={errors['personal.middleName']}
        >
          <Input
            id="middleName"
            autoComplete="additional-name"
            placeholder={locale === 'en' ? 'e.g. Mohammad' : 'مثال: محمد'}
            invalid={Boolean(errors['personal.middleName'])}
            value={str(value.middleName)}
            onChange={(e) => set({ middleName: e.target.value })}
          />
        </Field>

        <Field
          label={locale === 'en' ? 'Last Name' : 'الشهرة'}
          htmlFor="lastName"
          path="personal.lastName"
          required
          error={errors['personal.lastName']}
        >
          <Input
            id="lastName"
            autoComplete="family-name"
            placeholder={locale === 'en' ? 'e.g. Srour' : 'مثال: سرور'}
            invalid={Boolean(errors['personal.lastName'])}
            value={str(value.lastName)}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </Field>
      </div>

      {/* 2. Nationality & Gender - Instant 1-tap segment on mobile */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field
          label={locale === 'en' ? 'Nationality' : 'الجنسية'}
          htmlFor="isLebanese"
          path="personal.isLebanese"
          required
          error={errors['personal.isLebanese']}
        >
          <SegmentedControl
            value={isLebanese ? 'LEBANESE' : 'FOREIGN'}
            invalid={Boolean(errors['personal.isLebanese'])}
            onChange={(next) => {
              const isLeb = next === 'LEBANESE';
              if (isLeb) {
                set({ isLebanese: true, residencyNumber: undefined });
              } else {
                set({ isLebanese: false, civilRecordNumber: undefined });
              }
            }}
            options={[
              { value: 'LEBANESE', label: locale === 'en' ? 'Lebanese' : 'لبناني' },
              { value: 'FOREIGN', label: locale === 'en' ? 'Non-Lebanese' : 'غير لبناني' },
            ]}
          />
        </Field>

        <Field
          label={locale === 'en' ? 'Gender' : 'الجنس'}
          htmlFor="gender"
          path="personal.gender"
          required
          error={errors['personal.gender']}
        >
          <SegmentedControl
            value={str(value.gender)}
            invalid={Boolean(errors['personal.gender'])}
            onChange={(next) => set({ gender: next })}
            options={GENDER.map((g) => ({
              value: g,
              label: labels.gender[g] ?? g,
            }))}
          />
        </Field>
      </div>

      {/* 3. Residency Status - Full-width 1-tap segment */}
      <Field
        label={locale === 'en' ? 'Residency Status' : 'صفة الإقامة'}
        htmlFor="residentStatus"
        path="personal.residentStatus"
        required
        error={errors['personal.residentStatus']}
      >
        <SegmentedControl
          value={str(value.residentStatus)}
          invalid={Boolean(errors['personal.residentStatus'])}
          onChange={(next) => set({ residentStatus: next })}
          options={residentStatusOptions.map((option) => ({
            value: option,
            label: labels.residentStatus[option] ?? option,
          }))}
        />
      </Field>

      {/* Specific Nationality if non-Lebanese */}
      {!isLebanese ? (
        <Field
          label={locale === 'en' ? 'Specific Nationality' : 'الجنسية بالتفصيل'}
          htmlFor="nationality"
          path="personal.nationality"
          required
          error={errors['personal.nationality']}
        >
          <Input
            id="nationality"
            placeholder={locale === 'en' ? 'e.g. Syrian, Palestinian, Egyptian' : 'مثال: سوري، فلسطيني، مصري'}
            invalid={Boolean(errors['personal.nationality'])}
            value={value.nationality === 'لبناني' || value.nationality === 'Lebanese' ? '' : str(value.nationality)}
            onChange={(e) => set({ nationality: e.target.value })}
          />
        </Field>
      ) : null}

      {/* 4. ID Proof & Civil Record */}
      {isLebanese ? (
        <div className="space-y-3.5 rounded-lg border border-border/70 bg-muted/10 p-3 sm:p-4">
          <Field
            label={locale === 'en' ? 'ID Document Type' : 'نوع وثيقة الإثبات'}
            htmlFor="identityDocType"
            path="personal.identityDocType"
            required
            error={errors['personal.identityDocType']}
          >
            <SegmentedControl
              size="sm"
              value={str(value.identityDocType)}
              invalid={Boolean(errors['personal.identityDocType'])}
              onChange={(next) => set({ identityDocType: next })}
              options={IDENTITY_DOC_TYPE.map((o) => ({
                value: o,
                label: labels.identityDocType[o] ?? o,
              }))}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={identityDocNumberLabel}
              htmlFor="identityDocNumber"
              path="personal.identityDocNumber"
              required
              error={errors['personal.identityDocNumber']}
            >
              <Input
                id="identityDocNumber"
                inputMode="numeric"
                dir="ltr"
                placeholder="12345678"
                className="text-start"
                invalid={Boolean(errors['personal.identityDocNumber'])}
                value={str(value.identityDocNumber)}
                onChange={(e) => set({ identityDocNumber: e.target.value })}
              />
            </Field>

            <Field
              label={locale === 'en' ? 'Civil Record (Sijil) No.' : 'رقم السجل (القيد)'}
              htmlFor="civilRecordNumber"
              path="personal.civilRecordNumber"
              required
              error={errors['personal.civilRecordNumber']}
            >
              <Input
                id="civilRecordNumber"
                inputMode="numeric"
                dir="ltr"
                placeholder={locale === 'en' ? 'e.g. 42' : 'مثال: ٤٢'}
                className="text-start"
                invalid={Boolean(errors['personal.civilRecordNumber'])}
                value={str(value.civilRecordNumber)}
                onChange={(e) => set({ civilRecordNumber: e.target.value })}
              />
            </Field>

            {/*
              محل القيد, deliberately next to the number it qualifies.

              Placed here rather than in a section of its own because the two
              are read off one line of the same إخراج قيد, and because a سجل
              number without its محلة identifies nobody — every village in
              Lebanon has a سجل ٤٢. Splitting them across the form invites
              filling one and skipping the other.
            */}
            <Field
              label={locale === 'en' ? 'Place of Registration (Town)' : 'محل القيد (البلدة)'}
              htmlFor="registrationPlaceTown"
              path="personal.registrationPlaceTown"
              required
              error={errors['personal.registrationPlaceTown']}
            >
              <Input
                id="registrationPlaceTown"
                placeholder={locale === 'en' ? 'e.g. Deir Qanoun' : 'مثال: دير قانون النهر'}
                invalid={Boolean(errors['personal.registrationPlaceTown'])}
                value={str(value.registrationPlaceTown)}
                onChange={(e) => set({ registrationPlaceTown: e.target.value })}
              />
            </Field>

            <Field
              label={locale === 'en' ? 'District (Caza)' : 'قضاء القيد'}
              htmlFor="registrationPlaceDistrict"
              path="personal.registrationPlaceDistrict"
              error={errors['personal.registrationPlaceDistrict']}
            >
              <Input
                id="registrationPlaceDistrict"
                placeholder={locale === 'en' ? 'e.g. Tyre' : 'مثال: صور'}
                invalid={Boolean(errors['personal.registrationPlaceDistrict'])}
                value={str(value.registrationPlaceDistrict)}
                onChange={(e) => set({ registrationPlaceDistrict: e.target.value })}
              />
            </Field>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-border/70 bg-muted/10 p-3 sm:p-4">
          <Field
            label={identityDocNumberLabel}
            htmlFor="identityDocNumber"
            path="personal.identityDocNumber"
            error={errors['personal.identityDocNumber']}
          >
            <Input
              id="identityDocNumber"
              inputMode="numeric"
              dir="ltr"
              placeholder="Passport number"
              className="text-start"
              invalid={Boolean(errors['personal.identityDocNumber'])}
              value={str(value.identityDocNumber)}
              onChange={(e) => set({ identityDocNumber: e.target.value })}
            />
          </Field>

          <Field
            label={locale === 'en' ? 'Residency Permit No.' : 'رقم الإقامة'}
            htmlFor="residencyNumber"
            path="personal.residencyNumber"
            error={errors['personal.residencyNumber']}
          >
            <Input
              id="residencyNumber"
              inputMode="numeric"
              dir="ltr"
              placeholder="Residency number"
              className="text-start"
              invalid={Boolean(errors['personal.residencyNumber'])}
              value={str(value.residencyNumber)}
              onChange={(e) => set({ residencyNumber: e.target.value })}
            />
          </Field>
        </div>
      )}

      {/*
        5. اسم الأم and تاريخ الولادة — the pair that tells two people apart.

        Asked of everyone, not only of a Lebanese citizen: a date of birth is on
        every identity document in the world, and the mother's name is on most.
        Only the *requirement* is gated on nationality (see
        `personalDetailsSchema`), because only the إخراج قيد guarantees both.

        اسم الأم is the field that does the work no other one can. Two brothers
        share a father, a شهرة and a سجل; two first cousins in one village
        routinely share all three names. Neither pair shares a mother.
      */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={locale === 'en' ? "Mother's Name" : 'اسم الأم'}
          htmlFor="motherName"
          path="personal.motherName"
          required={isLebanese}
          error={errors['personal.motherName']}
        >
          <Input
            id="motherName"
            placeholder={locale === 'en' ? 'e.g. Mariam Awada' : 'مثال: مريم عواضه'}
            invalid={Boolean(errors['personal.motherName'])}
            value={str(value.motherName)}
            onChange={(e) => set({ motherName: e.target.value })}
          />
        </Field>

        <Field
          label={locale === 'en' ? 'Date of Birth' : 'تاريخ الولادة'}
          htmlFor="dateOfBirth"
          path="personal.dateOfBirth"
          error={errors['personal.dateOfBirth']}
        >
          <Input
            id="dateOfBirth"
            type="date"
            dir="ltr"
            className="text-start"
            /*
              Capped at today, so the picker itself refuses a future date rather
              than letting the officer discover it at save. The schema checks it
              again — a date input is a suggestion, not a guarantee.
            */
            max={new Date().toISOString().slice(0, 10)}
            invalid={Boolean(errors['personal.dateOfBirth'])}
            value={str(value.dateOfBirth)}
            onChange={(e) => set({ dateOfBirth: e.target.value })}
          />
        </Field>
      </div>

      {/* 6. Blood Type */}
      <Field
        label={locale === 'en' ? 'Blood Type' : 'فئة الدم'}
        htmlFor="bloodType"
        path="personal.bloodType"
        required
        error={errors['personal.bloodType']}
      >
        <Select
          value={str(value.bloodType)}
          onValueChange={(next) => set({ bloodType: next })}
        >
          <SelectTrigger id="bloodType" className={errors['personal.bloodType'] ? 'border-destructive' : ''}>
            <SelectValue placeholder={locale === 'en' ? 'Select blood type…' : 'اختر فئة الدم…'} />
          </SelectTrigger>
          <SelectContent side="bottom" position="popper">
            {BLOOD_TYPE.map((type) => (
              <SelectItem key={type} value={type}>
                {labels.bloodType?.[type] ?? type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** Step 2 — معلومات التواصل والأسرة */
export function ContactStep({
  value,
  errors,
  onChange,
  locale = 'ar',
  householdMatch = null,
  householdReferenceField = null,
}: {
  value: Values;
  errors: Errors;
  onChange: (next: Values) => void;
  locale?: string;
  /**
   * The «قد يكون مسجّلاً بالفعل» banner, injected rather than rendered here.
   *
   * This component is shared with the citizen-facing wizard, which has no staff
   * session and must not be able to query the register for other households.
   * Passing the banner in keeps that capability where the session is.
   */
  householdMatch?: React.ReactNode;
  /**
   * The رقم مرجعي input, when the caller can verify it live.
   *
   * Injected for the same reason as `householdMatch`: looking a reference up
   * needs a staff session, which this shared component does not have. Absent, a
   * plain input renders and the number is only checked on save.
   */
  householdReferenceField?: React.ReactNode;
}) {
  const labels = getLabels(locale);
  const set = (patch: Values) => onChange({ ...value, ...patch });
  const sameAsPhone = value.whatsappSameAsPhone !== false;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 1. Phone & WhatsApp - Top priority for field surveys */}
      <div className="space-y-3 rounded-lg border border-border/70 bg-card p-3 sm:p-4">
        <Field
          label={locale === 'en' ? 'Primary Phone Number' : 'رقم الهاتف الأساسي'}
          htmlFor="phone"
          path="contact.phone"
          required
          error={errors['contact.phone']}
        >
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="03 123456"
            className="text-start"
            invalid={Boolean(errors['contact.phone'])}
            value={str(value.phone)}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </Field>

        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="whatsapp" className="text-xs font-medium text-foreground/90">
              {locale === 'en' ? 'WhatsApp Number' : 'رقم الواتساب'}
            </Label>
            <label htmlFor="whatsappSameAsPhone" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <Checkbox
                id="whatsappSameAsPhone"
                checked={sameAsPhone}
                onCheckedChange={(checked) => set({ whatsappSameAsPhone: checked === true })}
              />
              <span className="font-medium">{locale === 'en' ? 'Same as phone' : 'نفس رقم الهاتف'}</span>
            </label>
          </div>

          {!sameAsPhone ? (
            <Input
              id="whatsapp"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="70 123456"
              className="text-start"
              invalid={Boolean(errors['contact.whatsapp'])}
              value={str(value.whatsapp)}
              onChange={(e) => set({ whatsapp: e.target.value })}
            />
          ) : (
            <div className="flex h-10 items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-3 text-xs text-muted-foreground">
              {locale === 'en' ? '✓ Using primary phone for WhatsApp' : '✓ يتم استخدام رقم الهاتف الأساسي للواتساب'}
            </div>
          )}
          {errors['contact.whatsapp'] ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive">
              {errors['contact.whatsapp']}
            </p>
          ) : null}
        </div>

        {/*
          A second number, and whose it is.

          The register keys a household by one phone, and when that number dies
          the municipality has nothing left but a رقم مرجعي on a slip somebody
          may have thrown away. Asking once, here, costs a sentence.

          The relation is asked alongside it because a bare second number nobody
          can place is one a clerk will not ring — and because a wife giving her
          husband's mobile here is, weeks before he ever registers, the strongest
          single clue that the two belong to one household.
        */}
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <Field
            label={locale === 'en' ? 'Alternate Number' : 'رقم بديل'}
            htmlFor="altPhone"
            path="contact.altPhone"
            error={errors['contact.altPhone']}
          >
            <Input
              id="altPhone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="07 740123"
              className="text-start"
              invalid={Boolean(errors['contact.altPhone'])}
              value={str(value.altPhone)}
              onChange={(e) => set({ altPhone: e.target.value })}
            />
          </Field>

          <Field
            label={locale === 'en' ? 'Whose Number' : 'صلة صاحب الرقم'}
            htmlFor="altPhoneRelation"
            path="contact.altPhoneRelation"
            error={errors['contact.altPhoneRelation']}
          >
            <Input
              id="altPhoneRelation"
              placeholder={locale === 'en' ? 'e.g. his son' : 'مثال: ابنه'}
              invalid={Boolean(errors['contact.altPhoneRelation'])}
              value={str(value.altPhoneRelation)}
              onChange={(e) => set({ altPhoneRelation: e.target.value })}
            />
          </Field>
        </div>
      </div>

      {/* 2. Marital Status & Family size */}
      <Field
        label={locale === 'en' ? 'Marital Status' : 'الحالة الاجتماعية'}
        htmlFor="maritalStatus"
        path="contact.maritalStatus"
        required
        error={errors['contact.maritalStatus']}
      >
        <SegmentedControl
          value={str(value.maritalStatus)}
          invalid={Boolean(errors['contact.maritalStatus'])}
          onChange={(next) => set({ maritalStatus: next })}
          options={MARITAL_STATUS.map((o) => ({
            value: o,
            label: labels.maritalStatus[o] ?? o,
          }))}
        />
      </Field>

      {/*
        The question that beats every clue the resolver can assemble.

        A person knows their own household perfectly, and the رقم مرجعي is
        already printed on the slip their relative was given — so one optional
        field settles what no amount of name matching can. Everything
        probabilistic is the fallback for when this goes unanswered.

        `householdMatch` is the banner that prompts the officer to ask; it is
        rendered by the caller because only the staff form has a session to
        query the register with.
      */}
      {householdMatch}

      {/*
        The staff form supplies a version of this field that verifies the number
        as it is typed — see `HouseholdReferenceField`. The plain input below is
        the fallback for any caller without a session to look it up with, and it
        still validates on save; what it cannot do is tell the officer whose
        number this is while the citizen is still standing there.
      */}
      {householdReferenceField ?? (
        <Field
          label={
            locale === 'en'
              ? 'Already-registered family member (reference no.)'
              : 'رقم مرجعي لأحد أفراد الأسرة المسجّلين'
          }
          htmlFor="householdReference"
          path="contact.householdReference"
          error={errors['contact.householdReference']}
          hint={
            locale === 'en'
              ? 'Ask the citizen. Leave blank if nobody in the family is registered yet.'
              : 'اسأل المواطن. اتركه فارغاً إن لم يكن أحد من الأسرة مسجّلاً بعد.'
          }
        >
          <Input
            id="householdReference"
            dir="ltr"
            placeholder="BZR-2609-RXT2TF"
            className="text-start max-w-xs uppercase"
            invalid={Boolean(errors['contact.householdReference'])}
            value={str(value.householdReference)}
            onChange={(e) => set({ householdReference: e.target.value })}
          />
        </Field>
      )}

      <HouseholdRoster
        members={asMembers(value.householdMembers)}
        errors={errors}
        locale={locale}
        onChange={(next) => set({ householdMembers: next })}
      />

      {/*
        The count, asked only when nobody was named.

        A form carrying both a roster and a free-typed number can contradict
        itself, and no reader downstream would know which the municipality
        believed. Where the household has been enumerated this becomes a derived
        figure the officer can see and cannot mistype; where it has not, it is
        still the only thing known about the home and is still required.
      */}
      {asMembers(value.householdMembers).length > 0 ? (
        <Field
          label={locale === 'en' ? 'Household Size' : 'عدد أفراد الأسرة (المقيمين في المنزل)'}
          htmlFor="familySizeDerived"
        >
          <div
            id="familySizeDerived"
            className="flex h-10 max-w-xs items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-3 text-xs text-muted-foreground"
          >
            {locale === 'en'
              ? `✓ ${residentCountOf({ householdMembers: asMembers(value.householdMembers) }) ?? 0} (including registrant) — from the household list`
              : `✓ ${residentCountOf({ householdMembers: asMembers(value.householdMembers) }) ?? 0} (بمن فيهم المواطن) — محتسب من قائمة أفراد الأسرة`}
          </div>
        </Field>
      ) : (
        <Field
          label={locale === 'en' ? 'Household Size' : 'عدد أفراد الأسرة (المقيمين في المنزل)'}
          htmlFor="familySize"
          path="contact.familySize"
          required
          error={errors['contact.familySize']}
        >
          <Input
            id="familySize"
            inputMode="numeric"
            dir="ltr"
            placeholder={locale === 'en' ? 'e.g. 4' : 'مثال: ٤'}
            className="text-start max-w-xs"
            invalid={Boolean(errors['contact.familySize'])}
            value={str(value.familySize)}
            onChange={(e) => set({ familySize: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}

/** One row of the roster, as the form holds it. */
interface MemberDraft {
  /** Present on a row already stored; absent on one being added now. */
  id?: string;
  fullName?: string;
  relationToHead?: string;
  birthYear?: string | number;
  gender?: string;
  residesHere?: boolean;
  /**
   * Set when this roster row is a citizen with a file of their own.
   *
   * Such a row is rendered read-only: this form edits one citizen, and letting
   * it rename or delete another would be one person's record rewriting
   * somebody else's. Removing them is `unlink`, which is its own act with its
   * own reason.
   */
  citizenId?: string | null;
}

function asMembers(value: unknown): MemberDraft[] {
  return Array.isArray(value) ? (value as MemberDraft[]) : [];
}

/**
 * أفراد الأسرة — who lives here, not merely how many.
 *
 * The field this replaces was an integer, and an integer is the one shape this
 * fact cannot survive in: an officer who writes «٦» has recorded that six
 * people live here and destroyed the only chance anyone will get to learn who
 * they are. The visit happens once.
 *
 * Four inputs a row, and none of them required — a household the officer could
 * only half enumerate is worth more than one they skipped because the form
 * demanded a birth year nobody present knew.
 */
function HouseholdRoster({
  members,
  errors,
  locale,
  onChange,
}: {
  members: MemberDraft[];
  errors: Errors;
  locale: string;
  onChange: (next: MemberDraft[]) => void;
}) {
  const labels = getLabels(locale);
  const en = locale === 'en';

  const patch = (index: number, next: Partial<MemberDraft>) =>
    onChange(members.map((member, i) => (i === index ? { ...member, ...next } : member)));

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-card p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-xs font-medium text-foreground/90">
            {en ? 'Household Members' : 'أفراد الأسرة'}
          </Label>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {en
              ? 'Everyone in the family, including those living abroad.'
              : 'كل أفراد الأسرة، بمن فيهم المقيمون خارج البلدة. لا يُدرج المواطن نفسه.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...members, { residesHere: true }])}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {en ? '+ Add member' : '+ إضافة فرد'}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          {en
            ? 'No members listed — the household size below will be used instead.'
            : 'لم يُدرَج أي فرد — سيُعتمد عدد أفراد الأسرة أدناه بدلاً من ذلك.'}
        </p>
      ) : null}

      <div className="space-y-2.5">
        {members.map((member, index) => {
          const registered = Boolean(member.citizenId);
          return (
            <div
              key={member.id ?? index}
              className="grid gap-2 rounded-md border border-border/60 bg-background/60 p-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-end"
            >
              <Field
                label={en ? 'Full name' : 'الاسم الكامل'}
                htmlFor={`member-${index}-name`}
                error={errors[`contact.householdMembers.${index}.fullName`]}
              >
                <Input
                  id={`member-${index}-name`}
                  disabled={registered}
                  placeholder={en ? 'e.g. Hussein Ali Khalil' : 'مثال: حسين علي خليل'}
                  invalid={Boolean(errors[`contact.householdMembers.${index}.fullName`])}
                  value={str(member.fullName)}
                  onChange={(e) => patch(index, { fullName: e.target.value })}
                />
              </Field>

              <Field label={en ? 'Relation' : 'صلة القرابة'} htmlFor={`member-${index}-relation`}>
                <Select
                  value={str(member.relationToHead)}
                  onValueChange={(next) => patch(index, { relationToHead: next })}
                >
                  <SelectTrigger id={`member-${index}-relation`} disabled={registered}>
                    <SelectValue placeholder={en ? 'Relation…' : 'الصلة…'} />
                  </SelectTrigger>
                  <SelectContent side="bottom" position="popper">
                    {HOUSEHOLD_RELATION.filter((relation) => relation !== 'HEAD').map((relation) => (
                      <SelectItem key={relation} value={relation}>
                        {labels.householdRelation?.[relation] ?? relation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/*
                A year, not a date. The person answering is describing somebody
                else and reliably knows the year — asking for the day produces a
                confident wrong answer, and a wrong birth date is worse than an
                absent one because it is what identity is matched on.
              */}
              <Field label={en ? 'Birth year' : 'سنة الولادة'} htmlFor={`member-${index}-year`}>
                <Input
                  id={`member-${index}-year`}
                  inputMode="numeric"
                  dir="ltr"
                  disabled={registered}
                  placeholder={en ? '1990' : '١٩٩٠'}
                  className="text-start"
                  value={str(member.birthYear ?? '')}
                  onChange={(e) => patch(index, { birthYear: e.target.value })}
                />
              </Field>

              <Field label={en ? 'Sex' : 'الجنس'} htmlFor={`member-${index}-gender`}>
                <Select
                  value={str(member.gender)}
                  onValueChange={(next) => patch(index, { gender: next })}
                >
                  <SelectTrigger id={`member-${index}-gender`} disabled={registered}>
                    <SelectValue placeholder={en ? 'Sex…' : 'الجنس…'} />
                  </SelectTrigger>
                  <SelectContent side="bottom" position="popper">
                    {GENDER.map((option) => (
                      <SelectItem key={option} value={option}>
                        {labels.gender[option] ?? option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-end sm:pb-1">
                <label className="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground">
                  <Checkbox
                    checked={member.residesHere !== false}
                    onCheckedChange={(checked) => patch(index, { residesHere: checked === true })}
                  />
                  <span>{en ? 'Lives here' : 'مقيم هنا'}</span>
                </label>

                {registered ? (
                  <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {en ? 'registered' : 'مسجَّل'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange(members.filter((_, i) => i !== index))}
                    className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {en ? 'Remove' : 'حذف'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Step 4 — المستندات */

/*
 * `DocumentsStep`, `ReviewStep` and `DeclarationStep` were here, along with
 * the `FileField` / `ReviewBlock` helpers they used.
 *
 * They were steps 4, 5 and 6 of the citizen wizard: attach the proofs,
 * re-read everything, then sign the الإقرار and send. A clerk entering a
 * record from papers on the counter has no browser `File` objects to attach,
 * reviews the form itself rather than a summary of it, and cannot sign a
 * declaration on someone else's behalf — so all three lost their subject
 * with the wizard.
 *
 * The two that remain are shared: `CitizenForm` renders them as sections 1
 * and 2 of the staff entry page, which is what keeps the conditional fields
 * (رقم السجل only for a Lebanese citizen, صفة الإقامة gating خيمة) identical
 * to what the wizard enforced.
 */