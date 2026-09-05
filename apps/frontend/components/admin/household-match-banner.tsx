'use client';

import { useEffect, useState } from 'react';
import { logApiError, resolveHousehold, type HouseholdResolution } from '@/lib/api-client';

/**
 * «قد يكون هذا الشخص مسجّلاً بالفعل» — asked of the register while the officer types.
 *
 * Two rules shape everything here, and both are about what this banner must
 * *not* do.
 *
 * **It never links.** The endpoint behind it is read-only; the outcome it shows
 * is a proposal. Linking happens when the officer enters the relative's
 * رقم مرجعي in the field below it — a fact the citizen supplies, not one the
 * system inferred.
 *
 * **It never shows the other household.** The obvious design puts the candidate
 * family on screen — «مسجَّلة من فاطمة حرب · الأولاد: حسين، نور» — and it is
 * wrong: every time the match is mistaken, that discloses one family's
 * composition, children included, to an unrelated man standing at a counter.
 * What appears instead is that *a* candidate exists, and a question for the
 * officer to put to the person in front of them. The answer comes back as a
 * reference number, which either resolves or does not.
 */
export function HouseholdMatchBanner({
  tenant,
  token,
  subject,
  locale = 'ar',
}: {
  tenant: string;
  token?: string | null;
  /** The identity fields as typed so far. */
  subject: {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    motherName?: string;
    dateOfBirth?: string;
    gender?: string;
    civilRecordNumber?: string;
    registrationPlaceTown?: string;
    phone?: string;
    altPhone?: string;
  };
  locale?: string;
}) {
  const [result, setResult] = useState<HouseholdResolution | null>(null);
  const en = locale === 'en';

  /*
    Enough of a name to be worth asking about.

    A first name alone matches a third of the town and would put a banner on
    screen for every record — which trains the officer to ignore it, and a
    warning nobody reads is worse than no warning. Two name parts is the same
    floor `compareNames` uses to call two names a match at all.
  */
  const nameParts = [subject.firstName, subject.middleName, subject.lastName].filter(
    (part) => (part ?? '').trim().length > 1,
  );
  const ready = Boolean(token) && nameParts.length >= 2;

  const key = JSON.stringify(subject);

  useEffect(() => {
    if (!ready || !token) {
      setResult(null);
      return;
    }

    /*
      Debounced, and cancelled on every keystroke that supersedes it.

      The officer is typing; without this, each character is a full-table
      candidate query. `AbortController` rather than a stale-response guard
      because `apiFetch` re-throws `AbortError` untouched for exactly this.
    */
    const controller = new AbortController();
    const timer = setTimeout(() => {
      resolveHousehold(tenant, token, subject, controller.signal)
        .then(setResult)
        .catch((caught) => {
          /*
            Quiet on screen, never quiet in the console.

            This is an optional hint on a form that must work on a bad
            connection and offline, so an error toast here would interrupt an
            officer mid-record over a suggestion they did not ask for. But
            swallowing it outright is how a broken endpoint becomes invisible —
            the banner simply never appears, which looks exactly like "no match
            found". `logApiError` is what tells the two apart.
          */
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          logApiError(caught);
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` is the serialised subject: the effect re-runs when a field the
    // resolver reads actually changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token, ready, key]);

  const household = result?.household;
  const duplicate = result?.duplicate;

  const hasHousehold = household && household.outcome !== 'NO_MATCH';
  const hasDuplicate = duplicate && duplicate.outcome !== 'NO_MATCH';

  if (!hasHousehold && !hasDuplicate) return null;

  return (
    <div className="space-y-2">
      {hasHousehold ? (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed"
        >
          <p className="font-medium text-foreground">
            {en
              ? 'Someone with this name may already belong to a registered household.'
              : 'قد يكون شخص بهذا الاسم مُدرجاً ضمن أسرة مسجّلة.'}
          </p>
          <p className="pt-1 text-muted-foreground">
            {en
              ? 'Ask the citizen whether a family member is already registered, and enter their reference number below. Do not link on the strength of a name.'
              : 'اسأل المواطن إن كان أحد أفراد أسرته مسجّلاً، وأدخل رقمه المرجعي أدناه. لا تربط اعتماداً على تطابق الاسم وحده.'}
          </p>
          {/*
            The count, not the names. It is the one fact about the other
            households that is safe to show and the one that matters: «there are
            three of these» tells the officer a name will not settle it.
          */}
          {household.alternatives > 0 ? (
            <p className="pt-1 text-muted-foreground">
              {en
                ? `${household.alternatives + 1} households match this name — a reference number is the only way to tell them apart.`
                : `${household.alternatives + 1} أسر تطابق هذا الاسم — الرقم المرجعي وحده يفصل بينها.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {hasDuplicate ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed"
        >
          <p className="font-medium text-foreground">
            {en
              ? 'A citizen with a very similar identity is already on file.'
              : 'يوجد مواطن مسجَّل بهوية شديدة الشبه.'}
          </p>
          <p className="pt-1 text-muted-foreground">
            {en
              ? 'Check the mother’s name and date of birth against the existing record before saving — two cousins often share all three names.'
              : 'راجع اسم الأم وتاريخ الولادة قبل الحفظ — كثيراً ما يتطابق الاسم الثلاثي بين ابنَي عم.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
