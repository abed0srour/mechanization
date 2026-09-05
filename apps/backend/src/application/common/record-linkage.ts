/**
 * Record linkage — deciding whether two records describe the same thing.
 *
 * Written once, generically, because the register asks this question in more
 * than one place and the wrong answer costs the same each time. A citizen
 * arriving at the counter may be the husband a wife listed on her roster three
 * weeks ago; may be a person already on file under a different document; may be
 * the «اسم المالك» a tenant wrote on a property card. Three different pairs of
 * things, one question, and one set of rules about how confident is confident
 * enough.
 *
 * ── Why a score and not a chain of ifs ──────────────────────────────────────
 *
 * The obvious implementation is `if (sameName && sameBirthYear) link()`, and it
 * fails on the first real street. In a Lebanese village a family name is shared
 * by half the households, اسم الأب repeats down every branch, and two first
 * cousins routinely carry an identical three-part name. Meanwhile the fields
 * that would settle it — اسم الأم, a birth date — are the ones most often
 * missing, because the register deliberately accepts records with fields the
 * officer could not establish.
 *
 * So evidence has to accumulate rather than gate. Each feature contributes a
 * log-odds weight, the weights add, and the total is compared against
 * thresholds. That is Fellegi–Sunter, and the two properties that matter here
 * fall straight out of it: a single rare agreement (a matching اسم الأم) can
 * outweigh three common ones, and a missing field can contribute *nothing*
 * rather than being forced to count for or against.
 *
 * ── The three rules that keep it honest ─────────────────────────────────────
 *
 * 1. **UNKNOWN is not DISAGREE.** A field absent on either side is silence, and
 *    silence is worth zero. Scoring a missing اسم الأم as a mismatch would
 *    penalise exactly the incomplete records the flag system exists to admit,
 *    and would turn the register's tolerance for gaps into a reason never to
 *    link anything.
 *
 * 2. **Three outcomes, never two.** The costs are wildly asymmetric. A wrong
 *    link merges two families, puts somebody else's children on a man's file,
 *    and is genuinely hard to unpick once later edits settle on top of it. A
 *    missed link costs one duplicate household that a clerk can merge at
 *    leisure. So the band between "certain" and "nothing" is a review queue,
 *    not a coin toss offered to whoever is standing at the counter.
 *
 * 3. **A close second means no.** See `decide`. This is the rule the village
 *    actually needs and the one a naive scorer omits.
 */

import { normalizeSearchText } from './search-terms';

/** How one feature compared a pair. */
export type Agreement = 'AGREE' | 'DISAGREE' | 'UNKNOWN';

/**
 * One comparable fact about a pair, and what agreeing on it is worth.
 *
 * Weights are log2 likelihood ratios: `+3` means agreement here is roughly
 * eight times more likely between two records of the same person than between
 * two records picked at random. They are stated in that unit rather than as
 * percentages so they can simply be summed, and so a feature's weight can be
 * computed per-pair — which is what `frequencyWeight` exists for.
 */
export interface LinkageFeature<S, C> {
  /** Stable identifier, printed in the contribution list a reviewer reads. */
  name: string;

  compare(subject: S, candidate: C): Agreement;

  /**
   * Added on AGREE. A function when the weight depends on the values compared —
   * agreeing on «خليل» in a town that is half خليل is worth far less than
   * agreeing on a rare name, and only the pair knows which it was.
   */
  agree: number | ((subject: S, candidate: C) => number);

  /**
   * Added on DISAGREE. Negative, and **defaults to zero on purpose.**
   *
   * Disagreement is only evidence where the field is one the same person could
   * not plausibly differ on. Two records of one man cannot hold birth years
   * twenty years apart, so that disagreement is strong. Two records of one man
   * routinely hold different phone numbers, different spellings, and a name he
   * gave in full to one clerk and in short to another — penalising those would
   * make the scorer punish ordinary human data entry.
   */
  disagree?: number;
}

/** What the engine concluded about one pair. */
export type LinkageOutcome = 'LINK' | 'REVIEW' | 'NO_MATCH';

/**
 * Where the two cut points sit, and how far clear the winner has to be.
 *
 * `link` and `review` are in the same log2 units as the feature weights.
 * `margin` is the ambiguity rule — see `decide`.
 */
export interface LinkageThresholds {
  link: number;
  review: number;
  margin: number;
}

/** One feature's verdict on one pair, kept so a reviewer can see the working. */
export interface FeatureContribution {
  name: string;
  agreement: Agreement;
  weight: number;
}

export interface LinkageScore {
  score: number;
  contributions: FeatureContribution[];
}

/** A subject, a candidate, and the rules for comparing them. */
export interface LinkageSpec<S, C> {
  features: ReadonlyArray<LinkageFeature<S, C>>;
  thresholds: LinkageThresholds;
}

/** One candidate, scored. */
export interface ScoredCandidate<C> {
  candidate: C;
  score: number;
  contributions: FeatureContribution[];
}

/**
 * Why the engine concluded what it did.
 *
 * Returned rather than left for the caller to derive, because `AMBIGUOUS` and
 * `BELOW_LINK` both produce `REVIEW` and mean opposite things to the person
 * working the queue: one is "we found two of these", the other is "we are not
 * sure about this one". A queue that cannot tell them apart is a queue worked
 * in the wrong order.
 */
export type LinkageReason = 'CONFIDENT' | 'AMBIGUOUS' | 'BELOW_LINK' | 'NO_CANDIDATE';

export interface Resolution<C> {
  outcome: LinkageOutcome;
  reason: LinkageReason;
  /** Highest-scoring candidate, or null when nothing cleared `review`. */
  best: ScoredCandidate<C> | null;
  /**
   * The one behind it, when there was one. Present precisely so a reviewer
   * looking at an `AMBIGUOUS` result can see what it was confused with.
   */
  runnerUp: ScoredCandidate<C> | null;
  /** Everything that cleared `review`, best first. */
  shortlist: ReadonlyArray<ScoredCandidate<C>>;
}

/**
 * More candidates than this and the blocking predicate is not doing its job.
 *
 * Scoring is cheap per pair and this is not about CPU: a block returning two
 * hundred people has selected on something as unspecific as a family name, and
 * the top score in such a set is likelier to be the most *common* record than
 * the right one. Truncating would hide that, so the cap exists for the caller
 * to notice and narrow its block instead.
 */
export const MAX_CANDIDATES = 100;

/** Adds up what every feature had to say about one pair. */
export function scorePair<S, C>(
  subject: S,
  candidate: C,
  features: ReadonlyArray<LinkageFeature<S, C>>,
): LinkageScore {
  const contributions: FeatureContribution[] = [];
  let score = 0;

  for (const feature of features) {
    const agreement = feature.compare(subject, candidate);

    const weight =
      agreement === 'AGREE'
        ? typeof feature.agree === 'function'
          ? feature.agree(subject, candidate)
          : feature.agree
        : agreement === 'DISAGREE'
          ? (feature.disagree ?? 0)
          : 0;

    score += weight;
    contributions.push({ name: feature.name, agreement, weight });
  }

  return { score, contributions };
}

/**
 * The decision, including the rule that makes this usable in a village.
 *
 * A high score alone is not enough. If the best candidate scores 9 and the next
 * scores 8.5, the engine has not identified anybody — it has found two records
 * that both look like the subject, which where cousins share three names is the
 * ordinary shape of a hard case rather than a rare one. Linking to the higher of
 * two indistinguishable candidates is a coin toss dressed as a decision, and it
 * fails silently: nothing downstream can tell that the loser existed.
 *
 * So a winner has to be clear of the runner-up by `margin` before it may link.
 * Both go to the reviewer instead, which is an outcome a person can actually
 * resolve — by asking the citizen a question neither record answers.
 */
export function decide<C>(
  scored: ReadonlyArray<ScoredCandidate<C>>,
  thresholds: LinkageThresholds,
): Resolution<C> {
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const shortlist = ranked.filter((entry) => entry.score >= thresholds.review);

  const best = shortlist[0] ?? null;
  const runnerUp = shortlist[1] ?? null;

  if (!best) {
    return { outcome: 'NO_MATCH', reason: 'NO_CANDIDATE', best: null, runnerUp: null, shortlist };
  }

  if (best.score < thresholds.link) {
    return { outcome: 'REVIEW', reason: 'BELOW_LINK', best, runnerUp, shortlist };
  }

  if (runnerUp && best.score - runnerUp.score < thresholds.margin) {
    return { outcome: 'REVIEW', reason: 'AMBIGUOUS', best, runnerUp, shortlist };
  }

  return { outcome: 'LINK', reason: 'CONFIDENT', best, runnerUp, shortlist };
}

/** Score every candidate against the subject, then decide. */
export function resolve<S, C>(
  subject: S,
  candidates: ReadonlyArray<C>,
  spec: LinkageSpec<S, C>,
): Resolution<C> {
  const scored = candidates.map((candidate) => ({
    candidate,
    ...scorePair(subject, candidate, spec.features),
  }));

  return decide(scored, spec.thresholds);
}

// ────────────────────────  Comparison primitives  ────────────────────────

/**
 * A name as the set of tokens it folds to.
 *
 * The same fold `searchText` and the search box already use, so «أحمد نصرالله»
 * and «احمد نصر الله» reduce alike and a hamza typed one way matches one typed
 * the other. Deduplicated, because a repeated token is not a second agreement.
 */
export function nameTokens(...parts: ReadonlyArray<string | null | undefined>): Set<string> {
  const folded = normalizeSearchText(parts.filter(Boolean).join(' '));
  return new Set(folded.split(' ').filter((token) => token.length > 1));
}

/** How many tokens two names share. */
export function sharedTokens(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((token) => right.has(token));
}

/**
 * Above this, a token's rarity stops earning more weight.
 *
 * A name appearing once in the register is not proof of anything — it is as
 * likely to be a misspelling of a common one, and an uncapped weight would let
 * a single typo link two strangers on its own.
 */
export const MAX_TOKEN_WEIGHT = 6;

/**
 * Below this many citizens, the register cannot estimate how common a name is.
 *
 * This is not a tuning knob, it is the point where the arithmetic stops meaning
 * anything. A municipality on its first afternoon holds three records, all of
 * one extended family — so «نصرالله» occurs 3 times out of 3, `log2(3/3)` is
 * **zero**, and every name token in the register scores nothing at all. The
 * scorer would conclude that names carry no information, and no slot would ever
 * be matched to anybody until hundreds of records had accumulated.
 *
 * The frequency is not wrong; the sample is. Three observations say nothing
 * about how common a name is in the town, so below this floor the rarity term
 * is not estimated at all and a neutral weight is used instead.
 */
export const MIN_CORPUS_FOR_FREQUENCY = 200;

/** What one shared token is worth while the register is too small to measure. */
export const UNMEASURED_TOKEN_WEIGHT = 2;

/**
 * What agreeing on one token is worth, from how common it is in *this* register.
 *
 * The single largest improvement available to a name comparison, and one the
 * register can compute for itself — once it holds enough to compute from.
 * Agreeing on «خليل» where two in five households are خليل is nearly no
 * evidence at all, while agreeing on a name held by one family is close to an
 * identifier. A scorer weighting both the same will, in a town with a dominant
 * family name, quietly rank every stranger above the actual relative.
 */
export function frequencyWeight(occurrences: number, total: number): number {
  if (total < MIN_CORPUS_FOR_FREQUENCY) return UNMEASURED_TOKEN_WEIGHT;
  if (occurrences <= 0) return MAX_TOKEN_WEIGHT;
  return Math.min(Math.log2(total / occurrences), MAX_TOKEN_WEIGHT);
}

/** Token → how many citizens carry it, over the whole municipality. */
export interface TokenFrequencies {
  total: number;
  counts: ReadonlyMap<string, number>;
}

/** The summed rarity of every token two names have in common. */
export function sharedNameWeight(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
  frequencies: TokenFrequencies,
): number {
  return sharedTokens(left, right).reduce(
    (sum, token) => sum + frequencyWeight(frequencies.counts.get(token) ?? 1, frequencies.total),
    0,
  );
}

/**
 * Two years, where one being absent is silence rather than difference.
 *
 * `tolerance` is not sloppiness: a birth *year* recited by a relative is
 * routinely a year out, and demanding exactness would discard the feature's
 * usefulness to protect a precision the source never had.
 */
export function compareYear(
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance = 1,
): Agreement {
  if (left == null || right == null) return 'UNKNOWN';
  return Math.abs(left - right) <= tolerance ? 'AGREE' : 'DISAGREE';
}

/** Two folded strings, where either being empty is silence. */
export function compareText(
  left: string | null | undefined,
  right: string | null | undefined,
): Agreement {
  const a = normalizeSearchText(left ?? '');
  const b = normalizeSearchText(right ?? '');
  if (!a || !b) return 'UNKNOWN';
  return a === b ? 'AGREE' : 'DISAGREE';
}

/**
 * Whether two sets of contact numbers touch.
 *
 * A set on each side rather than a field, because a household's numbers are
 * plural and interchangeable — the number a wife gives as her own is routinely
 * the one her husband gives as his alternate.
 *
 * Disjoint sets return UNKNOWN, not DISAGREE, and that is the deliberate part:
 * two records of one household holding different phone numbers is the ordinary
 * case, not evidence they are different households.
 */
export function comparePhones(
  left: ReadonlyArray<string | null | undefined>,
  right: ReadonlyArray<string | null | undefined>,
): Agreement {
  const a = new Set(left.filter((value): value is string => Boolean(value)));
  const b = new Set(right.filter((value): value is string => Boolean(value)));
  if (a.size === 0 || b.size === 0) return 'UNKNOWN';
  return [...a].some((value) => b.has(value)) ? 'AGREE' : 'UNKNOWN';
}
