'use client';

import { useCallback, useEffect } from 'react';
import { getLabels } from '@mechanization/shared-schemas';
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
    ? (['VILLAGE_RESIDENT', 'DISPLACED'] as const)
    : (['VILLAGE_RESIDENT', 'DISPLACED', 'REFUGEE'] as const);

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
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-3">
        <Field
          label={locale === 'en' ? 'First Name' : 'الاسم الأول'}
          htmlFor="firstName"
          required
          error={errors['personal.firstName']}
        >
          <Input
            id="firstName"
            invalid={Boolean(errors['personal.firstName'])}
            value={str(value.firstName)}
            onChange={(e) => set({ firstName: e.target.value })}
          />
        </Field>

        <Field
          label={locale === 'en' ? "Father's Name" : 'اسم الأب'}
          htmlFor="middleName"
          error={errors['personal.middleName']}
        >
          <Input
            id="middleName"
            value={str(value.middleName)}
            onChange={(e) => set({ middleName: e.target.value })}
          />
        </Field>

        <Field
          label={locale === 'en' ? 'Last Name' : 'الشهرة'}
          htmlFor="lastName"
          required
          error={errors['personal.lastName']}
        >
          <Input
            id="lastName"
            invalid={Boolean(errors['personal.lastName'])}
            value={str(value.lastName)}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </Field>
      </div>

      <Field
        label={locale === 'en' ? 'Gender' : 'الجنس'}
        htmlFor="gender"
        required
        error={errors['personal.gender']}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(['MALE', 'FEMALE'] as const).map((option) => (
            <ChoiceCard
              key={option}
              name="gender"
              value={option}
              checked={value.gender === option}
              onChange={(v) => set({ gender: v })}
              title={labels.gender[option]}
            />
          ))}
        </div>
      </Field>

      <Field
        label={locale === 'en' ? 'Nationality' : 'الجنسية'}
        htmlFor="isLebanese"
        required
        error={errors['personal.isLebanese']}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            name="isLebanese"
            value="LEBANESE"
            checked={isLebanese}
            onChange={() => set({ isLebanese: true, residencyNumber: undefined })}
            title={locale === 'en' ? 'Lebanese' : 'لبناني'}
          />
          <ChoiceCard
            name="isLebanese"
            value="FOREIGN"
            checked={!isLebanese}
            onChange={() => set({ isLebanese: false, civilRecordNumber: undefined })}
            title={locale === 'en' ? 'Non-Lebanese / Foreign' : 'أجنبي'}
          />
        </div>
      </Field>

      {!isLebanese ? (
        <Field
          label={locale === 'en' ? 'Nationality' : 'الجنسية'}
          htmlFor="nationality"
          required
          hint={locale === 'en' ? 'e.g. Syrian, Egyptian, Palestinian' : 'مثال: سوري، مصري، فلسطيني'}
          error={errors['personal.nationality']}
        >
          <Input
            id="nationality"
            invalid={Boolean(errors['personal.nationality'])}
            value={value.nationality === 'لبناني' || value.nationality === 'Lebanese' ? '' : str(value.nationality)}
            onChange={(e) => set({ nationality: e.target.value })}
          />
        </Field>
      ) : null}

      <Field
        label={locale === 'en' ? 'Residency Status' : 'صفة الإقامة'}
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
              title={labels.residentStatus[option]}
            />
          ))}
        </div>
      </Field>

      {isLebanese ? (
        <Field
          label={locale === 'en' ? 'ID Document Type' : 'نوع وثيقة الإثبات'}
          htmlFor="identityDocType"
          required
          error={errors['personal.identityDocType']}
        >
          <Select
            value={str(value.identityDocType)}
            onValueChange={(next) => set({ identityDocType: next })}
          >
            <SelectTrigger id="identityDocType">
              <SelectValue placeholder={locale === 'en' ? 'Select…' : 'اختر…'} />
            </SelectTrigger>
            <SelectContent>
              {(['NATIONAL_ID', 'FAMILY_RECORD', 'DRIVER_LICENSE', 'PASSPORT'] as const).map(
                (o) => (
                  <SelectItem key={o} value={o}>
                    {labels.identityDocType[o]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

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
            label={locale === 'en' ? 'Civil Record (Sijil) No.' : 'رقم السجل'}
            htmlFor="civilRecordNumber"
            required
            error={errors['personal.civilRecordNumber']}
          >
            <Input
              id="civilRecordNumber"
              inputMode="numeric"
              placeholder={locale === 'en' ? 'Usually 1-3 digits' : '١-٣ أرقام عادةً'}
              invalid={Boolean(errors['personal.civilRecordNumber'])}
              value={str(value.civilRecordNumber)}
              onChange={(e) => set({ civilRecordNumber: e.target.value })}
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {locale === 'en'
              ? 'Entering either passport number or residency number is sufficient.'
              : 'يكفي إدخال رقم جواز السفر أو رقم الإقامة — لا حاجة لإدخال كليهما.'}
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
              label={locale === 'en' ? 'Residency Permit No.' : 'رقم الإقامة'}
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
  locale = 'ar',
}: {
  value: Values;
  errors: Errors;
  onChange: (next: Values) => void;
  locale?: string;
}) {
  const labels = getLabels(locale);
  const set = (patch: Values) => onChange({ ...value, ...patch });
  const sameAsPhone = value.whatsappSameAsPhone !== false;

  return (
    <div className="space-y-6">
      <Field
        label={locale === 'en' ? 'Marital Status' : 'الحالة الاجتماعية'}
        htmlFor="maritalStatus"
        required
        error={errors['contact.maritalStatus']}
      >
        <Select
          value={str(value.maritalStatus)}
          onValueChange={(next) => set({ maritalStatus: next })}
        >
          <SelectTrigger id="maritalStatus">
            <SelectValue placeholder={locale === 'en' ? 'Select…' : 'اختر…'} />
          </SelectTrigger>
          <SelectContent>
            {(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const).map((o) => (
              <SelectItem key={o} value={o}>
                {labels.maritalStatus[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label={locale === 'en' ? 'Phone Number' : 'رقم الهاتف'}
        htmlFor="phone"
        required
        hint={locale === 'en' ? 'We will send login code and reference number here' : 'سنرسل إليه رمز الدخول والرقم المرجعي'}
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
        <Label htmlFor="whatsappSameAsPhone">
          {locale === 'en' ? 'WhatsApp number is the same' : 'رقم الواتساب هو نفسه'}
        </Label>
      </div>

      {!sameAsPhone ? (
        <Field
          label={locale === 'en' ? 'WhatsApp Number' : 'رقم الواتساب'}
          htmlFor="whatsapp"
          required
          error={errors['contact.whatsapp']}
        >
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
        label={locale === 'en' ? 'Household Size' : 'عدد أفراد الأسرة'}
        htmlFor="familySize"
        required
        hint={locale === 'en' ? 'Including yourself' : 'بمن فيهم أنت'}
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