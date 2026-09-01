'use client';

import {
  OUTCOME_DISPOSITION,
  OUTCOME_REQUIRES_NOTE,
  ar,
  type VisitDisposition,
  type VisitOutcome,
} from '@mechanization/shared-schemas';

/**
 * ──────────────────  One vocabulary for "what happened here"  ────────────────
 *
 * Two screens ask the same question — the quick sheet on the list, and the form
 * page at the door — and for a while they offered different answers to it. The
 * sheet had all fifteen outcomes grouped by disposition; the form page had a
 * hand-written grid of seven, missing `ACCESS_BLOCKED` (the one the "whole
 * building" button exists for), missing every CLOSED outcome, and missing the
 * note requirement that the server enforces.
 *
 * A worker who learns «تعذّر الوصول» on one screen and cannot find it on the
 * other has learned that the app is unreliable, which is a more expensive
 * lesson than any single missing option. So the list, the grouping, the return
 * dates and the note rule live here, once.
 */

/**
 * The outcome list is grouped by disposition rather than shown flat, because
 * the grouping *is* the mental model: "I'll come back", "someone else has to
 * act", "this door is finished". Fifteen options in one list is a scroll on a
 * phone in the sun; three short groups is a glance.
 */
export const OUTCOME_GROUPS: ReadonlyArray<{
  disposition: VisitDisposition;
  title: string;
  hint: string;
}> = [
  { disposition: 'DONE', title: 'منجز', hint: 'اكتمل التسجيل' },
  { disposition: 'RETRY', title: 'يحتاج زيارة أخرى', hint: 'سيعود إلى قائمتك' },
  {
    disposition: 'WAITING',
    title: 'بانتظار طرف آخر',
    hint: 'يحتاج وكيلاً أو مستنداً أو قراراً — لا تكفي زيارة أخرى',
  },
  {
    disposition: 'CLOSED',
    title: 'إغلاق نهائي',
    hint: 'يُرفع العقار من قائمة العمل نهائياً — يتطلب ملاحظة',
  },
];

const ALL_OUTCOMES = Object.keys(OUTCOME_DISPOSITION) as VisitOutcome[];

/** The outcomes in one group, in the enum's own order. */
export function outcomesFor(disposition: VisitDisposition): VisitOutcome[] {
  return ALL_OUTCOMES.filter((outcome) => OUTCOME_DISPOSITION[outcome] === disposition);
}

export function outcomeLabel(outcome: VisitOutcome): string {
  return ar.visitOutcome[outcome];
}

/**
 * How long "come back later" means, per outcome.
 *
 * A seasonal resident is not worth a knock next Tuesday and a missing document
 * usually is. Defaults only — the worker can always change the date — but a
 * default that is roughly right is what stops the field turning into a wall of
 * nulls nobody schedules.
 */
const DEFAULT_RETURN_DAYS: Partial<Record<VisitOutcome, number>> = {
  NOBODY_HOME: 3,
  ACCESS_BLOCKED: 7,
  NOT_DECISION_MAKER: 3,
  PARTIAL: 7,
  DOCUMENTS_MISSING: 14,
  ABROAD: 30,
  ESTATE_UNSETTLED: 60,
  DISPUTED: 90,
  REFUSED: 30,
  SEASONAL: 180,
};

/** `YYYY-MM-DD` for a date input, or `''` where a return date is meaningless. */
export function defaultReturnDate(outcome: VisitOutcome): string {
  const days = DEFAULT_RETURN_DAYS[outcome];
  if (!days) return '';
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whether a return date is a thing this outcome can even have. */
export function takesReturnDate(outcome: VisitOutcome): boolean {
  return DEFAULT_RETURN_DAYS[outcome] !== undefined;
}

/**
 * Whether the وكيل fields are worth showing.
 *
 * `ABROAD`, `ESTATE_UNSETTLED` and `NOT_DECISION_MAKER` are the three outcomes
 * whose resolution is a *person*, not a return visit. Without somewhere to put
 * that person's name they are three different ways of writing "stuck".
 */
export function takesProxy(outcome: VisitOutcome): boolean {
  return outcome === 'ABROAD' || outcome === 'ESTATE_UNSETTLED' || outcome === 'NOT_DECISION_MAKER';
}

/**
 * The client-side half of the server's note rule.
 *
 * `recordVisitSchema` rejects these outcomes without a note, and a device that
 * lets one through does not find out until the sync — at which point the visit
 * sits in the outbox, permanently rejected, on a screen with no way to edit it.
 * Checking here is what keeps that from being reachable at all.
 */
export function requiresNote(outcome: VisitOutcome): boolean {
  return OUTCOME_REQUIRES_NOTE.includes(outcome);
}

/**
 * What is wrong with this outcome, in Arabic, or `null` if nothing is.
 *
 * Both screens call it before saving, so a rule can never be enforced on one
 * and not the other.
 */
export function validateVisit(input: {
  outcome: VisitOutcome;
  note: string;
  draftIsComplete: boolean;
  hasDraft: boolean;
  citizenName?: string | null;
  gapCount?: number;
}): string | null {
  if (requiresNote(input.outcome) && !input.note.trim()) {
    return 'هذه النتيجة تتطلب ملاحظة توضّح السبب';
  }
  if (input.outcome === 'COMPLETED') {
    if (!input.hasDraft) {
      return 'لم تُسجَّل بيانات المواطن بعد — اضغط «تسجيل البيانات» لإدخالها أولاً.';
    }
    if (!input.draftIsComplete) {
      const who = input.citizenName ? `المواطن (${input.citizenName})` : 'المسودة المختارة';
      const count = input.gapCount ? ` (${input.gapCount} حقلاً)` : '';
      return `بيانات ${who} ما زالت ناقصة${count} — أكمل الحقول المتبقية أو اختر «بيانات ناقصة».`;
    }
  }
  if (input.outcome === 'PARTIAL' && !input.hasDraft) {
    // Mirrors the server rule: PARTIAL with nothing attached is
    // indistinguishable from NOBODY_HOME, and the difference is the point.
    return 'اختر «لا أحد في المنزل» إن لم تُسجَّل أي بيانات';
  }
  return null;
}
