/**
 * The three questions the register actually asks, expressed over one engine.
 *
 * `record-linkage.ts` knows nothing about people or parcels — it knows how to
 * add up evidence and when to refuse to decide. This file supplies the evidence:
 * which facts are comparable for each kind of pair, and what agreeing on each is
 * worth. Adding a fourth question later is adding a spec here, not another
 * scorer.
 *
 *  - `householdMemberSpec` — an arriving citizen against the unlinked roster
 *    rows other households have already described. «Is this the husband Fatima
 *    listed three weeks ago?»
 *  - `duplicateCitizenSpec` — an arriving citizen against citizens already on
 *    file. «Is this a person we have, under a document we did not see?»
 *  - `landlordSpec` — a registered owner against the «اسم المالك» tenants wrote
 *    on their own cards. «Is the father who just registered the man his son
 *    named as landlord last month?»
 *
 * Every spec is a *factory* taking the register's token frequencies, because the
 * weight of agreeing on a name is a fact about this municipality rather than
 * about names — see `frequencyWeight`.
 */

import {
  compareText,
  compareYear,
  comparePhones,
  frequencyWeight,
  nameTokens,
  sharedNameWeight,
  sharedTokens,
  type Agreement,
  type LinkageFeature,
  type LinkageSpec,
  type TokenFrequencies,
} from '../../common/record-linkage';

/**
 * The person being placed, in the shape every spec compares against.
 *
 * Built once by the caller from whatever it has — a submitted form, or a row
 * already in the database — so a citizen can be resolved while they are being
 * typed as well as after they are stored.
 */
export interface LinkageSubject {
  /** Absent while the citizen is being registered and has no row yet. */
  citizenId?: string;
  name: Set<string>;
  motherName: string | null;
  birthYear: number | null;
  gender: string | null;
  /**
   * رقم السجل and محل القيد, folded together into one comparable key.
   *
   * Together, because neither identifies anything alone: every village in
   * Lebanon has a سجل ٤٥, so the number without its محلة is half a value. See
   * `civilRecordKey`.
   */
  civilRecordKey: string | null;
  phones: ReadonlyArray<string | null | undefined>;
  /** أرقام العقارات this person has registered as owner. Used by `landlordSpec`. */
  ownedParcelNumbers: ReadonlySet<string>;
}

/** An unlinked roster row somebody else described. */
export interface MemberCandidate {
  memberId: string;
  householdId: string;
  name: Set<string>;
  birthYear: number | null;
  gender: string | null;
  relationToHead: string;
  /** Facts about the household this slot belongs to, for the pair-level features. */
  headName: Set<string>;
  headCivilRecordKey: string | null;
  householdPhones: ReadonlyArray<string | null | undefined>;
}

/** A citizen already on file. */
export interface CitizenCandidate {
  citizenId: string;
  name: Set<string>;
  motherName: string | null;
  birthYear: number | null;
  gender: string | null;
  civilRecordKey: string | null;
  phones: ReadonlyArray<string | null | undefined>;
}

/** An «اسم المالك» written on a card somebody else filed. */
export interface LandlordCandidate {
  propertyEntryId: string;
  filedByCitizenId: string;
  name: Set<string>;
  landlordPhone: string | null;
  propertyNumber: string | null;
}

/**
 * رقم السجل and محل القيد as one key, or null when either half is missing.
 *
 * The doc that prompted this treated «same سجل» as evidence that two people are
 * a couple, and it is not: a سجل identifies a **patrilineal family record**, so
 * a man, his father, his brothers, his unmarried sisters, his sons and his sons'
 * wives all carry the same one. In a village it covers dozens of living people
 * across three generations.
 *
 * It fails in the other direction too — a marriage not yet registered with the
 * نفوس leaves a wife on her father's سجل, sometimes for years, and a non-Lebanese
 * spouse has none at all.
 *
 * So it is built here as a key and used two ways: as the cheap **blocking**
 * predicate that bounds the candidate set (different سجل, almost certainly not
 * the same family, do not even score the pair), and as a **small** positive
 * weight below. Small on purpose: within a block where nearly every candidate
 * shares it, it separates almost nobody.
 */
export function civilRecordKey(
  number: string | null | undefined,
  town: string | null | undefined,
): string | null {
  const record = (number ?? '').trim();
  const place = (town ?? '').trim();
  if (!record || !place) return null;
  return `${record}@${place}`.toLowerCase();
}

/** Convenience for callers assembling a subject or candidate from raw columns. */
export function toNameSet(...parts: ReadonlyArray<string | null | undefined>): Set<string> {
  return nameTokens(...parts);
}

/** A full date narrowed to the year, which is all any roster row can offer. */
export function yearOf(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}

/**
 * How two names compare, before any weighting.
 *
 * Two shared tokens is the floor for agreement — in practice a given name and a
 * family name — because one alone is met by half the town. One shared token is
 * `UNKNOWN` rather than `DISAGREE`: it is too little to call either way, and a
 * short name («علي خليل») legitimately produces only two tokens to begin with.
 *
 * No overlap at all, with both names present, is real evidence against.
 */
function compareNames(left: ReadonlySet<string>, right: ReadonlySet<string>): Agreement {
  if (left.size === 0 || right.size === 0) return 'UNKNOWN';
  const shared = sharedTokens(left, right).length;
  if (shared >= 2) return 'AGREE';
  return shared === 1 ? 'UNKNOWN' : 'DISAGREE';
}

/**
 * The gender feature, whose value is almost entirely in its disagreement.
 *
 * Agreeing is worth next to nothing — half the register agrees with any subject.
 * Disagreeing is close to decisive: a roster slot recorded as a daughter is not
 * filled by a man, whatever the names say. This asymmetry is why `disagree` is a
 * per-feature weight rather than a mirror of `agree`.
 */
const GENDER_AGREE = 0.5;
const GENDER_DISAGREE = -6;

/**
 * See `civilRecordKey`. Deliberately one of the smallest positive weights here,
 * and the doc's «Clue 2» is the reason it is not larger.
 */
const CIVIL_RECORD_AGREE = 1.5;

/** Names alone can carry a pair only so far, however rare they are. */
const MAX_NAME_WEIGHT = 10;

function nameWeight(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
  frequencies: TokenFrequencies,
): number {
  return Math.min(sharedNameWeight(left, right, frequencies), MAX_NAME_WEIGHT);
}

// ──────────────  Question 1: does this citizen fill a roster slot?  ──────────────

export function householdMemberSpec(
  frequencies: TokenFrequencies,
): LinkageSpec<LinkageSubject, MemberCandidate> {
  const features: Array<LinkageFeature<LinkageSubject, MemberCandidate>> = [
    {
      name: 'member.name',
      compare: (subject, candidate) => compareNames(subject.name, candidate.name),
      agree: (subject, candidate) => nameWeight(subject.name, candidate.name, frequencies),
      disagree: -4,
    },
    {
      /**
       * Two years of tolerance, not none.
       *
       * The roster row was recited by a relative rather than read off a
       * document, and a year either side is the normal error in that. Demanding
       * exactness would throw away the feature to protect a precision the source
       * never had — while a gap of five years still reads as a different person.
       */
      name: 'member.birthYear',
      compare: (subject, candidate) => compareYear(subject.birthYear, candidate.birthYear, 2),
      agree: 3,
      disagree: -4,
    },
    {
      name: 'member.gender',
      compare: (subject, candidate) => compareText(subject.gender, candidate.gender),
      agree: GENDER_AGREE,
      disagree: GENDER_DISAGREE,
    },
    {
      name: 'household.civilRecord',
      compare: (subject, candidate) =>
        compareText(subject.civilRecordKey, candidate.headCivilRecordKey),
      agree: CIVIL_RECORD_AGREE,
      /**
       * Zero, and this one matters. A wife whose marriage has not yet reached
       * the نفوس still carries her father's سجل, so a mismatch here is a
       * routine administrative lag rather than proof of a different family.
       */
      disagree: 0,
    },
    {
      /**
       * The alternate contact earning its place.
       *
       * A wife listing her husband's mobile as the household's second number is
       * the commonest way this fires, and it is third-party corroboration: the
       * number was written down by somebody else, weeks earlier, before anyone
       * knew it would be compared.
       */
      name: 'household.phone',
      compare: (subject, candidate) => comparePhones(subject.phones, candidate.householdPhones),
      agree: 2.5,
    },
    {
      /**
       * Whether the household's head shares a family name with the subject.
       *
       * Weaker than the slot's own name and independent of it: a slot may have
       * been written down as «علي» alone, in which case the head's شهرة is the
       * only surname evidence in the pair.
       */
      name: 'household.headName',
      compare: (subject, candidate) =>
        sharedTokens(subject.name, candidate.headName).length > 0 ? 'AGREE' : 'UNKNOWN',
      agree: (subject, candidate) =>
        Math.min(nameWeight(subject.name, candidate.headName, frequencies), 3),
    },
  ];

  return {
    features,
    /**
     * A slot is a smaller claim than a merged person, so the bar is lower than
     * `duplicateCitizenSpec`'s: linking here says "this man belongs to that
     * household", and unlinking is one nulled column.
     */
    thresholds: { link: 9, review: 4.5, margin: 2.5 },
  };
}

/**
 * Question 1b: *which* slot, when the household is already certain.
 *
 * The claim path — a citizen who handed over a relative's رقم مرجعي — has
 * already settled which family this is. What remains is which person inside it,
 * and that is a different question with different evidence.
 *
 * Two things follow, and both are why this is a spec of its own rather than the
 * one above with a smaller candidate list:
 *
 *  - **The household-level features are gone.** The head's name, the سجل and the
 *    household phone are identical for every slot here, so scoring them adds the
 *    same constant to the whole field — separating nobody while lifting everyone
 *    over the line. A daughter would clear a link threshold on evidence that says
 *    nothing whatever about her.
 *  - **The thresholds are lower.** Not a relaxation: the bar above is set for
 *    "is this the right *family*", answered against the whole register. Here the
 *    family is a fact, the candidates number a handful, and a full name with a
 *    matching birth year and sex is as much as this question can ever offer.
 *    Holding it to a bar calibrated for evidence that has been deliberately
 *    withheld would mean never linking anybody.
 */
export function householdSlotSpec(
  frequencies: TokenFrequencies,
): LinkageSpec<LinkageSubject, MemberCandidate> {
  const full = householdMemberSpec(frequencies);

  return {
    features: full.features.filter((feature) => feature.name.startsWith('member.')),
    /*
      Set so that the evidence this question can actually offer is enough to
      answer it: a name agreeing on two or more tokens plus an exact birth year,
      inside a household a رقم مرجعي already proved. On a register too small to
      measure name rarity that is 4 + 3; on a larger one the names carry more.
      A higher bar would mean never filling a slot and always appending a row.
    */
    thresholds: { link: 6.5, review: 3.5, margin: 2.5 },
  };
}

// ──────────────  Question 2: is this somebody we already have?  ──────────────

export function duplicateCitizenSpec(
  frequencies: TokenFrequencies,
): LinkageSpec<LinkageSubject, CitizenCandidate> {
  const features: Array<LinkageFeature<LinkageSubject, CitizenCandidate>> = [
    {
      name: 'citizen.name',
      compare: (subject, candidate) => compareNames(subject.name, candidate.name),
      agree: (subject, candidate) => nameWeight(subject.name, candidate.name, frequencies),
      disagree: -4,
    },
    {
      /**
       * اسم الأم — the strongest single feature here, and the reason it was
       * worth adding a column for.
       *
       * It is the one field that crosses the patriline. Two brothers share a
       * father, a family name and a سجل; two first cousins share the first two
       * and routinely a full three-part name. Neither pair shares a mother. So
       * this is the field that does the work every other one cannot, in exactly
       * the case — one village, one clan — where the others all agree.
       */
      name: 'citizen.motherName',
      compare: (subject, candidate) => compareText(subject.motherName, candidate.motherName),
      agree: 5,
      disagree: -6,
    },
    {
      /**
       * No tolerance, unlike the roster's birth year: both sides of this pair
       * were read off an identity document rather than recalled, so a year's
       * difference is a different person and not a rounding.
       */
      name: 'citizen.birthYear',
      compare: (subject, candidate) => compareYear(subject.birthYear, candidate.birthYear, 0),
      agree: 4,
      disagree: -6,
    },
    {
      name: 'citizen.civilRecord',
      compare: (subject, candidate) => compareText(subject.civilRecordKey, candidate.civilRecordKey),
      agree: CIVIL_RECORD_AGREE,
      disagree: 0,
    },
    {
      name: 'citizen.gender',
      compare: (subject, candidate) => compareText(subject.gender, candidate.gender),
      agree: GENDER_AGREE,
      disagree: GENDER_DISAGREE,
    },
    {
      name: 'citizen.phone',
      compare: (subject, candidate) => comparePhones(subject.phones, candidate.phones),
      agree: 2,
    },
  ];

  return {
    features,
    /**
     * The highest bar of the three. Merging two citizens moves property cards
     * and invoices onto one file, and the register's own comment on
     * `identityDocNumber` is the precedent: two people who cannot be told apart
     * stay two rows. Nothing here ever merges on its own — see
     * `HouseholdsService.resolve`, where this spec's `LINK` is reported as a
     * duplicate warning rather than acted on.
     */
    thresholds: { link: 12, review: 6, margin: 3 },
  };
}

// ──────────  Question 3: is this owner the landlord a tenant named?  ──────────

export function landlordSpec(
  frequencies: TokenFrequencies,
): LinkageSpec<LinkageSubject, LandlordCandidate> {
  const features: Array<LinkageFeature<LinkageSubject, LandlordCandidate>> = [
    {
      name: 'landlord.name',
      compare: (subject, candidate) => compareNames(subject.name, candidate.name),
      agree: (subject, candidate) => nameWeight(subject.name, candidate.name, frequencies),
      disagree: -4,
    },
    {
      /**
       * The same رقم عقار, from both ends.
       *
       * The strongest evidence available in this pair and the reason Case 4
       * costs nothing extra: a tenant naming «حسن خليل» as their landlord *on
       * the parcel Hassan Khalil has just registered as owner* is very nearly
       * conclusive, because the two facts were recorded by different people at
       * different times and neither knew of the other.
       */
      name: 'landlord.parcel',
      compare: (subject, candidate) => {
        if (!candidate.propertyNumber || subject.ownedParcelNumbers.size === 0) return 'UNKNOWN';
        return subject.ownedParcelNumbers.has(candidate.propertyNumber.trim())
          ? 'AGREE'
          : 'DISAGREE';
      },
      agree: 6,
      /**
       * Mild. A landlord may own the flat on a parcel the tenant mis-copied, and
       * an owner may hold property they have not registered yet — so a parcel
       * that does not match is a reason to doubt, not to rule out.
       */
      disagree: -2,
    },
    {
      /**
       * A phone number written down by the tenant, matching the owner's own.
       *
       * Third-party corroboration again, and stronger than the household case:
       * a tenant reciting their landlord's number is quoting the one person the
       * number belongs to.
       */
      name: 'landlord.phone',
      compare: (subject, candidate) => comparePhones(subject.phones, [candidate.landlordPhone]),
      agree: 4,
    },
  ];

  return { features, thresholds: { link: 10, review: 5, margin: 2.5 } };
}

/**
 * The token frequencies a spec needs, from raw counts.
 *
 * Exported so the service can build it from one SQL aggregate and the tests can
 * build it from a literal.
 */
export function tokenFrequencies(
  counts: ReadonlyMap<string, number>,
  total: number,
): TokenFrequencies {
  return { counts, total };
}

/** Re-exported so callers assembling weights in tests need one import. */
export { frequencyWeight };
