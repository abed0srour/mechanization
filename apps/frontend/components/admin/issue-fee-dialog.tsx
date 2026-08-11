'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  ClipboardList,
  Loader2,
  Receipt,
  Target,
  TriangleAlert,
  Users,
  UserSearch,
} from 'lucide-react';
import {
  ar,
  FEE_FREQUENCY,
  FEE_TARGET_CATEGORY,
  FEE_TARGET_TYPE,
} from '@mechanization/shared-schemas';
import type { CitizenListItem } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChoiceCard, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/dates';

export interface IssueFeeValues {
  title: string;
  amount: string;
  frequency: string;
  targetType: string;
  targetCategory: string;
  targetCitizenId: string;
  dueDate: string;
  instructions: string;
}

const EMPTY: IssueFeeValues = {
  title: '',
  amount: '',
  frequency: 'MONTHLY',
  targetType: 'ALL_CITIZENS',
  targetCategory: 'SHOP',
  targetCitizenId: '',
  dueDate: '',
  instructions: '',
};

/**
 * The three questions this form asks, in the order a clerk can answer them.
 *
 * «كم ومتى» before «على من» is deliberate: the amount and the due date come off
 * the decision the council already took, while the target is the part the clerk
 * has to think about — and thinking about it while the amount is still blank is
 * how a fee lands on the wrong half of the village.
 */
const STEPS = [
  { id: 'details', step: '١', title: 'التفاصيل', icon: Receipt },
  { id: 'target', step: '٢', title: 'الاستهداف', icon: Target },
  { id: 'review', step: '٣', title: 'المراجعة', icon: ClipboardList },
] as const;

type StepId = (typeof STEPS)[number]['id'];

/** Icons for الفئة المستهدفة, so the three choices are told apart before they are read. */
const TARGET_ICON = {
  ALL_CITIZENS: Users,
  BUILDING_CATEGORY: Building2,
  INDIVIDUAL_CITIZEN: UserSearch,
} as const;

const TARGET_HINT = {
  ALL_CITIZENS: 'مطالبة لكل مواطن مسجّل في البلدية',
  BUILDING_CATEGORY: 'المواطنون الذين سجّلوا عقاراً من نوع محدّد',
  INDIVIDUAL_CITIZEN: 'مواطن واحد بالاسم أو بالرقم المرجعي',
} as const;

/** Groups thousands so a seven-digit LBP figure is readable while typing. */
function formatLbp(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

/**
 * "إصدار رسم جديد" — writes one rule and bills everyone it applies to.
 *
 * Three steps rather than one long form, because this is the only action on the
 * screen that cannot be undone by pressing something else: submitting it may
 * create a debt against every resident of the municipality. A single scroll put
 * «إصدار المطالبات» one keystroke away from a half-considered target; the
 * wizard makes the last thing a clerk sees before committing a plain sentence
 * naming the amount, the recurrence and exactly who is about to be billed.
 */
export function IssueFeeDialog({
  open,
  onOpenChange,
  citizens,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registry rows, used only to pick a single citizen by name or reference. */
  citizens: CitizenListItem[];
  submitting: boolean;
  error: string | null;
  onSubmit: (values: IssueFeeValues) => void;
}) {
  const [values, setValues] = useState<IssueFeeValues>(EMPTY);
  const [citizenQuery, setCitizenQuery] = useState('');
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setValues(EMPTY);
      setCitizenQuery('');
      setStepIndex(0);
    }
  }, [open]);

  /**
   * A failed submit sends the clerk back to المراجعة.
   *
   * Without this a server rejection ("مبلغ كبير جداً") would be shown under
   * whichever step they had since navigated to, describing a field that is not
   * on screen.
   */
  useEffect(() => {
    if (error) setStepIndex(STEPS.length - 1);
  }, [error]);

  const set = (patch: Partial<IssueFeeValues>) =>
    setValues((previous) => ({ ...previous, ...patch }));

  // Name or رقم مرجعي, because staff are handed one or the other depending on
  // whether the citizen is standing at the counter or on the phone.
  const matches = citizenQuery.trim()
    ? citizens
        .filter(
          (row) =>
            row.fullName.includes(citizenQuery.trim()) ||
            (row.referenceNumber ?? '').toUpperCase().includes(citizenQuery.trim().toUpperCase()),
        )
        .slice(0, 6)
    : [];

  const chosen = citizens.find((row) => row.id === values.targetCitizenId);
  const amount = Number(values.amount.replace(/\D/g, ''));
  const recurring = values.frequency !== 'ONCE';

  /**
   * Which steps are finished.
   *
   * Indexed by step so the stepper, the «التالي» guard and the final submit all
   * read the same answer — a wizard whose header says a step is done while its
   * button disagrees is worse than no header at all.
   */
  const stepComplete: Record<StepId, boolean> = {
    details: values.title.trim().length >= 3 && amount > 0 && values.dueDate !== '',
    target:
      values.targetType !== 'INDIVIDUAL_CITIZEN' || values.targetCitizenId !== '',
    review: true,
  };

  const current = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const canAdvance = stepComplete[current.id];
  const canSubmit = stepComplete.details && stepComplete.target;

  /** Who this notice will bill, in one phrase — the review step's whole point. */
  const targetSummary =
    values.targetType === 'INDIVIDUAL_CITIZEN'
      ? chosen
        ? `${chosen.fullName} — ${chosen.referenceNumber ?? '—'}`
        : '—'
      : values.targetType === 'BUILDING_CATEGORY'
        ? `أصحاب ${ar.feeTargetCategory[values.targetCategory as never] ?? values.targetCategory}`
        : 'جميع المواطنين المسجّلين';

  /** Only the wide fan-outs deserve the warning; a single citizen is one line. */
  const bulk = values.targetType !== 'INDIVIDUAL_CITIZEN';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel="إغلاق"
        className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-xl"
      >
        <DialogHeader className="shrink-0 space-y-3 border-b p-6 text-start">
          <div className="space-y-1">
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="size-5 text-primary" aria-hidden />
              إصدار رسم جديد
            </DialogTitle>
            <DialogDescription>
              يُنشئ إشعاراً واحداً ويصدر مطالبة لكل مواطن مشمول به.
            </DialogDescription>
          </div>

          <Stepper
            index={stepIndex}
            complete={stepComplete}
            // Backwards only. Jumping forward past an unanswered step is the
            // one thing a stepper must not offer, and «التالي» already carries
            // the guard.
            onSelect={(next) => setStepIndex(Math.min(next, stepIndex))}
          />
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          {current.id === 'details' ? (
            <>
              <Field label="اسم الرسم" htmlFor="fee-title" required>
                <Input
                  id="fee-title"
                  autoFocus
                  placeholder="مثال: رسم النفايات الشهري"
                  value={values.title}
                  onChange={(event) => set({ title: event.target.value })}
                />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="المبلغ بالليرة اللبنانية" htmlFor="fee-amount" required>
                  <Input
                    id="fee-amount"
                    inputMode="numeric"
                    dir="ltr"
                    className="text-start text-lg font-semibold tabular-nums"
                    placeholder="500,000"
                    value={values.amount}
                    onChange={(event) => set({ amount: formatLbp(event.target.value) })}
                  />
                </Field>

                <Field label="تاريخ الاستحقاق" htmlFor="fee-due" required>
                  <Input
                    id="fee-due"
                    type="date"
                    dir="ltr"
                    className="text-start"
                    value={values.dueDate}
                    onChange={(event) => set({ dueDate: event.target.value })}
                  />
                </Field>
              </div>

              <Field
                label="الدورية"
                htmlFor="fee-frequency"
                required
                hint="الرسوم المتكرّرة تُصدر مطالبة جديدة تلقائياً كل دورة حتى إيقافها."
              >
                <Select
                  value={values.frequency}
                  onValueChange={(next) => set({ frequency: next })}
                >
                  <SelectTrigger id="fee-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FEE_FREQUENCY.map((option) => (
                      <SelectItem key={option} value={option}>
                        {ar.feeFrequency[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : null}

          {current.id === 'target' ? (
            <>
              <Field label="الفئة المستهدفة" htmlFor="fee-target" required>
                <div className="grid gap-3">
                  {FEE_TARGET_TYPE.map((option) => (
                    <ChoiceCard
                      key={option}
                      name="fee-target"
                      value={option}
                      checked={values.targetType === option}
                      onChange={(next) => set({ targetType: next, targetCitizenId: '' })}
                      title={ar.feeTargetType[option]}
                      description={TARGET_HINT[option]}
                      icon={TARGET_ICON[option]}
                    />
                  ))}
                </div>
              </Field>

              {values.targetType === 'BUILDING_CATEGORY' ? (
                <Field
                  label="نوع العقارات"
                  htmlFor="fee-category"
                  required
                  hint="يشمل المواطنين الذين سجّلوا عقاراً من هذا النوع."
                >
                  <Select
                    value={values.targetCategory}
                    onValueChange={(next) => set({ targetCategory: next })}
                  >
                    <SelectTrigger id="fee-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEE_TARGET_CATEGORY.map((option) => (
                        <SelectItem key={option} value={option}>
                          {ar.feeTargetCategory[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              {values.targetType === 'INDIVIDUAL_CITIZEN' ? (
                <Field
                  label="المواطن"
                  htmlFor="fee-citizen"
                  required
                  hint="ابحث بالاسم أو بالرقم المرجعي."
                >
                  <div className="space-y-2">
                    <Input
                      id="fee-citizen"
                      placeholder="اسم المواطن أو الرقم المرجعي"
                      value={
                        chosen ? `${chosen.fullName} — ${chosen.referenceNumber}` : citizenQuery
                      }
                      onChange={(event) => {
                        setCitizenQuery(event.target.value);
                        if (values.targetCitizenId) set({ targetCitizenId: '' });
                      }}
                    />
                    {!chosen && matches.length > 0 ? (
                      <ul className="overflow-hidden rounded-lg border">
                        {matches.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => {
                                set({ targetCitizenId: row.id });
                                setCitizenQuery('');
                              }}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm transition-colors hover:bg-accent"
                            >
                              <span className="font-medium">{row.fullName}</span>
                              <span
                                className="font-mono text-xs text-muted-foreground"
                                dir="ltr"
                              >
                                {row.referenceNumber}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </Field>
              ) : null}

              <Field
                label="تعليمات الدفع / ملاحظات"
                htmlFor="fee-instructions"
                hint="تظهر للمواطن أعلى خيارات الدفع."
              >
                <Textarea
                  id="fee-instructions"
                  rows={3}
                  value={values.instructions}
                  onChange={(event) => set({ instructions: event.target.value })}
                />
              </Field>
            </>
          ) : null}

          {current.id === 'review' ? (
            <div className="space-y-4">
              {/* The amount gets its own block: it is the figure a clerk
                  re-reads against the council's decision, and it should not
                  have to be found among six rows of a table to do it. */}
              <div className="rounded-lg border bg-muted/30 p-4 text-center">
                <p className="text-sm text-muted-foreground">{values.title || '—'}</p>
                <p className="mt-1 text-3xl font-bold tabular-nums" dir="ltr">
                  {amount ? amount.toLocaleString('en-US') : '—'}
                  <span className="ms-2 text-base font-medium text-muted-foreground">ل.ل</span>
                </p>
              </div>

              <dl className="divide-y rounded-lg border text-sm">
                <ReviewRow icon={Target} label="يُطبَّق على" value={targetSummary} />
                <ReviewRow
                  icon={CalendarClock}
                  label="الدورية"
                  value={
                    recurring
                      ? `${ar.feeFrequency[values.frequency as never]} — يتكرّر تلقائياً حتى الإيقاف`
                      : ar.feeFrequency[values.frequency as never]
                  }
                />
                <ReviewRow
                  icon={CalendarClock}
                  label="تاريخ الاستحقاق"
                  value={
                    values.dueDate
                      ? formatDate(values.dueDate)
                      : '—'
                  }
                />
                {values.instructions.trim() ? (
                  <ReviewRow
                    icon={ClipboardList}
                    label="تعليمات الدفع"
                    value={values.instructions.trim()}
                  />
                ) : null}
              </dl>

              {bulk ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    سيتم إنشاء مطالبة منفصلة لكل مواطن مشمول، وتظهر فوراً في حسابه.
                    {recurring
                      ? ' يمكن إيقاف التكرار لاحقاً، لكن المطالبات الصادرة تبقى قائمة.'
                      : ''}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* `justify-between` is restated at `sm` because DialogFooter's own
            `sm:justify-end` would otherwise take over at that breakpoint and
            collapse «السابق» and «التالي» into the same corner. */}
        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t p-6 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => (stepIndex === 0 ? onOpenChange(false) : setStepIndex(stepIndex - 1))}
            disabled={submitting}
          >
            {stepIndex === 0 ? (
              'إلغاء'
            ) : (
              <>
                <ArrowRight className="size-4" aria-hidden />
                السابق
              </>
            )}
          </Button>

          {isLast ? (
            <Button disabled={!canSubmit || submitting} onClick={() => onSubmit(values)}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
              إصدار المطالبات
            </Button>
          ) : (
            <Button disabled={!canAdvance} onClick={() => setStepIndex(stepIndex + 1)}>
              التالي
              <ArrowLeft className="size-4" aria-hidden />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The three dots across the top.
 *
 * A step that is both behind the cursor *and* answered gets a check; behind and
 * unanswered gets its numeral back. That distinction matters because the only
 * way to be in the third step with an empty first one is to have gone back and
 * cleared something — precisely the state a clerk needs pointed out.
 */
function Stepper({
  index,
  complete,
  onSelect,
}: {
  index: number;
  complete: Record<StepId, boolean>;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex items-center gap-1" aria-label="خطوات إصدار الرسم">
      {STEPS.map((step, position) => {
        const isActive = position === index;
        const behind = position < index;
        const done = behind && complete[step.id];

        return (
          <li key={step.id} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(position)}
              disabled={position > index}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors',
                position <= index ? 'hover:bg-accent' : 'cursor-default',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1',
                  isActive
                    ? 'bg-primary text-primary-foreground ring-primary'
                    : done
                      ? 'bg-success/10 text-success ring-success/40'
                      : behind
                        ? 'bg-destructive/10 text-destructive ring-destructive/40'
                        : 'bg-muted text-muted-foreground ring-border',
                )}
              >
                {done ? <Check className="size-3.5" /> : step.step}
              </span>
              <span
                className={cn(
                  'truncate font-medium',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.title}
              </span>
            </button>
            {position < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cn('h-px w-4 shrink-0', behind ? 'bg-primary/40' : 'bg-border')}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ReviewRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-end font-medium">{value}</dd>
    </div>
  );
}
