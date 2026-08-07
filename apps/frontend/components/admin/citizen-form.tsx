'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ZodError } from 'zod';
import {
  Building2,
  IdCard,
  Loader2,
  Plus,
  Save,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import {
  allowedPropertyTypesFor,
  contactDetailsSchema,
  personalDetailsSchema,
  propertyEntriesSchema,
} from '@mechanization/shared-schemas';
import type { PropertyType } from '@mechanization/shared-schemas';
import type { PublicTenantConfig } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ContactStep, PersonalStep } from '@/components/citizen/steps';
import {
  PropertyCard,
  type PropertyDraft,
  type UnitDraft,
} from '@/components/citizen/property-card';
import { cn, scopeErrors } from '@/lib/utils';
import { useSectionNav } from '@/lib/use-section-nav';

export interface CitizenFormValues {
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  properties: PropertyDraft[];
}

/**
 * The three sections, in one list.
 *
 * Declared once and read by both the jump-link bar and the section headings
 * so the two cannot fall out of step — a nav entry pointing at an `id` no
 * heading renders is a link that silently does nothing, and it is exactly the
 * kind of drift that survives review because nothing about it looks wrong.
 *
 * The `id` is also the error-key prefix (`personal.firstName`,
 * `properties.0.neighborhood`), which is what lets the bar mark a section as
 * holding a problem without a second mapping.
 */
const SECTIONS = [
  { id: 'personal', step: '١', icon: IdCard, title: 'البيانات الشخصية' },
  { id: 'contact', step: '٢', icon: UsersRound, title: 'التواصل والأسرة' },
  { id: 'properties', step: '٣', icon: Building2, title: 'العقارات' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/** Stable identity for the nav hook's observer dependency. */
const SECTION_IDS = SECTIONS.map((section) => section.id) as readonly SectionId[];

/** A brand new record — one blank property card, Lebanese by default. */
export const EMPTY_CITIZEN: CitizenFormValues = {
  personal: { isLebanese: true },
  contact: { whatsappSameAsPhone: true },
  properties: [{}],
};

/** Turns a failed `safeParse` into the `"personal.firstName"` keys each section reads. */
function fieldErrorsFrom(error: ZodError, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = [prefix, ...issue.path].join('.');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Drops UI-only fields and coerces the numeric strings the inputs produce. */
export function toPayloadProperty(property: PropertyDraft): Record<string, unknown> {
  const { unitArea, units, id, ...rest } = property;

  return {
    // Present only when this card is editing a stored row; the create endpoint
    // never sees it, and the update endpoint reads it as "this one, changed".
    ...(id ? { id } : {}),
    ...rest,
    ...(unitArea !== undefined && unitArea !== '' ? { unitArea: Number(unitArea) } : {}),
    ...(units ? { units: units.map(toPayloadUnit) } : {}),
  };
}

/** Coerces one building unit's numeric strings for the wire. */
function toPayloadUnit(unit: UnitDraft): Record<string, unknown> {
  const { unitArea, ...rest } = unit;
  return {
    ...rest,
    ...(unitArea !== undefined && unitArea !== '' ? { unitArea: Number(unitArea) } : {}),
  };
}

/**
 * Validates the whole record at once, against the same schemas the server
 * validates against.
 *
 * The wizard checked one step per «التالي» because that was the only moment it
 * could. A single page has no such moment, so everything is checked on save —
 * and the caller gets one flat error map covering all three sections, which is
 * what lets a mistake in البيانات الشخصية surface while the clerk is looking
 * at العقارات.
 */
function validate(values: CitizenFormValues): Record<string, string> {
  const personal = personalDetailsSchema.safeParse(values.personal);
  const contact = contactDetailsSchema.safeParse(values.contact);
  const properties = propertyEntriesSchema.safeParse(
    values.properties.map(toPayloadProperty),
  );

  return {
    ...(personal.success ? {} : fieldErrorsFrom(personal.error, 'personal')),
    ...(contact.success ? {} : fieldErrorsFrom(contact.error, 'contact')),
    ...(properties.success ? {} : fieldErrorsFrom(properties.error, 'properties')),
  };
}

/**
 * Create or correct one citizen record — the citizen wizard's six steps as a
 * single page.
 *
 * The step-by-step shape existed for a citizen filling this in on a phone,
 * alone, once: it broke an intimidating form into answerable pieces and
 * refused to let them past a piece they had got wrong. A clerk at a counter is
 * the opposite case — they do this all day, they are working from papers laid
 * out in front of them, and the person is waiting. Sections they can jump
 * between and a single «حفظ» beat six «التالي» presses and a review screen.
 *
 * The section *contents* are the wizard's own components, not copies:
 * `PersonalStep`, `ContactStep` and `PropertyCard` render here exactly as they
 * render for a citizen, so the conditional fields (رقم السجل only for a
 * Lebanese citizen, a landlord block only for a tenant, a units editor only
 * for a building) cannot drift between the two entry points.
 *
 * The two steps that are *not* here are deliberate: المستندات, because a clerk
 * has paper rather than files to attach, and الإقرار, because a declaration
 * ticked on someone else's behalf is not a declaration.
 */
export function CitizenForm({
  tenant,
  config,
  mode,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  tenant: string;
  config: PublicTenantConfig;
  mode: 'create' | 'edit';
  initial: CitizenFormValues;
  submitting: boolean;
  /** Server-side failure, shown above the actions. */
  error: string | null;
  onSubmit: (values: CitizenFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<CitizenFormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  /** Which property cards are folded shut. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  /**
   * The jump bar's highlight and scroll handler.
   *
   * Re-observed when a property card is added or removed: the sections keep
   * their ids, but the page height under them changes enough that a stale
   * observer would highlight against the old layout.
   */
  const { active, jumpTo } = useSectionNav(SECTION_IDS, [values.properties.length]);

  // Re-seeds when the record finishes loading. Keyed on the object identity,
  // so a parent that fetches once does not clobber what has been typed since.
  useEffect(() => {
    setValues(initial);
    // An existing record opens with its cards folded — a clerk fixing a phone
    // number should not have to scroll past four properties to reach «حفظ».
    setCollapsed(
      new Set(initial.properties.length > 1 ? initial.properties.map((_, i) => i) : []),
    );
  }, [initial]);

  const update = useCallback((patch: Partial<CitizenFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
  }, []);

  const setProperty = useCallback((index: number, next: PropertyDraft) => {
    setValues((current) => ({
      ...current,
      properties: current.properties.map((p, i) => (i === index ? next : p)),
    }));
  }, []);

  const addProperty = useCallback(() => {
    setValues((current) => {
      const properties = [
        ...current.properties,
        // A clerk entering several properties for one household fills the same
        // shape repeatedly, so a new card inherits the last one's occupancy.
        { occupancyType: current.properties.at(-1)?.occupancyType },
      ];
      setCollapsed(new Set(properties.slice(0, -1).map((_, i) => i)));
      return { ...current, properties };
    });
  }, []);

  const removeProperty = useCallback((index: number) => {
    setValues((current) => ({
      ...current,
      properties: current.properties.filter((_, i) => i !== index),
    }));
    // Indices above the removed card shift down by one; rebuilding the set
    // rather than deleting from it keeps the wrong card from folding shut.
    setCollapsed((current) => {
      const next = new Set<number>();
      for (const i of current) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback((index: number) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  /**
   * Which نوع العقار is offered: the municipality's enabled types, minus خيمة
   * for anyone who is not a لاجئ. Re-checked on the server, where صفة الإقامة
   * and the property list are both in hand.
   */
  const allowedTypes = useMemo(() => {
    const enabled = new Set(config.enabledPropertyTypes);
    return allowedPropertyTypesFor(values.personal.residentStatus as string | undefined).filter(
      (type) => enabled.has(type),
    );
  }, [config.enabledPropertyTypes, values.personal.residentStatus]);

  /**
   * A property left holding a type the current صفة الإقامة no longer permits
   * has it cleared, rather than failing validation on save against a control
   * the form has stopped offering.
   */
  useEffect(() => {
    const permitted = new Set(allowedTypes);
    if (values.properties.every((p) => !p.propertyType || permitted.has(p.propertyType))) return;

    setValues((current) => ({
      ...current,
      properties: current.properties.map((p) =>
        p.propertyType && !permitted.has(p.propertyType)
          ? { ...p, propertyType: undefined, tentLocation: undefined }
          : p,
      ),
    }));
  }, [allowedTypes, values.properties]);

  // Live once a save has been attempted, silent before it: flagging fields a
  // clerk has not reached yet turns a blank form red.
  useEffect(() => {
    if (!showErrors) return;
    setFieldErrors(validate(values));
  }, [showErrors, values]);

  function handleSubmit() {
    const errors = validate(values);
    setFieldErrors(errors);
    setShowErrors(true);

    if (Object.keys(errors).length > 0) {
      // Straight to the first thing that is wrong. On a page this long the
      // banner alone can be off-screen from the field it is describing.
      document
        .querySelector('[data-section-invalid="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    onSubmit(values);
  }

  const shown = showErrors ? fieldErrors : {};
  const messages = [...new Set(Object.values(shown))];

  const sectionInvalid = (prefix: string) =>
    Object.keys(shown).some((key) => key.startsWith(`${prefix}.`));

  return (
    <div className="space-y-6">
      {/*
        Jump links. This form is three to ten screens tall depending on how
        many properties a household holds, and the two commonest jobs on it —
        "fix the phone number" and "add another عقار" — live at opposite ends.
        Scrolling to find them is the tax the single-page layout would
        otherwise charge for losing the wizard's step buttons.
      */}
      <nav
        aria-label="أقسام النموذج"
        className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6"
      >
        <ul className="flex flex-wrap items-center gap-2">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const invalid = sectionInvalid(section.id);
            const isActive = active === section.id;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => jumpTo(section.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    // The error state outranks the active one: a clerk who has
                    // scrolled past a broken section needs to see that from
                    // here, and "you are here" is the less urgent fact.
                    invalid &&
                      !isActive &&
                      'border-destructive/50 bg-destructive/10 text-destructive',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'rounded px-1 text-xs font-semibold',
                      isActive ? 'bg-primary-foreground/20' : 'bg-background/70',
                    )}
                  >
                    {section.step}
                  </span>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="whitespace-nowrap">
                    {section.id === 'properties'
                      ? `${section.title} (${values.properties.length})`
                      : section.title}
                  </span>
                  {invalid ? (
                    <>
                      <TriangleAlert
                        className={cn(
                          'size-3.5 shrink-0',
                          isActive ? 'text-primary-foreground' : 'text-destructive',
                        )}
                        aria-hidden
                      />
                      {/* The icon is decorative; this is what a screen reader
                          announces, since colour and a glyph say nothing to it. */}
                      <span className="sr-only">يحتوي على حقول غير مكتملة</span>
                    </>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <FormSection
        id="personal"
        step="١"
        icon={IdCard}
        title="البيانات الشخصية"
        description="الاسم كما هو مدوّن على وثيقة الإثبات، والجنسية وصفة الإقامة"
        invalid={sectionInvalid('personal')}
      >
        <PersonalStep
          value={values.personal}
          errors={shown}
          onChange={(personal) => update({ personal })}
        />
      </FormSection>

      <FormSection
        id="contact"
        step="٢"
        icon={UsersRound}
        title="التواصل والأسرة"
        description="رقم الهاتف الذي يستخدمه المواطن للدخول ومتابعة طلبه"
        invalid={sectionInvalid('contact')}
      >
        <ContactStep
          value={values.contact}
          errors={shown}
          onChange={(contact) => update({ contact })}
        />
      </FormSection>

      <FormSection
        id="properties"
        step="٣"
        icon={Building2}
        title={`العقارات (${values.properties.length})`}
        description="رقم العقار يُطابَق مع السجل العقاري للبلدية أثناء الكتابة"
        invalid={sectionInvalid('properties')}
      >
        <div className="space-y-6">
          {values.properties.map((property, index) => (
            <PropertyCard
              key={property.id ?? index}
              tenant={tenant}
              index={index}
              draft={property}
              allowedTypes={allowedTypes}
              collapsed={collapsed.has(index)}
              onToggleCollapse={() => toggleCollapsed(index)}
              onChange={(next) => setProperty(index, next)}
              onRemove={() => removeProperty(index)}
              canRemove={values.properties.length > 1}
              errors={scopeErrors(shown, `properties.${index}`)}
            />
          ))}

          {/*
            Said before the delete rather than after it: removing a stored
            property takes its سند الملكية / عقد الإيجار with it, because the
            document row hangs off the property row and cascades. A clerk
            tidying up a duplicate entry has no way to know that otherwise.
          */}
          {mode === 'edit' && values.properties.some((property) => property.id) ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              حذف عقار مسجّل يحذف معه المستندات المرفقة به (سند الملكية أو عقد الإيجار).
            </p>
          ) : null}

          <Button
            variant="outline"
            size="lg"
            onClick={addProperty}
            className="w-full border-dashed border-primary text-primary hover:bg-primary/5"
          >
            <Plus className="size-5" aria-hidden />
            إضافة عقار آخر
          </Button>
        </div>
      </FormSection>

      {/*
        Sticky, because this page is long enough that the save button would
        otherwise be several screens below whatever is being typed — and a
        clerk with someone waiting should never have to hunt for it.
      */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {/*
          The failures spelled out, not just counted. Every message here also
          appears under its own input — but a branch-specific field can be
          hidden for the answers currently given (الجنسية is not rendered at
          all for a Lebanese citizen), and a folded property card hides its
          own errors entirely.
        */}
        {messages.length > 0 ? (
          <div
            role="alert"
            className="mb-3 space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              يرجى تصحيح الحقول التالية قبل الحفظ:
            </p>
            <ul className="list-inside list-disc ps-1">
              {messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            إلغاء
          </Button>
          <Button size="lg" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-5" aria-hidden />
            )}
            {mode === 'edit' ? 'حفظ التعديلات' : 'حفظ وإنشاء الملف'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One titled section of the form.
 *
 * The numbered chip is what replaces the progress bar: it keeps the wizard's
 * sense of "there are three things to fill in, and this is the second" without
 * the navigation that made them sequential. A section holding an error gets a
 * ring rather than only red text inside it, so a folded property card three
 * screens down is still findable from the top of the page.
 */
function FormSection({
  id,
  step,
  icon: Icon,
  title,
  description,
  invalid,
  children,
}: {
  /** Anchor target for the jump bar; must match an entry in `SECTIONS`. */
  id: string;
  step: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  invalid: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card
      id={id}
      // `scroll-mt-24` clears the sticky jump bar: without it `scrollIntoView`
      // aligns the card's top edge with the viewport's, putting the heading
      // underneath the bar that was just used to reach it.
      data-section-invalid={invalid || undefined}
      className={cn(
        'scroll-mt-24',
        invalid && 'border-destructive/50 ring-1 ring-destructive/20',
      )}
    >
      <CardHeader className="flex-row items-start gap-4 space-y-0 border-b">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <span
              aria-hidden
              className="rounded-md bg-secondary px-1.5 py-0.5 text-sm font-semibold text-secondary-foreground"
            >
              {step}
            </span>
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}
