'use client';

import { useEffect } from 'react';
import { ar } from '@mechanization/shared-schemas';
import { Checkbox } from '@/components/ui/checkbox';
import { ChoiceCard, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Values = Record<string, unknown>;
type Errors = Record<string, string>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Step 1 — البيانات الشخصية ومعلومات الإثبات */
export function PersonalStep({
  value,
  errors,
  onChange,
}: {
  value: Values;
  errors: Errors;
  onChange: (next: Values) => void;
}) {
  const set = (patch: Values) => onChange({ ...value, ...patch });
  const isLebanese = value.isLebanese !== false;

  /**
   * صفة الإقامة options a Lebanese citizen may choose from. لاجئ describes
   * someone displaced from outside Lebanon — a Lebanese citizen cannot hold
   * that status, so the choice is not offered once لبناني is selected.
   */
  const residentStatusOptions = isLebanese
    ? (['VILLAGE_RESIDENT', 'DISPLACED'] as const)
    : (['VILLAGE_RESIDENT', 'DISPLACED', 'REFUGEE'] as const);

  /**
   * Everything downstream of "هل الشخص لبناني؟" follows automatically rather
   * than asking twice: a Lebanese citizen's nationality is لبناني by
   * definition, and a non-Lebanese person's identity document is a passport
   * in the overwhelming majority of cases — رقم الهوية اللبنانية and إخراج
   * القيد do not apply to them at all. Re-deriving both here means the citizen
   * only ever answers the nationality question once.
   *
   * Switching to لبناني also clears صفة الإقامة if it was لاجئ: that option is
   * no longer offered, and a value left over from before the switch would
   * otherwise reach the server unseen rather than being caught here, where the
   * citizen can immediately pick a real answer.
   */
  useEffect(() => {
    if (isLebanese) {
      // One merged patch, not two sequential `set()` calls: each would close
      // over the same pre-update `value`, so the second call would silently
      // undo the first instead of compounding with it.
      const patch: Values = {};
      if (value.nationality !== 'لبناني') patch.nationality = 'لبناني';
      if (value.residentStatus === 'REFUGEE') patch.residentStatus = undefined;
      if (Object.keys(patch).length > 0) set(patch);
    } else if (value.identityDocType !== 'PASSPORT') {
      set({ identityDocType: 'PASSPORT' });
    }
    // Watches the derived values themselves, not just the toggle that
    // normally changes them. Keyed on `[isLebanese]` alone this ran once on
    // mount and then never again — so when the wizard restored a saved draft
    // (a parent effect, which React runs *after* this child one) and replaced
    // `personal` wholesale, a draft missing `nationality` never got it back.
    // For a Lebanese citizen that field is not rendered at all, so the
    // resulting failure was invisible: "الجنسية مطلوبة" against an input
    // nobody could see, reported only as the generic banner on التالي.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLebanese, value.nationality, value.residentStatus, value.identityDocType]);

  const identityDocNumberLabel =
    ar.identityDocNumberLabel[value.identityDocType as never] ?? 'رقم الوثيقة';

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="الاسم الأول" htmlFor="firstName" required error={errors['personal.firstName']}>
          <Input
            id="firstName"
            invalid={Boolean(errors['personal.firstName'])}
            value={str(value.firstName)}
            onChange={(e) => set({ firstName: e.target.value })}
          />
        </Field>

        <Field label="اسم الأب" htmlFor="middleName" error={errors['personal.middleName']}>
          <Input
            id="middleName"
            value={str(value.middleName)}
            onChange={(e) => set({ middleName: e.target.value })}
          />
        </Field>

        <Field label="الشهرة" htmlFor="lastName" required error={errors['personal.lastName']}>
          <Input
            id="lastName"
            invalid={Boolean(errors['personal.lastName'])}
            value={str(value.lastName)}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </Field>
      </div>

      <Field label="الجنس" htmlFor="gender" required error={errors['personal.gender']}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['MALE', 'FEMALE'] as const).map((option) => (
            <ChoiceCard
              key={option}
              name="gender"
              value={option}
              checked={value.gender === option}
              onChange={(v) => set({ gender: v })}
              title={ar.gender[option]}
            />
          ))}
        </div>
      </Field>

      {/**
       * Asked before anything about identity documents, because it decides
       * which of those apply: رقم السجل only makes sense for a Lebanese
       * citizen, and رقم الإقامة only for someone who is not one.
       */}
      <Field label="الجنسية" htmlFor="isLebanese" required error={errors['personal.isLebanese']}>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            name="isLebanese"
            value="LEBANESE"
            checked={isLebanese}
            onChange={() => set({ isLebanese: true, residencyNumber: undefined })}
            title="لبناني"
          />
          <ChoiceCard
            name="isLebanese"
            value="FOREIGN"
            checked={!isLebanese}
            onChange={() => set({ isLebanese: false, civilRecordNumber: undefined })}
            title="أجنبي"
          />
        </div>
      </Field>

      {!isLebanese ? (
        <Field
          label="الجنسية"
          htmlFor="nationality"
          required
          hint="مثال: سوري، مصري، فلسطيني"
          error={errors['personal.nationality']}
        >
          <Input
            id="nationality"
            invalid={Boolean(errors['personal.nationality'])}
            value={value.nationality === 'لبناني' ? '' : str(value.nationality)}
            onChange={(e) => set({ nationality: e.target.value })}
          />
        </Field>
      ) : null}

      {/**
       * صفة الإقامة describes the person, never the property — a refugee may
       * still own an apartment, so this never gates the property step.
       */}
      <Field
        label="صفة الإقامة"
        htmlFor="residentStatus"
        required
        error={errors['personal.residentStatus']}
      >
        <div className="grid gap-3">
          {residentStatusOptions.map((option) => (
            <ChoiceCard
              key={option}
              name="residentStatus"
              value={option}
              checked={value.residentStatus === option}
              onChange={(v) => set({ residentStatus: v })}
              title={ar.residentStatus[option]}
            />
          ))}
        </div>
      </Field>

      {/**
       * The type select only appears for a Lebanese citizen — a foreigner's
       * document is always treated as a passport, so there is nothing to
       * choose and one less question to ask.
       */}
      {isLebanese ? (
        <Field
          label="نوع وثيقة الإثبات"
          htmlFor="identityDocType"
          required
          error={errors['personal.identityDocType']}
        >
          <Select
            value={str(value.identityDocType)}
            onValueChange={(next) => set({ identityDocType: next })}
          >
            <SelectTrigger id="identityDocType">
              <SelectValue placeholder="اختر…" />
            </SelectTrigger>
            <SelectContent>
              {(['NATIONAL_ID', 'FAMILY_RECORD', 'DRIVER_LICENSE', 'PASSPORT'] as const).map(
                (o) => (
                  <SelectItem key={o} value={o}>
                    {ar.identityDocType[o]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {/**
       * Both columns are deliberately hint-free: a hint under only one field
       * pushes its input down relative to its neighbour, so the two boxes in
       * this row stop lining up. Guidance that used to live there is now
       * either a placeholder (which sits inside the box, adding no height) or
       * dropped as redundant once the field only appears in one branch.
       */}
      {isLebanese ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={identityDocNumberLabel}
            htmlFor="identityDocNumber"
            required
            error={errors['personal.identityDocNumber']}
          >
            <Input
              id="identityDocNumber"
              inputMode="numeric"
              invalid={Boolean(errors['personal.identityDocNumber'])}
              value={str(value.identityDocNumber)}
              onChange={(e) => set({ identityDocNumber: e.target.value })}
            />
          </Field>

          <Field
            label="رقم السجل"
            htmlFor="civilRecordNumber"
            required
            error={errors['personal.civilRecordNumber']}
          >
            <Input
              id="civilRecordNumber"
              inputMode="numeric"
              placeholder="١-٣ أرقام عادةً"
              invalid={Boolean(errors['personal.civilRecordNumber'])}
              value={str(value.civilRecordNumber)}
              onChange={(e) => set({ civilRecordNumber: e.target.value })}
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          {/**
           * Neither field is individually required here — only one of the two
           * has to be filled. A foreigner without a passport on hand still has
           * a رقم إقامة, and one without a residency permit yet still has a
           * passport; asking for both would block someone who has already
           * given the municipality a usable identifier.
           */}
          <p className="text-sm text-muted-foreground">
            يكفي إدخال رقم جواز السفر أو رقم الإقامة — لا حاجة لإدخال كليهما.
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={identityDocNumberLabel}
              htmlFor="identityDocNumber"
              error={errors['personal.identityDocNumber']}
            >
              <Input
                id="identityDocNumber"
                inputMode="numeric"
                invalid={Boolean(errors['personal.identityDocNumber'])}
                value={str(value.identityDocNumber)}
                onChange={(e) => set({ identityDocNumber: e.target.value })}
              />
            </Field>

            <Field
              label="رقم الإقامة"
              htmlFor="residencyNumber"
              error={errors['personal.residencyNumber']}
            >
              <Input
                id="residencyNumber"
                invalid={Boolean(errors['personal.residencyNumber'])}
                value={str(value.residencyNumber)}
                onChange={(e) => set({ residencyNumber: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 2 — معلومات التواصل والأسرة */
export function ContactStep({
  value,
  errors,
  onChange,
}: {
  value: Values;
  errors: Errors;
  onChange: (next: Values) => void;
}) {
  const set = (patch: Values) => onChange({ ...value, ...patch });
  const sameAsPhone = value.whatsappSameAsPhone !== false;

  return (
    <div className="space-y-6">
      <Field
        label="الحالة الاجتماعية"
        htmlFor="maritalStatus"
        required
        error={errors['contact.maritalStatus']}
      >
        <Select
          value={str(value.maritalStatus)}
          onValueChange={(next) => set({ maritalStatus: next })}
        >
          <SelectTrigger id="maritalStatus">
            <SelectValue placeholder="اختر…" />
          </SelectTrigger>
          <SelectContent>
            {(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const).map((o) => (
              <SelectItem key={o} value={o}>
                {ar.maritalStatus[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="رقم الهاتف"
        htmlFor="phone"
        required
        hint="سنرسل إليه رمز الدخول والرقم المرجعي"
        error={errors['contact.phone']}
      >
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          placeholder="03 123456"
          className="text-start"
          invalid={Boolean(errors['contact.phone'])}
          value={str(value.phone)}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </Field>

      <div className="flex min-h-touch items-center gap-3">
        <Checkbox
          id="whatsappSameAsPhone"
          checked={sameAsPhone}
          onCheckedChange={(checked) => set({ whatsappSameAsPhone: checked === true })}
        />
        <Label htmlFor="whatsappSameAsPhone">رقم الواتساب هو نفسه</Label>
      </div>

      {!sameAsPhone ? (
        <Field label="رقم الواتساب" htmlFor="whatsapp" required error={errors['contact.whatsapp']}>
          <Input
            id="whatsapp"
            type="tel"
            inputMode="tel"
            dir="ltr"
            className="text-start"
            invalid={Boolean(errors['contact.whatsapp'])}
            value={str(value.whatsapp)}
            onChange={(e) => set({ whatsapp: e.target.value })}
          />
        </Field>
      ) : null}

      <Field
        label="عدد أفراد الأسرة"
        htmlFor="familySize"
        required
        hint="بمن فيهم أنت"
        error={errors['contact.familySize']}
      >
        <Input
          id="familySize"
          inputMode="numeric"
          invalid={Boolean(errors['contact.familySize'])}
          value={str(value.familySize)}
          onChange={(e) => set({ familySize: e.target.value })}
        />
      </Field>
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
 * declaration on someone else''s behalf — so all three lost their subject
 * with the wizard.
 *
 * The two that remain are shared: `CitizenForm` renders them as sections 1
 * and 2 of the staff entry page, which is what keeps the conditional fields
 * (رقم السجل only for a Lebanese citizen, صفة الإقامة gating خيمة) identical
 * to what the wizard enforced.
 */