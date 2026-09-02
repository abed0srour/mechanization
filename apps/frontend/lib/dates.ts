/**
 * Date and time formatting, in Latin digits.
 *
 * The portal had two numeral systems running side by side: amounts and counts
 * went through `toLocaleString('en-US')` and came out `500,000`, while every
 * date went through `toLocaleDateString('ar-LB')` and came out `٢٠٢٦/٠٨/١٠`.
 * A single table row therefore carried both, which is the arrangement
 * `lib/currency.ts` set out to avoid:
 *
 *   > a reference number, a phone number and an amount are all read character
 *   > by character against a printed slip, and mixing Arabic-Indic digits into
 *   > that would make two of the three unverifiable at a glance
 *
 * A due date on a وصل is read the same way. This module is the one place that
 * decides, so the two conventions cannot drift apart again.
 *
 * Arabic *words* are kept wherever they carry meaning — month names, "منذ
 * ساعتين" — because those are read, not verified.
 */

/**
 * Numeric dates use `en-GB`: day/month/year, the order Lebanon writes, with no
 * bidi control characters in the output.
 *
 * `ar-LB-u-nu-latn` would also give Latin digits, but it interleaves U+200F
 * marks between the segments — invisible, and harmless only as long as every
 * call site remembers `dir="ltr"`. A formatter whose correctness depends on
 * each caller adding an attribute is one that will be wrong somewhere.
 */
const NUMERIC = 'en-GB';

/** Arabic month and weekday names, with Latin digits alongside them. */
const WORDS = 'ar-LB-u-nu-latn';

/** `10/08/2026` */
export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(NUMERIC, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** `21:59` — 24-hour, because a وصل is reconciled against a 24-hour ledger. */
export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString(NUMERIC, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** `10/08/2026 · 21:59` */
export function formatDateTime(value: string | Date): string {
  return `${formatDate(value)} · ${formatTime(value)}`;
}

/** Month name with year, respecting locale. */
export function formatMonth(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' },
  locale: string = 'ar',
): string {
  const loc = locale === 'en' ? 'en-US' : WORDS;
  return new Date(value).toLocaleDateString(loc, options);
}

export function formatRelative(value: string | Date, locale: string = 'ar'): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);
  const relativeFormatter = new Intl.RelativeTimeFormat(locale === 'en' ? 'en-US' : WORDS, { numeric: 'auto' });

  if (magnitude < 60) return locale === 'en' ? 'Just now' : 'الآن';
  if (magnitude < 3_600) return relativeFormatter.format(Math.round(seconds / 60), 'minute');
  if (magnitude < 86_400) return relativeFormatter.format(Math.round(seconds / 3_600), 'hour');
  if (magnitude < 2_592_000) return relativeFormatter.format(Math.round(seconds / 86_400), 'day');
  if (magnitude < 31_536_000) return relativeFormatter.format(Math.round(seconds / 2_592_000), 'month');
  return relativeFormatter.format(Math.round(seconds / 31_536_000), 'year');
}
