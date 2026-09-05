import { resolve } from '../../common/record-linkage';
import {
  householdMemberSpec,
  householdSlotSpec,
  toNameSet,
  type LinkageSubject,
  type MemberCandidate,
} from './household-linkage';

/**
 * Filling a slot inside a household the رقم مرجعي already identified.
 *
 * A different question from the open search, and the difference is what these
 * pin down. *Which household* was settled with certainty by the reference, so
 * the household-level evidence — the head's name, سجل and phone — is deliberately
 * withheld: it is identical for every candidate here, so scoring it would lift
 * the whole field over the link threshold while separating nobody. Only what
 * tells one slot from another may count.
 *
 * See `HouseholdsService.matchWithinHousehold`, which builds candidates exactly
 * this way.
 */

const frequencies = {
  total: 1000,
  counts: new Map([
    ['خليل', 400],
    ['علي', 300],
    ['حسن', 250],
    ['حسين', 200],
    ['نور', 90],
  ]),
};

const arriving = (over: Partial<LinkageSubject> = {}): LinkageSubject => ({
  name: toNameSet('علي', 'حسن', 'خليل'),
  motherName: null,
  birthYear: 1980,
  gender: 'MALE',
  civilRecordKey: null,
  phones: [],
  ownedParcelNumbers: new Set<string>(),
  ...over,
});

/** A slot as `matchWithinHousehold` builds it: no household-level evidence. */
const slot = (
  id: string,
  fullName: string,
  over: Partial<MemberCandidate> = {},
): MemberCandidate => ({
  memberId: id,
  householdId: 'h-1',
  name: toNameSet(fullName),
  birthYear: null,
  gender: null,
  relationToHead: 'OTHER',
  headName: new Set<string>(),
  headCivilRecordKey: null,
  householdPhones: [],
  ...over,
});

const match = (subject: LinkageSubject, candidates: MemberCandidate[]) =>
  resolve(subject, candidates, householdSlotSpec(frequencies));

describe('claiming a slot inside a known household', () => {
  it('fills the husband slot his wife described', () => {
    const result = match(arriving(), [
      slot('husband', 'علي حسن خليل', {
        relationToHead: 'SPOUSE',
        birthYear: 1980,
        gender: 'MALE',
      }),
      slot('son', 'حسين علي خليل', {
        relationToHead: 'CHILD',
        birthYear: 2010,
        gender: 'MALE',
      }),
      slot('daughter', 'نور علي خليل', {
        relationToHead: 'CHILD',
        birthYear: 2014,
        gender: 'FEMALE',
      }),
    ]);

    expect(result.outcome).toBe('LINK');
    expect(result.best?.candidate.memberId).toBe('husband');
  });

  /*
    A slot keeps the relation whoever described it gave. The wife answered
    «زوج» weeks ago; re-asking at the counter invites a clerk to overwrite her
    with a guess, which is why `link` does not take a relation when a slot is
    being filled.
  */
  it('carries the relation the describer stated, not one inferred now', () => {
    const result = match(arriving(), [
      slot('husband', 'علي حسن خليل', { relationToHead: 'SPOUSE', birthYear: 1980 }),
    ]);

    expect(result.best?.candidate.relationToHead).toBe('SPOUSE');
  });

  /*
    Two brothers a roster describes identically. The reference proved the family
    and proves nothing about which of them this is — so the honest outcome is a
    new row the officer labels, not a coin toss between two slots.
  */
  it('refuses to choose between two identically-described siblings', () => {
    const result = match(arriving({ birthYear: null }), [
      slot('brother-a', 'علي حسن خليل', { relationToHead: 'SIBLING' }),
      slot('brother-b', 'علي حسن خليل', { relationToHead: 'SIBLING' }),
    ]);

    expect(result.outcome).not.toBe('LINK');
  });

  it('finds nothing when no slot describes this person', () => {
    const result = match(arriving(), [
      slot('daughter', 'نور علي خليل', { relationToHead: 'CHILD', gender: 'FEMALE' }),
    ]);

    expect(result.outcome).toBe('NO_MATCH');
  });

  /*
    The reason the household-level features are dropped. Left in, every slot
    would collect the head's name, سجل and phone identically — a constant added
    to the whole field, lifting a daughter over the link threshold on evidence
    that says nothing about her.
  */
  it('ignores household-wide evidence entirely, however loudly it agrees', () => {
    const subject = arriving({ phones: ['+96170111222'], civilRecordKey: '45@صور' });
    const candidate: MemberCandidate = {
      ...slot('sibling', 'علي حسن خليل', { relationToHead: 'SIBLING' }),
      // Everything the whole household shares, agreeing loudly.
      headName: toNameSet('علي', 'حسن', 'خليل'),
      headCivilRecordKey: '45@صور',
      householdPhones: ['+96170111222'],
    };

    const bare: MemberCandidate = {
      ...candidate,
      headName: new Set<string>(),
      headCivilRecordKey: null,
      householdPhones: [],
    };

    // Identical under the slot spec: none of that evidence is read.
    expect(match(subject, [candidate]).best?.score).toBe(match(subject, [bare]).best?.score);

    // And it plainly *would* have counted under the open search, which is the
    // whole reason this spec exists.
    const openSearch = resolve(subject, [candidate], householdMemberSpec(frequencies));
    expect(openSearch.best!.score).toBeGreaterThan(match(subject, [candidate]).best!.score);
  });

  it('finds nothing in an empty roster rather than inventing a slot', () => {
    expect(match(arriving(), []).outcome).toBe('NO_MATCH');
  });
});

/**
 * The case this was actually reported on, on the register it was reported on.
 *
 * A father is filed with his children on the roster. His son arrives, gives the
 * father's رقم مرجعي, and should land in the `CHILD` slot already describing
 * him. It did not: the register held three records, all one family, so every
 * name token measured as maximally common and scored zero — leaving a birth
 * year as the only evidence, which never reached the bar.
 */
describe('a son joining his father, on a register three records old', () => {
  const newRegister = {
    total: 3,
    counts: new Map([
      ['nasrallah', 3],
      ['ibrahim', 2],
      ['hashem', 2],
    ]),
  };

  const son: LinkageSubject = {
    name: toNameSet('hashem', 'ibrahim', 'nasrallah'),
    motherName: null,
    birthYear: 2005,
    gender: 'MALE',
    civilRecordKey: null,
    phones: [],
    ownedParcelNumbers: new Set<string>(),
  };

  const fathersRoster: MemberCandidate[] = [
    slot('hussein', 'hussein ibrahim nasrallah', { relationToHead: 'CHILD', birthYear: 2002 }),
    slot('hashem', 'hashem ibrahim nasrallah', { relationToHead: 'CHILD', birthYear: 2005 }),
    slot('aya', 'aya ibrahim nasrallah', { relationToHead: 'CHILD', birthYear: 2012 }),
    slot('ali', 'ali ibrahim nasrallah', { relationToHead: 'CHILD', birthYear: 2017 }),
    slot('khoulod', 'khoulod fayad kenaan', { relationToHead: 'SPOUSE', birthYear: 1978 }),
  ];

  it('fills the son’s own slot rather than appending a stranger', () => {
    const result = resolve(son, fathersRoster, householdSlotSpec(newRegister));

    expect(result.outcome).toBe('LINK');
    expect(result.best?.candidate.memberId).toBe('hashem');
  });

  /*
    The brother is the near-miss that matters: he shares two of three name
    tokens and differs only by a birth year. Three years apart is what has to
    carry the decision, and it does.
  */
  it('is not confused by the brother three years older', () => {
    const result = resolve(son, fathersRoster, householdSlotSpec(newRegister));
    const brother = result.shortlist.find((entry) => entry.candidate.memberId === 'hussein');

    expect(brother).toBeUndefined();
  });

  it('would have found nobody at all under measured frequencies', () => {
    // What the register actually computed before the floor existed: every token
    // present in all three records, so every shared name worth exactly zero.
    const degenerate = {
      total: 3,
      counts: new Map([
        ['nasrallah', 3],
        ['ibrahim', 3],
        ['hashem', 3],
      ]),
    };
    const nameWeightOnly = resolve(
      { ...son, birthYear: null },
      fathersRoster,
      householdSlotSpec(degenerate),
    );

    // Names alone still cannot link — but they are no longer worth nothing,
    // which is what let the birth year decide the case above.
    expect(nameWeightOnly.outcome).not.toBe('LINK');
    expect(nameWeightOnly.best?.score ?? 0).toBeGreaterThan(0);
  });
});
