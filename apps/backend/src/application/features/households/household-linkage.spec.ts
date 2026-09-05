import { resolve, type TokenFrequencies } from '../../common/record-linkage';
import {
  civilRecordKey,
  duplicateCitizenSpec,
  householdMemberSpec,
  landlordSpec,
  toNameSet,
  type CitizenCandidate,
  type LandlordCandidate,
  type LinkageSubject,
  type MemberCandidate,
} from './household-linkage';

/**
 * The three questions, on the cases that actually arrive at a counter.
 *
 * Two of these tests exist to pin down a *refusal*. A design note proposed
 * linking households on three clues, and the second of them — «husband and wife
 * share a سجل» — is the one that would have merged families: a سجل identifies a
 * patrilineal family record, so a man, his brothers, their wives and their
 * children all carry the same one. It is used here to bound a search and is
 * weighted accordingly, and `a matching سجل is not a household match` is what
 * holds that line.
 */

/** A town where خليل is everywhere and بزي is two households. */
const frequencies: TokenFrequencies = {
  total: 1000,
  counts: new Map([
    ['خليل', 400],
    ['علي', 300],
    ['حسن', 250],
    ['محمد', 350],
    ['سعيد', 180],
    ['محمود', 160],
    ['فاطمة', 200],
    ['احمد', 220],
    ['حرب', 150],
    ['مريم', 5],
    ['عواضه', 4],
    ['زينب', 40],
    ['بزي', 3],
  ]),
};

const subject = (over: Partial<LinkageSubject> = {}): LinkageSubject => ({
  name: toNameSet('علي', 'حسن', 'خليل'),
  motherName: null,
  birthYear: 1980,
  gender: 'MALE',
  civilRecordKey: civilRecordKey('45', 'صور'),
  phones: [],
  ownedParcelNumbers: new Set<string>(),
  ...over,
});

const slot = (id: string, over: Partial<MemberCandidate> = {}): MemberCandidate => ({
  memberId: id,
  householdId: `h-${id}`,
  name: toNameSet('علي حسن خليل'),
  birthYear: 1980,
  gender: 'MALE',
  relationToHead: 'SPOUSE',
  headName: toNameSet('فاطمة', 'احمد', 'حرب'),
  headCivilRecordKey: civilRecordKey('45', 'صور'),
  householdPhones: [],
  ...over,
});

describe('household — the husband a wife described weeks ago', () => {
  /*
    Fatima registers her shop, lists her husband Ali on the roster, and gives
    his mobile as the household's second number. Ali arrives later to register
    the flat. Three independent facts agree, none of them recorded by him.
  */
  it('links him to the slot she wrote', () => {
    const result = resolve(
      subject({ phones: ['+96170111222'] }),
      [slot('a', { householdPhones: ['+96103999888', '+96170111222'] })],
      householdMemberSpec(frequencies),
    );

    expect(result.outcome).toBe('LINK');
    expect(result.reason).toBe('CONFIDENT');
    expect(result.best?.candidate.memberId).toBe('a');
  });

  it('prefers the corroborated household over an identically-named stranger', () => {
    const result = resolve(
      subject({ phones: ['+96170111222'] }),
      [
        slot('stranger', {
          birthYear: 1979,
          headCivilRecordKey: civilRecordKey('88', 'بنت جبيل'),
        }),
        slot('hers', { householdPhones: ['+96170111222'] }),
      ],
      householdMemberSpec(frequencies),
    );

    expect(result.outcome).toBe('LINK');
    expect(result.best?.candidate.memberId).toBe('hers');
  });

  it('tolerates a birth year a relative recited a year out', () => {
    const result = resolve(
      subject({ phones: ['+96170111222'] }),
      [slot('a', { birthYear: 1981, householdPhones: ['+96170111222'] })],
      householdMemberSpec(frequencies),
    );

    expect(result.outcome).toBe('LINK');
  });
});

describe('household — two cousins with one name', () => {
  /*
    The case the whole ambiguity rule exists for. Nothing distinguishes the two
    slots, so the higher score is an accident and linking to it is a coin toss
    that leaves no record of the other.
  */
  it('refuses to pick between two indistinguishable slots', () => {
    const result = resolve(
      subject(),
      [slot('a'), slot('b', { householdId: 'h-b' })],
      householdMemberSpec(frequencies),
    );

    expect(result.outcome).toBe('REVIEW');
    expect(result.reason).toBe('AMBIGUOUS');
  });

  it('hands the reviewer both, so they can see what it was confused with', () => {
    const result = resolve(subject(), [slot('a'), slot('b')], householdMemberSpec(frequencies));

    expect(result.best).not.toBeNull();
    expect(result.runnerUp).not.toBeNull();
    expect(result.shortlist).toHaveLength(2);
  });
});

describe('household — what a matching سجل is and is not', () => {
  /*
    The correction. A سجل is a family record, not a couple: this subject and this
    household's head are brothers, so they share it, share a شهرة, and share
    nothing else. If «same سجل» carried real weight, the register would link a man
    into his brother's household on it.
  */
  it('does not link a man into his brother household on the سجل alone', () => {
    const result = resolve(
      subject(),
      [
        slot('brother', {
          name: toNameSet('محمود سعيد خليل'),
          birthYear: null,
          headName: toNameSet('سعيد', 'خليل'),
          headCivilRecordKey: civilRecordKey('45', 'صور'),
        }),
      ],
      householdMemberSpec(frequencies),
    );

    expect(result.outcome).toBe('NO_MATCH');
  });

  it('does not treat a differing سجل as evidence against — a marriage may not be registered yet', () => {
    const withSameRecord = resolve(
      subject({ phones: ['+96170111222'] }),
      [slot('a', { householdPhones: ['+96170111222'] })],
      householdMemberSpec(frequencies),
    );
    const withDifferentRecord = resolve(
      subject({ phones: ['+96170111222'] }),
      [
        slot('a', {
          householdPhones: ['+96170111222'],
          headCivilRecordKey: civilRecordKey('88', 'بنت جبيل'),
        }),
      ],
      householdMemberSpec(frequencies),
    );

    // The سجل only ever adds; its absence costs nothing beyond what it would
    // have contributed, and both still reach a link on the other evidence.
    expect(withDifferentRecord.outcome).toBe('LINK');
    expect(withSameRecord.best!.score).toBeGreaterThan(withDifferentRecord.best!.score);
  });

  it('needs both halves of محل القيد before the key means anything', () => {
    expect(civilRecordKey('45', null)).toBeNull();
    expect(civilRecordKey(null, 'صور')).toBeNull();
    expect(civilRecordKey('45', 'صور')).toBe('45@صور');
  });
});

describe('household — the roster says what sex the slot is', () => {
  it('refuses a man for a slot recorded as a daughter, whatever the names say', () => {
    const result = resolve(
      subject(),
      [slot('a', { gender: 'FEMALE', relationToHead: 'CHILD' })],
      householdMemberSpec(frequencies),
    );

    expect(result.outcome).toBe('NO_MATCH');
  });

  it('is not troubled by a slot nobody recorded a sex for', () => {
    const result = resolve(
      subject({ phones: ['+96170111222'] }),
      [slot('a', { gender: null, householdPhones: ['+96170111222'] })],
      householdMemberSpec(frequencies),
    );

    expect(result.outcome).toBe('LINK');
  });
});

describe('duplicate citizen — اسم الأم is what separates cousins', () => {
  const cousinSubject = subject({
    name: toNameSet('محمد', 'علي', 'خليل'),
    motherName: 'مريم عواضه',
    birthYear: 1976,
    civilRecordKey: civilRecordKey('12', 'دير قانون'),
  });

  const citizen = (id: string, over: Partial<CitizenCandidate> = {}): CitizenCandidate => ({
    citizenId: id,
    name: toNameSet('محمد علي خليل'),
    motherName: 'مريم عواضه',
    birthYear: 1976,
    gender: 'MALE',
    civilRecordKey: civilRecordKey('12', 'دير قانون'),
    phones: [],
    ...over,
  });

  it('recognises the same person under a different document', () => {
    const result = resolve(cousinSubject, [citizen('same')], duplicateCitizenSpec(frequencies));

    expect(result.outcome).toBe('LINK');
    expect(result.best?.candidate.citizenId).toBe('same');
  });

  it('rules out the cousin who shares all three names', () => {
    const result = resolve(
      cousinSubject,
      [
        citizen('cousin', {
          motherName: 'زينب بزي',
          birthYear: 1991,
          civilRecordKey: civilRecordKey('88', 'بنت جبيل'),
        }),
      ],
      duplicateCitizenSpec(frequencies),
    );

    expect(result.outcome).toBe('NO_MATCH');
  });

  it('picks the right one out of the pair', () => {
    const result = resolve(
      cousinSubject,
      [
        citizen('cousin', {
          motherName: 'زينب بزي',
          birthYear: 1991,
          civilRecordKey: civilRecordKey('88', 'بنت جبيل'),
        }),
        citizen('same'),
      ],
      duplicateCitizenSpec(frequencies),
    );

    expect(result.outcome).toBe('LINK');
    expect(result.best?.candidate.citizenId).toBe('same');
  });

  /*
    The bar for calling two people one person is deliberately the highest of the
    three specs: merging moves property cards and invoices onto one file, and
    the register's older rule — two people who cannot be told apart stay two
    rows — is the one being honoured here.
  */
  it('will not merge two people on a matching three-part name alone', () => {
    const result = resolve(
      subject({ name: toNameSet('محمد', 'علي', 'خليل'), birthYear: null, civilRecordKey: null }),
      [citizen('maybe', { motherName: null, birthYear: null, civilRecordKey: null })],
      duplicateCitizenSpec(frequencies),
    );

    expect(result.outcome).not.toBe('LINK');
  });
});

describe('landlord — the father his son already named', () => {
  const father = subject({
    name: toNameSet('حسن', 'علي', 'خليل'),
    phones: ['+96103555444'],
    ownedParcelNumbers: new Set(['150']),
  });

  const card = (id: string, over: Partial<LandlordCandidate> = {}): LandlordCandidate => ({
    propertyEntryId: id,
    filedByCitizenId: `son-${id}`,
    name: toNameSet('حسن خليل'),
    landlordPhone: null,
    propertyNumber: '150',
    ...over,
  });

  /*
    Case 4, and the reason it costs nothing extra: the son wrote «حسن خليل» and
    a رقم عقار on his own card weeks before his father registered the building.
    Two people recorded the same parcel at different times, neither knowing of
    the other.
  */
  it('proposes the card naming him on the parcel he registered', () => {
    const result = resolve(father, [card('a')], landlordSpec(frequencies));

    expect(result.best?.candidate.propertyEntryId).toBe('a');
    /*
      A shared parcel and a common two-token name is a strong proposal and not a
      certainty — «حسن خليل» fits several men in this town, and the son may have
      copied the parcel from the building he lives in rather than the deed. So a
      clerk confirms it, which is a question they can put to the father standing
      in front of them.
    */
    expect(result.outcome).toBe('REVIEW');
    expect(result.reason).toBe('BELOW_LINK');
  });

  it('links once the tenant also wrote the landlord number down', () => {
    const withPhone = resolve(
      father,
      [card('a', { landlordPhone: '+96103555444' })],
      landlordSpec(frequencies),
    );
    const withoutPhone = resolve(father, [card('a')], landlordSpec(frequencies));

    expect(withPhone.outcome).toBe('LINK');
    expect(withPhone.best!.score).toBeGreaterThan(withoutPhone.best!.score);
  });

  it('does not link a same-named landlord on a parcel he does not own', () => {
    const result = resolve(father, [card('a', { propertyNumber: '902' })], landlordSpec(frequencies));

    expect(result.outcome).toBe('NO_MATCH');
  });

  it('says nothing when the tenant left the parcel blank and gave no number', () => {
    const result = resolve(father, [card('a', { propertyNumber: null })], landlordSpec(frequencies));

    expect(result.outcome).not.toBe('LINK');
  });
});
