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
export function formatLbp(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US')} ل.ل`;
}

/**
 * How many decimals a scaled figure keeps.
 *
 * Below ten the second decimal is real information — 5.5 مليون and 5.55 مليون
 * are 50,000 ل.ل apart, which is a fee. Above ten it is noise: at 123.45 مليون
 * the last digit is 10,000 ل.ل against a number where the reader only wants
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
 *
 * The threshold is one million rather than one thousand deliberately. Six
 * digits grouped (`500,000 ل.ل`) still fits any cell here and is exact, so
 * abbreviating it would trade precision for nothing. Seven and up is where a
 * table cell, a KPI tile or a summary row starts to wrap — so that is where
 * the shorthand starts.
 *
 * Always pair this with the exact value somewhere reachable — see `Money`,
 * which puts it in a tooltip and a `title`. A rounded figure with no way back
 * to the real one is not a number a clerk can act on.
 */
export function formatLbpCompact(amount: number): string {
  const magnitude = Math.abs(amount);
  if (magnitude < MILLION) return formatLbp(amount);

  /**
   * The unit is chosen from the *rounded* figure, not the raw one.
   *
   * Picking it from the raw magnitude alone puts 999,999,999 just under the
   * billion threshold, scales it to 999.999999 million, and then rounds that
   * to `1000 مليون` — a thousand of a unit that has a name of its own, which
   * reads as an off-by-a-factor bug even though the value is right. Anything
   * that rounds up to four digits belongs in the next unit up.
   */
  const millions = scaled(amount / MILLION);
  if (magnitude < BILLION && Math.abs(Number(millions)) < 1000) {
    return `${millions} مليون ل.ل`;
  }

  // مليار is the ceiling on purpose: a municipality's outstanding total runs
  // to tens of billions of pounds at the current nominal scale, and there is
  // no honest use here for a unit above that.
  return `${scaled(amount / BILLION)} مليار ل.ل`;
}
