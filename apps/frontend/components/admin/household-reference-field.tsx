'use client';

import { useEffect, useState } from 'react';
import {
  logApiError,
  lookupHouseholdReference,
  type HouseholdReferencePreview,
} from '@/lib/api-client';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * The printed shape of a رقم مرجعي — `BZR-2609-RXT2TF`.
 *
 * Same alphabet the reference sign-in validates, and the same one the schema
 * enforces server-side. Checked here only to decide whether a lookup is worth
 * making: a value that cannot be a reference should say so immediately rather
 * than cost a request.
 */
const REFERENCE = /^[A-Z]{3}-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

type State =
  | { kind: 'idle' }
  | { kind: 'malformed' }
  | { kind: 'checking' }
  | { kind: 'result'; preview: HouseholdReferencePreview };

/**
 * «رقم مرجعي لأحد أفراد الأسرة المسجّلين», answered while it is being typed.
 *
 * The field did nothing visible until the record was submitted, and then — at
 * best — reported that the link had failed. An officer had no way to tell a
 * number that would work from one that would not, at the one moment it could
 * still be corrected: while the citizen is standing in front of them. Worse,
 * a citizen id pasted from a URL looked exactly like a working reference.
 *
 * So the field answers three things as it goes: is this even a reference, whose
 * is it, and what will saving do. The name is the important one — the officer
 * reads it back, and the citizen confirms or corrects. That is the confirmation
 * step the whole design rests on, and showing it here is not a disclosure: the
 * citizen supplied this number, so it is a household they already named.
 */
export function HouseholdReferenceField({
  tenant,
  token,
  value,
  error,
  onChange,
  locale = 'ar',
}: {
  tenant: string;
  token?: string | null;
  value: string;
  error?: string;
  onChange: (next: string) => void;
  locale?: string;
}) {
  const en = locale === 'en';
  const [state, setState] = useState<State>({ kind: 'idle' });

  const normalized = value.trim().toUpperCase().replace(/\s/g, '');

  useEffect(() => {
    if (!normalized) {
      setState({ kind: 'idle' });
      return;
    }
    if (!REFERENCE.test(normalized)) {
      setState({ kind: 'malformed' });
      return;
    }
    if (!token) {
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'checking' });

    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookupHouseholdReference(tenant, token, normalized, controller.signal)
        .then((preview) => setState({ kind: 'result', preview }))
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          logApiError(caught);
          // Back to neutral rather than showing a red "not found" that the
          // register never said — a failed request is not a missing citizen,
          // and the save will report the truth either way.
          setState({ kind: 'idle' });
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tenant, token, normalized]);

  return (
    <Field
      label={
        en
          ? 'Already-registered family member (reference no.)'
          : 'رقم مرجعي لأحد أفراد الأسرة المسجّلين'
      }
      htmlFor="householdReference"
      path="contact.householdReference"
      error={error}
      hint={
        en
          ? 'Ask the citizen. Leave blank if nobody in the family is registered yet.'
          : 'اسأل المواطن. اتركه فارغاً إن لم يكن أحد من الأسرة مسجّلاً بعد.'
      }
    >
      <div className="space-y-1.5">
        <Input
          id="householdReference"
          dir="ltr"
          placeholder="BZR-2609-RXT2TF"
          className="text-start max-w-xs uppercase"
          invalid={Boolean(error) || state.kind === 'malformed'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <ReferenceStatus state={state} en={en} />
      </div>
    </Field>
  );
}

/** One line saying what the number typed so far actually is. */
function ReferenceStatus({ state, en }: { state: State; en: boolean }) {
  if (state.kind === 'idle') return null;

  if (state.kind === 'malformed') {
    return (
      <p className="text-xs text-destructive">
        {en
          ? 'Not a reference number. It looks like BZR-2609-RXT2TF — not an ID or a record id.'
          : 'ليس رقماً مرجعياً. شكله BZR-2609-RXT2TF — وليس رقم الهوية أو معرّف السجل.'}
      </p>
    );
  }

  if (state.kind === 'checking') {
    return (
      <p className="text-xs text-muted-foreground">
        {en ? 'Checking…' : 'جارٍ التحقق…'}
      </p>
    );
  }

  if (!state.preview.found) {
    return (
      <p className="text-xs text-destructive">
        {en
          ? 'No citizen holds this reference number in this municipality.'
          : 'لا يوجد مواطن بهذا الرقم المرجعي في هذه البلدية.'}
      </p>
    );
  }

  const { citizenName, hasHousehold, memberCount } = state.preview;

  return (
    <p className="text-xs text-emerald-600 dark:text-emerald-400">
      {hasHousehold
        ? en
          ? `✓ Will join the household of ${citizenName} (${memberCount} listed).`
          : `✓ سيتم الضمّ إلى أسرة ${citizenName} (${memberCount} مُدرجين).`
        : en
          ? `✓ ${citizenName} — a household will be created containing both of them.`
          : `✓ ${citizenName} — ستُنشأ أسرة جديدة تضمّ الاثنين.`}
    </p>
  );
}
