/**
 * Lebanese pound formatting.
 *
 * LBP has no minor unit in practice and a very large nominal scale: a routine
 * household fee runs to seven figures, and a municipality-wide outstanding
 * total to nine or ten. Written out in full that is `1,250,000,000 ل.ل` — 17
 * characters — which is why the compact form below exists and why nothing that
 * renders money is given a fixed width.
 *
 * Digits stay Latin (`en-US` grouping) to match the rest of the portal: a
 * reference number, a phone number and an amount are all read character by
 * character against a printed slip, and mixing Arabic-Indic digits into that
 * would make two of the three unverifiable at a glance.
 */

const MILLION = 1_000_000;
const BILLION = 1_000_000_000;

/** Grouped to the last pound — what a receipt has to say. */
export function formatLbp(amount: number, locale: string = 'ar'): string {
  const formatted = Math.round(amount).toLocaleString('en-US');
  return locale === 'en' ? `${formatted} LBP` : `${formatted} ل.ل`;
}

/**
 * How many decimals a scaled figure keeps.
 *
 * Below ten the second decimal is real information — 5.5 million and 5.55 million
 * are 50,000 LBP apart, which is a fee. Above ten it is noise: at 123.45 million
 * the last digit is 10,000 LBP against a number where the reader only wants
 * the magnitude, and the extra glyphs cost more than they say.
 */
function scaled(value: number): string {
  const digits = Math.abs(value) < 10 ? 2 : 1;
  // `toFixed` then `Number` strips the trailing zeros `toFixed` insists on,
  // so 5.00 prints as 5 rather than as a falsely precise 5.00.
  return String(Number(value.toFixed(digits)));
}

/** True when `amount` is large enough that `formatLbp` would be unwieldy. */
export function isCompactable(amount: number): boolean {
  return Math.abs(amount) >= MILLION;
}

/**
 * Shorthand for anything in the millions or above; exact below that.
 */
export function formatLbpCompact(amount: number, locale: string = 'ar'): string {
  const magnitude = Math.abs(amount);
  if (magnitude < MILLION) return formatLbp(amount, locale);

  const millions = scaled(amount / MILLION);
  if (magnitude < BILLION && Math.abs(Number(millions)) < 1000) {
    return locale === 'en' ? `${millions}M LBP` : `${millions} مليون ل.ل`;
  }

  return locale === 'en' ? `${scaled(amount / BILLION)}B LBP` : `${scaled(amount / BILLION)} مليار ل.ل`;
}
