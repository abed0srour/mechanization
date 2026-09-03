'use client';

import { useCallback, useEffect } from 'react';
import {
  BLOOD_TYPE,
  GENDER,
  getLabels,
  IDENTITY_DOC_TYPE,
  MARITAL_STATUS,
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
    <div className="space-y-4">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <Field
          label={locale === 'en' ? 'First Name' : 'الاسم الأول'}
          htmlFor="firstName"

          path="personal.firstName"
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

          path="personal.middleName"
          required
          error={errors['personal.middleName']}
        >
          <Input
            id="middleName"
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
            invalid={Boolean(errors['personal.lastName'])}
            value={str(value.lastName)}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label={locale === 'en' ? 'Gender' : 'الجنس'}
          htmlFor="gender"

          path="personal.gender"
          required
          error={errors['personal.gender']}
        >
          <Select
            value={str(value.gender)}
            onValueChange={(next) => set({ gender: next })}
          >
            <SelectTrigger id="gender" className={errors['personal.gender'] ? 'border-destructive' : ''}>
              <SelectValue placeholder={locale === 'en' ? 'Select gender…' : 'اختر الجنس…'} />
            </SelectTrigger>
            <SelectContent>
              {GENDER.map((option) => (
                <SelectItem key={option} value={option}>
                  {labels.gender[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

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

        <Field
          label={locale === 'en' ? 'Nationality' : 'الجنسية'}
          htmlFor="isLebanese"

          path="personal.isLebanese"
          required
          error={errors['personal.isLebanese']}
        >
          <Select
            value={isLebanese ? 'LEBANESE' : 'FOREIGN'}
            onValueChange={(next) => {
              const isLeb = next === 'LEBANESE';
              if (isLeb) {
                set({ isLebanese: true, residencyNumber: undefined });
              } else {
                set({ isLebanese: false, civilRecordNumber: undefined });
              }
            }}
          >
            <SelectTrigger id="isLebanese" className={errors['personal.isLebanese'] ? 'border-destructive' : ''}>
              <SelectValue placeholder={locale === 'en' ? 'Select…' : 'اختر…'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LEBANESE">{locale === 'en' ? 'Lebanese' : 'لبناني'}</SelectItem>
              <SelectItem value="FOREIGN">{locale === 'en' ? 'Non-Lebanese' : 'أجنبي'}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={locale === 'en' ? 'Residency Status' : 'صفة الإقامة'}
          htmlFor="residentStatus"

          path="personal.residentStatus"
          required
          error={errors['personal.residentStatus']}
        >
          <Select
            value={str(value.residentStatus)}
            onValueChange={(next) => set({ residentStatus: next })}
          >
            <SelectTrigger id="residentStatus" className={errors['personal.residentStatus'] ? 'border-destructive' : ''}>
              <SelectValue placeholder={locale === 'en' ? 'Select…' : 'اختر…'} />
            </SelectTrigger>
            <SelectContent>
              {residentStatusOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {labels.residentStatus[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

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
            placeholder={locale === 'en' ? 'e.g. Syrian, Egyptian, Palestinian' : 'مثال: سوري، مصري، فلسطيني'}
            invalid={Boolean(errors['personal.nationality'])}
            value={value.nationality === 'لبناني' || value.nationality === 'Lebanese' ? '' : str(value.nationality)}
            onChange={(e) => set({ nationality: e.target.value })}
          />
        </Field>
      ) : null}

      {isLebanese ? (
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field
            label={locale === 'en' ? 'ID Document Type' : 'نوع وثيقة الإثبات'}
            htmlFor="identityDocType"

            path="personal.identityDocType"
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
                {IDENTITY_DOC_TYPE.map(
                  (o) => (
                    <SelectItem key={o} value={o}>
                      {labels.identityDocType[o]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>

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
              invalid={Boolean(errors['personal.identityDocNumber'])}
              value={str(value.identityDocNumber)}
              onChange={(e) => set({ identityDocNumber: e.target.value })}
            />
          </Field>

          <Field
            label={locale === 'en' ? 'Civil Record (Sijil) No.' : 'رقم السجل'}
            htmlFor="civilRecordNumber"

            path="personal.civilRecordNumber"
            required
            error={errors['personal.civilRecordNumber']}
          >
            <Input
              id="civilRecordNumber"
              inputMode="numeric"
              placeholder={locale === 'en' ? 'Usually 1-3 digits' : '١-٣ أرقام'}
              invalid={Boolean(errors['personal.civilRecordNumber'])}
              value={str(value.civilRecordNumber)}
              onChange={(e) => set({ civilRecordNumber: e.target.value })}
            />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            label={identityDocNumberLabel}
            htmlFor="identityDocNumber"

            path="personal.identityDocNumber"
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

            path="personal.residencyNumber"
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
    <div className="space-y-4">
      <div className="grid gap-3.5 sm:grid-cols-2 items-start">
        <Field
          label={locale === 'en' ? 'Marital Status' : 'الحالة الاجتماعية'}
          htmlFor="maritalStatus"

          path="contact.maritalStatus"
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
              {MARITAL_STATUS.map((o) => (
                <SelectItem key={o} value={o}>
                  {labels.maritalStatus[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={locale === 'en' ? 'Household Size' : 'عدد أفراد الأسرة'}
          htmlFor="familySize"

          path="contact.familySize"
          required
          error={errors['contact.familySize']}
        >
          <Input
            id="familySize"
            inputMode="numeric"
            placeholder={locale === 'en' ? 'Including yourself' : 'بمن فيهم أنت'}
            invalid={Boolean(errors['contact.familySize'])}
            value={str(value.familySize)}
            onChange={(e) => set({ familySize: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 items-start">
        <Field
          label={locale === 'en' ? 'Phone Number' : 'رقم الهاتف'}
          htmlFor="phone"

          path="contact.phone"
          required
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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between h-[18px]">
            <Label htmlFor="whatsapp" className="flex items-baseline gap-1.5 text-xs font-medium text-foreground/90">
              <span>{locale === 'en' ? 'WhatsApp Number' : 'رقم الواتساب'}</span>
              <span className="text-xs font-bold text-destructive" aria-label="حقل إلزامي">*</span>
            </Label>
            <label htmlFor="whatsappSameAsPhone" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <Checkbox
                id="whatsappSameAsPhone"
                checked={sameAsPhone}
                onCheckedChange={(checked) => set({ whatsappSameAsPhone: checked === true })}
              />
              <span>{locale === 'en' ? 'Same as phone' : 'نفس رقم الهاتف'}</span>
            </label>
          </div>

          {!sameAsPhone ? (
            <Input
              id="whatsapp"
              type="tel"
              inputMode="tel"
              dir="ltr"
              placeholder="03 123456"
              className="text-start"
              invalid={Boolean(errors['contact.whatsapp'])}
              value={str(value.whatsapp)}
              onChange={(e) => set({ whatsapp: e.target.value })}
            />
          ) : (
            <div className="flex h-10 items-center rounded-md border border-dashed border-border/70 bg-muted/20 px-3 text-xs text-muted-foreground">
              {locale === 'en' ? 'Using main phone number' : 'يتم استخدام رقم الهاتف الأساسي'}
            </div>
          )}
          {errors['contact.whatsapp'] ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive">
              {errors['contact.whatsapp']}
            </p>
          ) : null}
        </div>
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
 * declaration on someone else''s behalf — so all three lost their subject
 * with the wizard.
 *
 * The two that remain are shared: `CitizenForm` renders them as sections 1
 * and 2 of the staff entry page, which is what keeps the conditional fields
 * (رقم السجل only for a Lebanese citizen, صفة الإقامة gating خيمة) identical
 * to what the wizard enforced.
 */