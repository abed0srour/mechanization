'use client';

import { ar } from '@mechanization/shared-schemas';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChoiceCard, Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import type { PropertyDraft } from './property-card';
import type { WizardData } from './registration-wizard';

type Values = Record<string, unknown>;
type Errors = Record<string, string>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Step indices, named. The review step links back to each section, and after
 * the location step was removed those numbers all shifted — a bare `onJump(4)`
 * is exactly the kind of thing that silently starts pointing at the wrong page.
 */
export const STEP_INDEX = {
  personal: 0,
  contact: 1,
  properties: 2,
  documents: 3,
  review: 4,
  declaration: 5,
} as const;

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
          {(['VILLAGE_RESIDENT', 'DISPLACED', 'REFUGEE'] as const).map((option) => (
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

      <Field
        label="نوع وثيقة الإثبات"
        htmlFor="identityDocType"
        required
        error={errors['personal.identityDocType']}
      >
        <Select
          id="identityDocType"
          value={str(value.identityDocType)}
          onChange={(e) => set({ identityDocType: e.target.value })}
        >
          <option value="">اختر…</option>
          {(['NATIONAL_ID', 'FAMILY_RECORD', 'DRIVER_LICENSE', 'PASSPORT'] as const).map((o) => (
            <option key={o} value={o}>
              {ar.identityDocType[o]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="رقم الوثيقة"
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
          hint="عادةً رقم قصير من خانة إلى ثلاث خانات"
          error={errors['personal.civilRecordNumber']}
        >
          <Input
            id="civilRecordNumber"
            inputMode="numeric"
            invalid={Boolean(errors['personal.civilRecordNumber'])}
            value={str(value.civilRecordNumber)}
            onChange={(e) => set({ civilRecordNumber: e.target.value })}
          />
        </Field>
      </div>

      <Field label="الجنسية" htmlFor="nationality" required error={errors['personal.nationality']}>
        <Input
          id="nationality"
          invalid={Boolean(errors['personal.nationality'])}
          value={str(value.nationality)}
          onChange={(e) => set({ nationality: e.target.value })}
        />
      </Field>

      <label className="flex min-h-touch items-center gap-3">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[hsl(var(--primary))]"
          checked={isLebanese}
          onChange={(e) => set({ isLebanese: e.target.checked })}
        />
        <span>لبناني الجنسية</span>
      </label>

      {!isLebanese ? (
        <Field
          label="رقم الإقامة"
          htmlFor="residencyNumber"
          required
          hint="مطلوب لغير اللبنانيين"
          error={errors['personal.residencyNumber']}
        >
          <Input
            id="residencyNumber"
            invalid={Boolean(errors['personal.residencyNumber'])}
            value={str(value.residencyNumber)}
            onChange={(e) => set({ residencyNumber: e.target.value })}
          />
        </Field>
      ) : null}
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

      <label className="flex min-h-touch items-center gap-3">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[hsl(var(--primary))]"
          checked={sameAsPhone}
          onChange={(e) => set({ whatsappSameAsPhone: e.target.checked })}
        />
        <span>رقم الواتساب هو نفسه</span>
      </label>

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
export function DocumentsStep({
  properties,
  files,
  requiredDocuments,
  draftRestored,
  onChange,
}: {
  properties: PropertyDraft[];
  files: Record<string, File>;
  requiredDocuments: string[];
  draftRestored: boolean;
  onChange: (next: Record<string, File>) => void;
}) {
  const set = (field: string, file: File | null) => {
    const next = { ...files };
    if (file) next[field] = file;
    else delete next[field];
    onChange(next);
  };

  return (
    <div className="space-y-6">
      {draftRestored ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          الملفات لا تُحفظ مع المسودة — يرجى إرفاقها من جديد.
        </p>
      ) : null}

      <FileField
        field="identity"
        label="وثيقة إثبات الهوية"
        hint="صورة واضحة أو ملف PDF"
        required={requiredDocuments.includes('IDENTITY')}
        file={files.identity}
        onChange={set}
      />

      {properties.map((property, index) => {
        // Which proof is required follows from occupancy — the same rule the
        // domain enforces server-side, so the form never asks for the wrong one.
        const isTenant = property.occupancyType === 'TENANT';
        const field = isTenant ? `contract-${index}` : `proof-${index}`;

        return (
          <FileField
            key={field}
            field={field}
            label={`${isTenant ? 'عقد الإيجار' : 'سند الملكية'} — العقار ${index + 1}`}
            hint={property.propertyNumber ? `رقم العقار ${property.propertyNumber}` : undefined}
            required
            file={files[field]}
            onChange={set}
          />
        );
      })}

      <FileField
        field="extra"
        label="صورة إضافية"
        hint="اختياري — أي مستند داعم آخر"
        file={files.extra}
        onChange={set}
      />
    </div>
  );
}

function FileField({
  field,
  label,
  hint,
  required,
  file,
  onChange,
}: {
  field: string;
  label: string;
  hint?: string;
  required?: boolean;
  file?: File;
  onChange: (field: string, file: File | null) => void;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={field} required={required}>
      <input
        id={field}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        className="flex min-h-touch w-full rounded-md border border-input bg-background p-3 text-base file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
        onChange={(e) => onChange(field, e.target.files?.[0] ?? null)}
      />
      {file ? (
        <p className="text-sm font-medium text-success">
          {file.name} ({Math.round(file.size / 1024)} كيلوبايت)
        </p>
      ) : null}
    </Field>
  );
}

/** Step 5 — المراجعة */
export function ReviewStep({
  data,
  files,
  onJump,
}: {
  data: WizardData;
  files: Record<string, File>;
  onJump: (step: number) => void;
}) {
  const personal = data.personal;
  const contact = data.contact;

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        راجع بياناتك قبل الإرسال. اضغط «تعديل» لتصحيح أي قسم.
      </p>

      <ReviewBlock title="البيانات الشخصية" onEdit={() => onJump(STEP_INDEX.personal)}>
        <Row
          label="الاسم"
          value={[personal.firstName, personal.middleName, personal.lastName]
            .filter(Boolean)
            .join(' ')}
        />
        <Row
          label="صفة الإقامة"
          value={ar.residentStatus[personal.residentStatus as never] ?? '—'}
        />
        <Row label="رقم الوثيقة" value={str(personal.identityDocNumber)} />
      </ReviewBlock>

      <ReviewBlock title="التواصل والأسرة" onEdit={() => onJump(STEP_INDEX.contact)}>
        <Row label="الهاتف" value={str(contact.phone)} />
        <Row label="عدد الأفراد" value={str(contact.familySize)} />
      </ReviewBlock>

      <ReviewBlock
        title={`العقارات (${data.properties.length})`}
        onEdit={() => onJump(STEP_INDEX.properties)}
      >
        {data.properties.map((property, index) => (
          <Row
            key={index}
            label={`العقار ${index + 1}`}
            value={[
              property.propertyType ? ar.propertyType[property.propertyType] : '—',
              property.propertyNumber ? `رقم ${property.propertyNumber}` : null,
            ]
              .filter(Boolean)
              .join(' — ')}
          />
        ))}
      </ReviewBlock>

      <ReviewBlock
        title={`المستندات (${Object.keys(files).length})`}
        onEdit={() => onJump(STEP_INDEX.documents)}
      >
        {Object.entries(files).map(([field, file]) => (
          <Row key={field} label={field} value={file.name} />
        ))}
        {Object.keys(files).length === 0 ? (
          <p className="text-destructive">لم تُرفق أي مستندات.</p>
        ) : null}
      </ReviewBlock>
    </div>
  );
}

function ReviewBlock({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <header className="mb-3 flex items-center justify-between border-b pb-2">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="link" size="sm" onClick={onEdit}>
            تعديل
          </Button>
        </header>
        <dl className="space-y-1">{children}</dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{value || '—'}</dd>
    </div>
  );
}

/** Step 6 — الإقرار والإرسال */
export function DeclarationStep({
  submitting,
  supportPhone,
  onSubmit,
}: {
  submitting: boolean;
  supportPhone?: string;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-5">
          <h3 className="text-lg font-semibold">إقرار</h3>
          <p className="mt-3">
            أقرّ بأن جميع المعلومات والمستندات المقدَّمة صحيحة وكاملة، وأتحمّل المسؤولية
            القانونية عن أي معلومات غير صحيحة.
          </p>
        </CardContent>
      </Card>

      <Button size="xl" className="w-full" disabled={submitting} onClick={onSubmit}>
        {submitting ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden />
            جارٍ الإرسال…
          </>
        ) : (
          'أقرّ وأرسل الطلب'
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        بعد الإرسال ستحصل على رقم مرجعي لمتابعة طلبك.
        {supportPhone ? ` للمساعدة: ${supportPhone}` : null}
      </p>
    </div>
  );
}
