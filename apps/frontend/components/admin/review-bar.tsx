'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { REJECTABLE_FIELDS, type RejectableField } from '@mechanization/shared-schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Matches `changeStatusSchema.reason`, so the button disables rather than
 *  letting the server refuse a note that is too short. */
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;

/**
 * The decision controls for one submission, on the page that shows what is
 * being decided.
 *
 * Rejection used to be a dashboard row button opening a dialog that listed
 * every rejectable field as a checkbox — a second, abstract copy of the form,
 * asked for while the actual values were on another screen. Here the reviewer
 * flags the value they are looking at, and this bar only collects what the
 * values cannot carry themselves: the note, and the confirmation.
 */
export function ReviewBar({
  acceptLabel,
  rejecting,
  flagged,
  note,
  allowCitizenCorrection,
  revisitAt,
  submitting,
  onNoteChange,
  onAllowCitizenCorrectionChange,
  onRevisitAtChange,
  onStartRejecting,
  onCancelRejecting,
  onAccept,
  onConfirmReject,
  onUnflag,
}: {
  /** Arabic label of the forward status, e.g. «قيد المراجعة». */
  acceptLabel: string | undefined;
  rejecting: boolean;
  flagged: readonly RejectableField[];
  note: string;
  /** Checked by default — the citizen fixes the flagged fields online. */
  allowCitizenCorrection: boolean;
  /** `datetime-local` value for the counter visit; only when the above is off. */
  revisitAt: string;
  submitting: boolean;
  onNoteChange: (note: string) => void;
  onAllowCitizenCorrectionChange: (allow: boolean) => void;
  onRevisitAtChange: (value: string) => void;
  onStartRejecting: () => void;
  onCancelRejecting: () => void;
  onAccept: () => void;
  onConfirmReject: () => void;
  onUnflag: (field: RejectableField) => void;
}) {
  const canConfirm = note.trim().length >= MIN_REASON_LENGTH && !submitting;

  if (!rejecting) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          راجع البيانات أعلاه ثم اتخذ قراراً بشأن هذا الطلب.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onStartRejecting} disabled={submitting}>
            <XCircle className="size-4 text-destructive" aria-hidden />
            رفض
          </Button>
          {acceptLabel ? (
            <Button onClick={onAccept} disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden />
              )}
              قبول ({acceptLabel})
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-semibold text-destructive">
          <XCircle className="size-4 shrink-0" aria-hidden />
          رفض الطلب
        </p>
        <p className="text-sm text-muted-foreground">
          اضغط ✕ بجانب أي قيمة غير صحيحة أعلاه لتحديدها، ثم اكتب سبب الرفض.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          الحقول المرفوضة {flagged.length > 0 ? `(${flagged.length})` : ''}
        </p>
        {flagged.length === 0 ? (
          // Not an error: a claim refused outright has no correctable field
          // list, and demanding one would misrepresent it as a fixable slip.
          <p className="text-sm text-muted-foreground">
            لم تُحدَّد حقول — سيُرفض الطلب بالكامل مع السبب المكتوب أدناه.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {flagged.map((field) => (
              <li key={field}>
                <button type="button" onClick={() => onUnflag(field)} title="إلغاء التحديد">
                  <Badge variant="destructive" className="gap-1 hover:opacity-80">
                    {REJECTABLE_FIELDS[field]}
                    <XCircle className="size-3" aria-hidden />
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="reject-note" className="flex items-baseline gap-2">
          <span>سبب الرفض / ملاحظات</span>
          <span className="text-sm font-semibold text-destructive" aria-label="حقل إلزامي">
            *
          </span>
        </Label>
        <p className="text-sm text-muted-foreground">
          يظهر هذا النص للمواطن كما هو — اكتب ما عليه تصحيحه بالضبط.
        </p>
        <Textarea
          id="reject-note"
          rows={3}
          maxLength={MAX_REASON_LENGTH}
          // Focused on entry so the one required field is where the cursor
          // already is, rather than something to discover after flagging.
          autoFocus
          aria-describedby="reject-note-hint"
          className={
            note.trim().length < MIN_REASON_LENGTH ? 'border-destructive/60' : undefined
          }
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="مثال: رقم العقار لا يطابق السجل العقاري، ويرجى إرفاق صورة أوضح للهوية."
        />
        <p
          id="reject-note-hint"
          className={
            note.trim().length < MIN_REASON_LENGTH
              ? 'text-xs font-medium text-destructive'
              : 'text-xs text-muted-foreground'
          }
        >
          {note.trim().length < MIN_REASON_LENGTH
            ? `مطلوب — اكتب ${MIN_REASON_LENGTH} أحرف على الأقل`
            : `${note.length} / ${MAX_REASON_LENGTH}`}
        </p>
      </div>

      {/*
        How the citizen answers this rejection. Checked by default: a wrong
        digit is a wrong digit, and sending someone across town to change one
        is the trip this system exists to save. Unchecking it is the
        deliberate exception — an original document to inspect, an identity to
        confirm in person — and only then is an appointment worth setting.
      */}
      <div className="space-y-3 rounded-lg border bg-background p-3">
        <label className="flex cursor-pointer items-start gap-2.5">
          <Checkbox
            className="mt-0.5 size-5"
            checked={allowCitizenCorrection}
            onCheckedChange={(checked) => onAllowCitizenCorrectionChange(checked === true)}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">
              السماح للمواطن بتصحيح الحقول بنفسه
            </span>
            <span className="block text-sm text-muted-foreground">
              {allowCitizenCorrection
                ? 'سيظهر للمواطن نموذج يصحّح فيه الحقول المحدّدة ويعيد الإرسال.'
                : 'سيُطلب من المواطن مراجعة البلدية لتصحيح البيانات.'}
            </span>
          </span>
        </label>

        {!allowCitizenCorrection ? (
          <div className="space-y-1.5 ps-8">
            <Label htmlFor="revisit-at" className="flex items-baseline gap-2">
              <span>موعد المراجعة</span>
              <span className="text-sm font-normal text-muted-foreground">اختياري</span>
            </Label>
            <Input
              id="revisit-at"
              type="datetime-local"
              dir="ltr"
              className="text-start"
              value={revisitAt}
              onChange={(event) => onRevisitAtChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              اتركه فارغاً إذا كان بإمكان المواطن المراجعة في أي وقت.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {/*
          Says why the button is dead rather than leaving it greyed out with
          no explanation. Flagging fields is the visible, satisfying half of
          this form, so it is easy to flag six values and then find the
          confirm button inert with nothing on screen pointing at the empty
          note — which is a required field the server enforces too.
        */}
        {!canConfirm && !submitting ? (
          <p className="me-auto text-sm font-medium text-destructive">
            اكتب سبب الرفض أعلاه لتفعيل زر التأكيد
          </p>
        ) : null}
        <Button variant="outline" onClick={onCancelRejecting} disabled={submitting}>
          إلغاء
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirmReject}
          disabled={!canConfirm}
          title={canConfirm ? undefined : 'سبب الرفض مطلوب'}
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <XCircle className="size-4" aria-hidden />
          )}
          تأكيد الرفض
        </Button>
      </div>
    </div>
  );
}
