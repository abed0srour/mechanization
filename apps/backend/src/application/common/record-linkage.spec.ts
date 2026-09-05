import {
  comparePhones,
  compareText,
  compareYear,
  decide,
  frequencyWeight,
  nameTokens,
  resolve,
  scorePair,
  sharedNameWeight,
  type LinkageFeature,
  type LinkageSpec,
  type ScoredCandidate,
} from './record-linkage';

/**
 * The engine, independent of what it is comparing.
 *
 * These pin down the three rules that make the difference between a scorer that
 * is usable in a Lebanese village and one that quietly merges families: silence
 * is not disagreement, there is a band where nobody decides, and a winner that
 * is barely ahead of a runner-up has not won.
 */

interface Subject {
  name: string;
  year?: number | null;
}
interface Candidate {
  id: string;
  name: string;
  year?: number | null;
}

const nameFeature: LinkageFeature<Subject, Candidate> = {
  name: 'name',
  compare: (subject, candidate) => compareText(subject.name, candidate.name),
  agree: 5,
  disagree: -5,
};

const yearFeature: LinkageFeature<Subject, Candidate> = {
  name: 'year',
  compare: (subject, candidate) => compareYear(subject.year, candidate.year, 0),
  agree: 4,
  disagree: -6,
};

const spec: LinkageSpec<Subject, Candidate> = {
  features: [nameFeature, yearFeature],
  thresholds: { link: 8, review: 4, margin: 2 },
};

const scored = (id: string, score: number): ScoredCandidate<Candidate> => ({
  candidate: { id, name: id },
  score,
  contributions: [],
});

describe('scoring — silence is not disagreement', () => {
  it('adds the agreement weight when a feature agrees', () => {
    const { score } = scorePair({ name: 'علي', year: 1980 }, { id: 'a', name: 'علي', year: 1980 }, spec.features);
    expect(score).toBe(9);
  });

  it('contributes nothing at all for a field neither side has', () => {
    const { score, contributions } = scorePair(
      { name: 'علي' },
      { id: 'a', name: 'علي' },
      spec.features,
    );

    expect(score).toBe(5);
    expect(contributions.find((entry) => entry.name === 'year')).toEqual({
      name: 'year',
      agreement: 'UNKNOWN',
      weight: 0,
    });
  });

  it('contributes nothing when only one side has the field', () => {
    const { score } = scorePair({ name: 'علي', year: 1980 }, { id: 'a', name: 'علي' }, spec.features);
    expect(score).toBe(5);
  });

  it('penalises a real disagreement, which is a different thing entirely', () => {
    const { score } = scorePair(
      { name: 'علي', year: 1980 },
      { id: 'a', name: 'علي', year: 1961 },
      spec.features,
    );
    expect(score).toBe(-1);
  });

  it('folds the alphabet before comparing, so a hamza is not a difference', () => {
    expect(compareText('أحمد', 'احمد')).toBe('AGREE');
    expect(compareText('فاطمه', 'فاطمة')).toBe('AGREE');
  });

  /*
    A known limit, asserted so it is visible rather than discovered.

    The fold collapses separators to a single space; it does not remove them. So
    a name written solid and the same name written with a space are two token
    sets, and neither this nor the search box will match them. Changing it here
    alone would break the invariant migration 0018 is built on — that the query
    side and the stored `searchText` column fold identically — so it is a change
    to both or to neither.
  */
  it('does not join a name written across a space to one written solid', () => {
    expect(compareText('نصرالله', 'نصر الله')).toBe('DISAGREE');
  });

  it('reads Arabic-Indic digits as the digits they are', () => {
    expect(compareText('٤٥', '45')).toBe('AGREE');
  });
});

describe('deciding — three outcomes, never two', () => {
  it('links a clear winner', () => {
    const result = decide([scored('a', 12), scored('b', 3)], spec.thresholds);
    expect(result.outcome).toBe('LINK');
    expect(result.reason).toBe('CONFIDENT');
    expect(result.best?.candidate.id).toBe('a');
  });

  it('sends a plausible-but-not-certain match to review rather than deciding it', () => {
    const result = decide([scored('a', 6)], spec.thresholds);
    expect(result.outcome).toBe('REVIEW');
    expect(result.reason).toBe('BELOW_LINK');
  });

  it('finds nothing when nothing clears the lower threshold', () => {
    const result = decide([scored('a', 2), scored('b', 1)], spec.thresholds);
    expect(result.outcome).toBe('NO_MATCH');
    expect(result.reason).toBe('NO_CANDIDATE');
    expect(result.best).toBeNull();
  });

  it('keeps a weak candidate out of the shortlist entirely', () => {
    const result = decide([scored('a', 12), scored('b', 1)], spec.thresholds);
    expect(result.shortlist).toHaveLength(1);
    expect(result.runnerUp).toBeNull();
  });
});

describe('deciding — a close second means no', () => {
  /*
    The rule the village needs. Two cousins carrying the same three names both
    score highly against an arriving man, and linking to whichever scored a
    fraction more is a coin toss that leaves no trace of the loser.
  */
  it('refuses to link when the runner-up is within the margin', () => {
    const result = decide([scored('a', 12), scored('b', 11)], spec.thresholds);
    expect(result.outcome).toBe('REVIEW');
    expect(result.reason).toBe('AMBIGUOUS');
  });

  it('names what it was confused with, so the reviewer can see both', () => {
    const result = decide([scored('a', 12), scored('b', 11)], spec.thresholds);
    expect(result.best?.candidate.id).toBe('a');
    expect(result.runnerUp?.candidate.id).toBe('b');
  });

  it('links once the winner is clear of the field by the margin', () => {
    const result = decide([scored('a', 12), scored('b', 9.9)], spec.thresholds);
    expect(result.outcome).toBe('LINK');
  });

  it('is not fooled by a high score alone', () => {
    const runaway = decide([scored('a', 40), scored('b', 39)], spec.thresholds);
    expect(runaway.outcome).toBe('REVIEW');
    expect(runaway.reason).toBe('AMBIGUOUS');
  });

  it('ranks candidates handed to it in any order', () => {
    const result = resolve({ name: 'علي', year: 1980 }, [
      { id: 'wrong', name: 'حسن', year: 1980 },
      { id: 'right', name: 'علي', year: 1980 },
    ], spec);

    expect(result.best?.candidate.id).toBe('right');
    expect(result.outcome).toBe('LINK');
  });
});

describe('frequency weighting — a common name is not evidence', () => {
  it('is worth almost nothing when nearly everyone carries the token', () => {
    expect(frequencyWeight(900, 1000)).toBeCloseTo(0.152, 2);
  });

  it('is worth a great deal when few do', () => {
    expect(frequencyWeight(30, 1000)).toBeCloseTo(5.06, 2);
  });

  /*
    A token seen once is as likely to be a misspelling of a common name as a
    rare one, so its weight stops climbing. Without the cap a single typo would
    clear a link threshold on its own.
  */
  it('caps, so one rare token cannot link two strangers by itself', () => {
    expect(frequencyWeight(1, 10_000_000)).toBe(6);
    expect(frequencyWeight(2, 1000)).toBe(6);
  });

  it('sums the rarity of every token two names share', () => {
    const frequencies = {
      total: 1000,
      // خليل is half the town; بزي is two households.
      counts: new Map([['خليل', 500], ['بزي', 2], ['علي', 400]]),
    };

    const common = sharedNameWeight(nameTokens('علي خليل'), nameTokens('علي خليل'), frequencies);
    const rare = sharedNameWeight(nameTokens('علي بزي'), nameTokens('علي بزي'), frequencies);

    expect(rare).toBeGreaterThan(common * 2);
  });

  it('treats an unseen token as rare rather than as an error', () => {
    const frequencies = { total: 1000, counts: new Map<string, number>() };
    expect(sharedNameWeight(nameTokens('نادر'), nameTokens('نادر'), frequencies)).toBe(6);
  });

  /*
    A municipality on its first afternoon.

    Three records, all one extended family, so «نصرالله» occurs 3 times out of 3
    and `log2(3/3)` is zero. Measured, every name in the register would be worth
    nothing and no slot could ever be matched to anybody — the frequency is not
    wrong, the sample is. Below the floor the rarity term is not estimated.
  */
  it('does not read a three-record register as proof that every name is common', () => {
    const newRegister = {
      total: 3,
      counts: new Map([
        ['نصرالله', 3],
        ['هاشم', 2],
      ]),
    };

    expect(frequencyWeight(3, 3)).toBe(2);
    expect(
      sharedNameWeight(nameTokens('هاشم نصرالله'), nameTokens('هاشم نصرالله'), newRegister),
    ).toBe(4);
  });

  it('starts measuring once there is enough to measure', () => {
    const grown = { total: 400, counts: new Map([['نصرالله', 380]]) };
    expect(
      sharedNameWeight(nameTokens('نصرالله'), nameTokens('نصرالله'), grown),
    ).toBeCloseTo(0.074, 2);
  });
});

describe('comparison primitives', () => {
  it('tolerates a recited birth year being a year out', () => {
    expect(compareYear(1980, 1981, 1)).toBe('AGREE');
    expect(compareYear(1980, 1981, 0)).toBe('DISAGREE');
  });

  it('says nothing about a year only one side knows', () => {
    expect(compareYear(1980, null)).toBe('UNKNOWN');
    expect(compareYear(null, null)).toBe('UNKNOWN');
  });

  it('matches households on any shared number', () => {
    expect(comparePhones(['+96170111222'], ['+96103999888', '+96170111222'])).toBe('AGREE');
  });

  /*
    Disjoint, not opposed. Two records of one household holding different phone
    numbers is the ordinary case rather than evidence they are different
    households, so this must never return DISAGREE.
  */
  it('stays silent rather than penalising two different numbers', () => {
    expect(comparePhones(['+96170111222'], ['+96171333444'])).toBe('UNKNOWN');
    expect(comparePhones([], ['+96171333444'])).toBe('UNKNOWN');
  });

  it('drops single characters from a name, which carry no information', () => {
    expect([...nameTokens('علي و خليل')]).toEqual(['علي', 'خليل']);
  });
});
