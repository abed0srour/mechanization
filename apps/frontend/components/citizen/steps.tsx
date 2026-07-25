'use client';

import { useState } from 'react';
import { ar } from '@mechanization/shared-schemas';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import type { PropertyDraft } from './property-card';
import type { WizardData } from './registration-wizard';

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
          value={str(value.identityDocType)}
          onValueChange={(next) => set({ identityDocType: next })}
        >
          <SelectTrigger id="identityDocType">
            <SelectValue placeholder="اختر…" />
          </SelectTrigger>
          <SelectContent>
            {(['NATIONAL_ID', 'FAMILY_RECORD', 'DRIVER_LICENSE', 'PASSPORT'] as const).map((o) => (
              <SelectItem key={o} value={o}>
                {ar.identityDocType[o]}
              </SelectItem>
            ))}
          </SelectContent>
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

      <div className="flex min-h-touch items-center gap-3">
        <Checkbox
          id="isLebanese"
          checked={isLebanese}
          onCheckedChange={(checked) => set({ isLebanese: checked === true })}
        />
        <Label htmlFor="isLebanese">لبناني الجنسية</Label>
      </div>

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

type ReviewSection = 'personal' | 'contact' | 'properties' | 'documents';

/**
 * Step 5 — المراجعة
 *
 * «تعديل» opens the section in place rather than sending the citizen back to
 * the step it came from. Jumping backwards loses the reviewer's position and
 * then strands them: having fixed a phone number on step 2 they have to walk
 * forward through every step again to reach the submit button they were
 * standing on. Editing here keeps the review as the one page that has to be
 * got right.
 */
export function ReviewStep({
  data,
  files,
  errors,
  requiredDocuments,
  draftRestored,
  onChangeData,
  onChangeFiles,
  propertyEditor,
}: {
  data: WizardData;
  files: Record<string, File>;
  errors: Errors;
  requiredDocuments: string[];
  draftRestored: boolean;
  onChangeData: (patch: Partial<WizardData>) => void;
  onChangeFiles: (next: Record<string, File>) => void;
  /** The step-3 property editor, handed in whole so the two cannot diverge. */
  propertyEditor: React.ReactNode;
}) {
  const [editing, setEditing] = useState<ReviewSection | null>(null);
  const personal = data.personal;
  const contact = data.contact;

  const toggle = (section: ReviewSection) =>
    setEditing((current) => (current === section ? null : section));

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        راجع بياناتك قبل الإرسال. اضغط «تعديل» لتصحيح أي قسم دون مغادرة هذه الصفحة.
      </p>

      <ReviewBlock
        title="البيانات الشخصية"
        editing={editing === 'personal'}
        onToggleEdit={() => toggle('personal')}
        editor={
          <PersonalStep
            value={personal}
            errors={errors}
            onChange={(next) => onChangeData({ personal: next })}
          />
        }
      >
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

      <ReviewBlock
        title="التواصل والأسرة"
        editing={editing === 'contact'}
        onToggleEdit={() => toggle('contact')}
        editor={
          <ContactStep
            value={contact}
            errors={errors}
            onChange={(next) => onChangeData({ contact: next })}
          />
        }
      >
        <Row label="الهاتف" value={str(contact.phone)} />
        <Row label="عدد الأفراد" value={str(contact.familySize)} />
      </ReviewBlock>

      <ReviewBlock
        title={`العقارات (${data.properties.length})`}
        editing={editing === 'properties'}
        onToggleEdit={() => toggle('properties')}
        editor={propertyEditor}
      >
        {data.properties.map((property, index) => (
          <Row
            key={index}
            label={`العقار ${index + 1}`}
            value={[
              property.propertyType ? ar.propertyType[property.propertyType] : '—',
              property.propertyNumber ? `رقم ${property.propertyNumber}` : null,
              property.units?.length ? `${property.units.length} وحدة` : null,
            ]
              .filter(Boolean)
              .join(' — ')}
          />
        ))}
      </ReviewBlock>

      <ReviewBlock
        title={`المستندات (${Object.keys(files).length})`}
        editing={editing === 'documents'}
        onToggleEdit={() => toggle('documents')}
        editor={
          <DocumentsStep
            properties={data.properties}
            files={files}
            requiredDocuments={requiredDocuments}
            draftRestored={draftRestored}
            onChange={onChangeFiles}
          />
        }
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
  editing,
  onToggleEdit,
  editor,
  children,
}: {
  title: string;
  editing: boolean;
  onToggleEdit: () => void;
  editor: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn(editing && 'border-primary/40 ring-1 ring-primary/20')}>
      <CardContent className="p-5">
        <header className="mb-3 flex items-center justify-between border-b pb-2">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="link" size="sm" onClick={onToggleEdit}>
            {editing ? 'تم' : 'تعديل'}
          </Button>
        </header>
        {editing ? <div className="pt-1">{editor}</div> : <dl className="space-y-1">{children}</dl>}
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
