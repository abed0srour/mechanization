import {
  OUTCOME_DISPOSITION,
  OUTCOME_REQUIRES_NOTE,
  SYNC_FAILURE_GUIDANCE,
  VISIT_OUTCOME,
  contactPhone,
  discardDraftSchema,
  draftCaseState,
  draftGaps,
  isDraftFilable,
  mergeDraftLists,
  parcelCaseState,
  recordVisitSchema,
  syncBatchSchema,
  assignZoneSchema,
  splitEvenly,
  visitStateChanged,
  type FieldDraftPayload,
  type FieldDraftSummary,
  type SyncFailureCode,
  type VisitOutcome,
  type WorklistParcel,
} from '@mechanization/shared-schemas';
import { partitionZone } from './field-work.service';

/**
 * Field work is the path by which a record enters the register without anyone
 * ever seeing the full form — so the thing worth testing is not that a draft can
 * be saved (it can, it is JSON), but that **a draft cannot become a citizen on
 * weaker terms than a form submission would have.**
 *
 * Everything here runs the real schemas. A gap list computed from a stub would
 * happily send a worker back to a door to collect the wrong field.
 */

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

/** A draft with every field a Lebanese owner-occupier needs. */
function completeDraft(): FieldDraftPayload {
  return {
    personal: {
      firstName: 'محمد',
      middleName: 'أحمد',
      lastName: 'خليل',
      gender: 'MALE',
      bloodType: 'A_POSITIVE',
      identityDocType: 'NATIONAL_ID',
      identityDocNumber: '1234567',
      civilRecordNumber: '77',
      nationality: 'لبنانية',
      isLebanese: true,
      residentStatus: 'VILLAGE_RESIDENT',
    },
    contact: {
      maritalStatus: 'MARRIED',
      phone: '03123456',
      whatsappSameAsPhone: true,
      familySize: 4,
    },
    properties: [
      {
        occupancyType: 'OWNER',
        propertyType: 'HOUSE',
        neighborhood: 'الحي الشرقي',
        propertyNumber: '412',
        buildingName: 'منزل خليل',
        unitArea: 120,
      },
    ],
  };
}

describe('draft gaps', () => {
  it('reports nothing for a draft the create schema would accept', () => {
    expect(draftGaps(completeDraft())).toEqual([]);
    expect(isDraftFilable(completeDraft())).toBe(true);
  });

  it('names the one missing field rather than the whole form', () => {
    const draft = completeDraft();
    delete (draft.personal as Record<string, unknown>).civilRecordNumber;

    const gaps = draftGaps(draft);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.path).toBe('personal.civilRecordNumber');
    // The message is the validator's own, in Arabic — it is read at a doorstep.
    expect(gaps[0]?.message).toContain('رقم السجل');
  });

  it('is empty-safe: an untouched draft lists what to collect, not a crash', () => {
    const gaps = draftGaps({});
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.map((gap) => gap.path)).toContain('properties');
  });

  it('reports each path once even when two rules depend on it', () => {
    // A non-Lebanese person with neither passport nor residency number trips
    // both halves of the either/or rule.
    const gaps = draftGaps({
      personal: {
        firstName: 'أحمد',
        lastName: 'سالم',
        gender: 'MALE',
        identityDocType: 'PASSPORT',
        nationality: 'سورية',
        isLebanese: false,
        residentStatus: 'REFUGEE',
      },
    });
    const paths = gaps.map((gap) => gap.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('holds a doorstep draft to the same rules as the public wizard', () => {
    // خيمة is available to a لاجئ only. A draft must not be a way around it.
    const draft = completeDraft();
    (draft.properties as Record<string, unknown>[])[0] = {
      occupancyType: 'OWNER',
      propertyType: 'TENT',
      neighborhood: 'المخيم',
      propertyNumber: '412',
      tentLocation: 'قرب الطريق العام',
    };
    expect(isDraftFilable(draft)).toBe(false);
  });
});

describe('visit outcomes', () => {
  it('gives every outcome exactly one disposition', () => {
    for (const outcome of VISIT_OUTCOME) {
      expect(OUTCOME_DISPOSITION[outcome]).toBeDefined();
    }
    expect(Object.keys(OUTCOME_DISPOSITION)).toHaveLength(VISIT_OUTCOME.length);
  });

  it('treats refusal as blocked rather than closed', () => {
    // A refusal is where the case stops being field work and becomes the
    // municipality's — not a door to strike off the list.
    expect(OUTCOME_DISPOSITION.REFUSED).toBe('WAITING');
    expect(OUTCOME_DISPOSITION.ABROAD).toBe('WAITING');
  });

  it('requires a written reason wherever closure rests on the worker’s word', () => {
    // ALREADY_REGISTERED also closes a parcel, but the server can verify it
    // against the register, so it is exempt on purpose.
    for (const outcome of VISIT_OUTCOME) {
      if (OUTCOME_DISPOSITION[outcome] !== 'CLOSED') continue;
      if (outcome === 'ALREADY_REGISTERED') {
        expect(OUTCOME_REQUIRES_NOTE).not.toContain(outcome);
        continue;
      }
      expect(OUTCOME_REQUIRES_NOTE).toContain(outcome);
    }
  });
});

describe('recordVisitSchema', () => {
  const base = { clientId: CLIENT_ID, parcelNumber: '412', visitedAt: '2026-08-31T09:00:00Z' };

  it('accepts a bare "nobody home"', () => {
    const result = recordVisitSchema.safeParse({ ...base, outcome: 'NOBODY_HOME' });
    expect(result.success).toBe(true);
  });

  it('refuses to close a parcel without a reason', () => {
    expect(recordVisitSchema.safeParse({ ...base, outcome: 'DEMOLISHED' }).success).toBe(false);
    expect(
      recordVisitSchema.safeParse({ ...base, outcome: 'DEMOLISHED', note: 'هُدم عام ٢٠٢٣' })
        .success,
    ).toBe(true);
  });

  it('refuses "partial" with nothing attached', () => {
    // Otherwise it is indistinguishable from "nobody home", and the difference
    // is the entire point of recording it.
    expect(recordVisitSchema.safeParse({ ...base, outcome: 'PARTIAL' }).success).toBe(false);
    expect(
      recordVisitSchema.safeParse({
        ...base,
        outcome: 'PARTIAL',
        draftClientId: '22222222-2222-4222-8222-222222222222',
      }).success,
    ).toBe(true);
  });

  it('refuses "completed" with no record behind it', () => {
    expect(recordVisitSchema.safeParse({ ...base, outcome: 'COMPLETED' }).success).toBe(false);
  });

  it('caps the note, which is a record about a person written by a stranger', () => {
    const result = recordVisitSchema.safeParse({
      ...base,
      outcome: 'REFUSED',
      note: 'ا'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('syncBatchSchema', () => {
  it('accepts an empty push from a device with nothing to say', () => {
    expect(syncBatchSchema.safeParse({ drafts: [], visits: [] }).success).toBe(true);
  });

  it('bounds a batch so one device cannot post an unbounded body', () => {
    const visits = Array.from({ length: 201 }, (_, index) => ({
      clientId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      parcelNumber: '412',
      outcome: 'NOBODY_HOME',
      visitedAt: '2026-08-31T09:00:00Z',
    }));
    expect(syncBatchSchema.safeParse({ drafts: [], visits }).success).toBe(false);
  });
});

describe('contactPhone', () => {
  it('normalises a Lebanese number exactly as before', () => {
    // Byte-for-byte unchanged, so every stored number and every lookup against
    // one is unaffected by widening the field.
    expect(contactPhone.parse('03123456')).toBe('+9613123456');
    expect(contactPhone.parse('+96170123456')).toBe('+96170123456');
    expect(contactPhone.parse('٧١٢٣٤٥٦٧')).toBe('+96171234567');
  });

  it('accepts the diaspora landlord that used to block a whole registration', () => {
    expect(contactPhone.parse('+4915112345678')).toBe('+4915112345678');
    expect(contactPhone.parse('0049 151 1234 5678')).toBe('+4915112345678');
  });

  it('still rejects something that is not a phone number', () => {
    expect(contactPhone.safeParse('12345').success).toBe(false);
    expect(contactPhone.safeParse('hello').success).toBe(false);
  });

  it('lets a registration through that the old rule made impossible', () => {
    const draft = completeDraft();
    (draft.properties as Record<string, unknown>[])[0] = {
      occupancyType: 'TENANT',
      landlordName: 'سمير خليل',
      landlordPhone: '+4915112345678',
      propertyType: 'HOUSE',
      neighborhood: 'الحي الشرقي',
      propertyNumber: '412',
      buildingName: 'منزل خليل',
      unitArea: 120,
    };
    expect(draftGaps(draft)).toEqual([]);
  });
});


/**
 * The parcel partition.
 *
 * Several people work one sector at once, so "who is responsible for this door"
 * cannot be answered by the zone any more. Every claim this feature makes about
 * two workers never collecting the same household reduces to the function
 * below, which makes it the one piece most worth pinning down.
 */
describe('partitionZone', () => {
  const ZONE = ['401', '402', '403', '404'];

  it('gives a lone worker the whole sector', () => {
    const shares = partitionZone(ZONE, [{ id: 'a', parcelNumbers: [] }]);
    expect(shares.get('a')).toEqual(ZONE);
  });

  it('splits a sector between explicit shares and a remainder holder', () => {
    const shares = partitionZone(ZONE, [
      { id: 'a', parcelNumbers: ['401', '402'] },
      { id: 'b', parcelNumbers: ['403'] },
      { id: 'c', parcelNumbers: [] },
    ]);
    expect(shares.get('a')).toEqual(['401', '402']);
    expect(shares.get('b')).toEqual(['403']);
    expect(shares.get('c')).toEqual(['404']);
  });

  it('never hands the same parcel to two workers', () => {
    const shares = partitionZone(ZONE, [
      { id: 'a', parcelNumbers: ['401', '402'] },
      { id: 'b', parcelNumbers: ['403'] },
      { id: 'c', parcelNumbers: [] },
    ]);
    const all = [...shares.values()].flat();
    expect(new Set(all).size).toBe(all.length);
    // And every door is somebody's: a parcel in no share is a house nobody is
    // sent to, which is the failure the denominator exists to make visible.
    expect(new Set(all)).toEqual(new Set(ZONE));
  });

  it('leaves unclaimed parcels to nobody when there is no remainder holder', () => {
    const shares = partitionZone(ZONE, [{ id: 'a', parcelNumbers: ['401'] }]);
    expect([...shares.values()].flat()).toEqual(['401']);
  });

  it('drops a parcel the zone no longer contains', () => {
    // A cadastre re-import can retire a number a stale assignment still names.
    // Handing it to a worker would put a door on their list that the sync check
    // then refuses — the one failure worse than a missing door.
    const shares = partitionZone(ZONE, [{ id: 'a', parcelNumbers: ['401', '999'] }]);
    expect(shares.get('a')).toEqual(['401']);
  });

  it('gives the remainder holder everything when others claim nothing valid', () => {
    const shares = partitionZone(ZONE, [
      { id: 'a', parcelNumbers: ['999'] },
      { id: 'b', parcelNumbers: [] },
    ]);
    expect(shares.get('a')).toEqual([]);
    expect(shares.get('b')).toEqual(ZONE);
  });
});

describe('splitEvenly', () => {
  it('deals the remainder to the earliest shares, leaving nothing behind', () => {
    const shares = splitEvenly(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 3);
    expect(shares.map((s) => s.length)).toEqual([4, 3, 3]);
    expect(shares.flat()).toHaveLength(10);
  });

  it('keeps each share contiguous, so nobody walks a street twice', () => {
    // Cadastral numbering broadly follows the street; round-robin would send
    // three people past each other all morning.
    const shares = splitEvenly(['401', '402', '403', '404'], 2);
    expect(shares[0]).toEqual(['401', '402']);
    expect(shares[1]).toEqual(['403', '404']);
  });

  it('gives one worker everything', () => {
    expect(splitEvenly(['401', '402'], 1)).toEqual([['401', '402']]);
  });

  it('produces empty shares rather than dropping workers when parcels run out', () => {
    // The service refuses this case up front; the function stays total anyway.
    expect(splitEvenly(['401'], 3)).toEqual([['401'], [], []]);
  });
});

describe('assignZoneSchema', () => {
  const base = {
    zoneId: '11111111-1111-4111-8111-111111111111',
    inspectorIds: ['22222222-2222-4222-8222-222222222222'],
  };

  it('accepts one worker taking the remainder', () => {
    const result = assignZoneSchema.safeParse({ ...base, mode: 'REMAINDER' });
    expect(result.success).toBe(true);
  });

  it('accepts several workers splitting a sector', () => {
    const result = assignZoneSchema.safeParse({
      ...base,
      inspectorIds: [...base.inspectorIds, '33333333-3333-4333-8333-333333333333'],
      mode: 'SPLIT',
    });
    expect(result.success).toBe(true);
  });

  it('refuses two workers both holding the remainder', () => {
    // Both would be handed every unclaimed parcel — the exact duplicate the
    // partition exists to prevent.
    const result = assignZoneSchema.safeParse({
      ...base,
      inspectorIds: [...base.inspectorIds, '33333333-3333-4333-8333-333333333333'],
      mode: 'REMAINDER',
    });
    expect(result.success).toBe(false);
  });

  it('refuses the same worker listed twice', () => {
    const result = assignZoneSchema.safeParse({
      ...base,
      inspectorIds: [...base.inspectorIds, ...base.inspectorIds],
      mode: 'SPLIT',
    });
    expect(result.success).toBe(false);
  });

  it('refuses an explicit share with no numbers in it', () => {
    const result = assignZoneSchema.safeParse({ ...base, mode: 'EXPLICIT', parcelNumbers: [] });
    expect(result.success).toBe(false);
  });
});

/*
 * ──────────────────  A parcel is a building, not a household  ────────────────
 *
 * Everything below tests the same change from one angle or another: a cadastral
 * number is shared by every owner and tenant inside it, so the unit of field
 * work is a *household* and a parcel carries a list of them.
 *
 * These are the rules that were wrong when the multi-household work first
 * landed, each of which produced a specific wrong screen for a worker at a
 * door. The comment on each test says which.
 */

const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const NEIGHBOUR = '33333333-3333-4333-8333-333333333333';

function household(over: Partial<FieldDraftSummary<string>> = {}): FieldDraftSummary<string> {
  return {
    clientId: HOUSEHOLD,
    payload: completeDraft(),
    gaps: [],
    citizenName: 'محمد خليل',
    updatedAt: '2026-08-01T10:00:00.000Z',
    lastOutcome: null,
    lastDisposition: null,
    lastVisitedAt: null,
    nextVisitAt: null,
    note: null,
    proxyName: null,
    proxyPhone: null,
    ...over,
  };
}

function visited(
  outcome: VisitOutcome,
  over: Partial<FieldDraftSummary<string>> = {},
): FieldDraftSummary<string> {
  return household({
    lastOutcome: outcome,
    lastDisposition: OUTCOME_DISPOSITION[outcome],
    lastVisitedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  });
}

function door(over: Partial<WorklistParcel<string>> = {}): WorklistParcel<string> {
  return {
    parcelNumber: '412',
    zoneId: 'zone-1',
    zoneCode: 'A',
    latitude: null,
    longitude: null,
    registered: false,
    registeredCitizens: [],
    lastOutcome: null,
    lastDisposition: null,
    lastVisitedAt: null,
    nextVisitAt: null,
    visitCount: 0,
    drafts: [],
    ...over,
  };
}

const NOW = new Date('2026-09-01T12:00:00.000Z');

describe('draftCaseState — where one household stands', () => {
  it('treats a started-but-unfinished household as owed now', () => {
    // Somebody wrote this person down and stopped. The worst thing that can
    // happen to a half-filled form is that nobody goes back to it, so it is
    // `due` rather than `todo`.
    expect(draftCaseState(household(), NOW)).toBe('due');
  });

  it('closes a completed household', () => {
    expect(draftCaseState(visited('COMPLETED'), NOW)).toBe('closed');
  });

  it('holds a household waiting on documents until its date arrives', () => {
    const state = visited('DOCUMENTS_MISSING', { nextVisitAt: '2026-09-15T00:00:00.000Z' });
    expect(draftCaseState(state, NOW)).toBe('waiting');
  });

  it('surfaces that household by itself on the promised day', () => {
    // The whole mechanism behind «بانتظار مستندات» becoming «مستحقة»: the
    // citizen said next week, next week is today, and nobody had to remember.
    const state = visited('DOCUMENTS_MISSING', { nextVisitAt: '2026-08-20T00:00:00.000Z' });
    expect(draftCaseState(state, NOW)).toBe('due');
  });

  it('treats a retry with no date as owed now rather than never', () => {
    // "Come back, I did not say when" means today. Left as `waiting` it would
    // sit in a queue no route ever drains.
    expect(draftCaseState(visited('NOBODY_HOME'), NOW)).toBe('due');
  });

  it('keeps a resident abroad waiting rather than scheduling a pointless knock', () => {
    const abroad = visited('ABROAD', {
      nextVisitAt: '2026-12-01T00:00:00.000Z',
      proxyName: 'سليم خليل',
      proxyPhone: '+96170123456',
    });
    expect(draftCaseState(abroad, NOW)).toBe('waiting');
  });
});

describe('parcelCaseState — where a whole door stands', () => {
  it('counts an untouched door as unvisited', () => {
    expect(parcelCaseState(door(), NOW)).toBe('todo');
  });

  it('does NOT close a building because one apartment finished', () => {
    /*
     * The bug this whole feature exists to remove.
     *
     * Apartment 1 is filed; apartment 2 was never home and is owed a return
     * visit. Reading the parcel's own outcome — which used to be the latest
     * visit of any kind, including apartment 1's — marked the block DONE and
     * took a building full of unregistered people off the worklist.
     */
    const block = door({
      registered: true,
      registeredCitizens: [{ id: 'c1', name: 'محمد خليل', phone: null, referenceNumber: 'REG-1' }],
      drafts: [visited('NOBODY_HOME', { clientId: NEIGHBOUR, citizenName: 'جورج حداد' })],
    });
    expect(parcelCaseState(block, NOW)).toBe('due');
  });

  it('closes a building once every household on it is finished', () => {
    const finished = door({
      registered: true,
      registeredCitizens: [{ id: 'c1', name: 'محمد خليل', phone: null, referenceNumber: 'REG-1' }],
    });
    expect(parcelCaseState(finished, NOW)).toBe('closed');
  });

  it('closes a demolished building whatever anyone inside it was waiting for', () => {
    // There is no apartment 2 in a demolished building. A CLOSED parcel-level
    // outcome outranks every household on it.
    const gone = door({
      lastOutcome: 'DEMOLISHED',
      lastDisposition: 'CLOSED',
      drafts: [visited('DOCUMENTS_MISSING', { nextVisitAt: '2026-08-01T00:00:00.000Z' })],
    });
    expect(parcelCaseState(gone, NOW)).toBe('closed');
  });

  it('ranks anything owed today above anything owed later', () => {
    // A block with one household waiting on a وكيل and one owed a return visit
    // is a block to walk to today.
    const mixed = door({
      drafts: [
        visited('ABROAD', { nextVisitAt: '2026-12-01T00:00:00.000Z' }),
        visited('NOBODY_HOME', { clientId: NEIGHBOUR }),
      ],
    });
    expect(parcelCaseState(mixed, NOW)).toBe('due');
  });

  it('assigns every door exactly one state, so the tab counts sum to the list', () => {
    /*
     * The property the worker's tabs depend on. When «منجزة» was asked of the
     * parcel while «بانتظار» was asked of its drafts, a building could fall in
     * none of them — and a tab strip whose numbers do not add up to the list is
     * a tab strip nobody trusts.
     */
    const doors: Array<WorklistParcel<string>> = [
      door({ parcelNumber: '1' }),
      door({ parcelNumber: '2', drafts: [visited('NOBODY_HOME')] }),
      door({
        parcelNumber: '3',
        drafts: [visited('ABROAD', { nextVisitAt: '2026-12-01T00:00:00.000Z' })],
      }),
      door({ parcelNumber: '4', registered: true }),
      door({ parcelNumber: '5', lastOutcome: 'DEMOLISHED', lastDisposition: 'CLOSED' }),
      door({ parcelNumber: '6', drafts: [household()] }),
    ];

    const tally = { todo: 0, due: 0, waiting: 0, closed: 0 };
    for (const one of doors) tally[parcelCaseState(one, NOW)] += 1;

    expect(tally.todo + tally.due + tally.waiting + tally.closed).toBe(doors.length);
    expect(tally).toEqual({ todo: 1, due: 2, waiting: 1, closed: 2 });
  });
});

describe('visitStateChanged — an edit to a form is not a second knock', () => {
  const state = {
    lastOutcome: 'DOCUMENTS_MISSING' as VisitOutcome,
    nextVisitAt: '2026-09-15',
    note: 'وعد بإحضار إفادة السكن',
    proxyName: null,
    proxyPhone: null,
  };

  it('records a visit the first time a household is saved', () => {
    expect(visitStateChanged(null, state)).toBe(true);
    expect(visitStateChanged(household(), state)).toBe(true);
  });

  it('records nothing when only the form changed', () => {
    /*
     * Reopening a finished household to fix a misspelt street used to file a
     * second visit, bump «عدد الزيارات السابقة», and make another attempt to
     * promote a citizen already on the register.
     */
    expect(visitStateChanged(visited('DOCUMENTS_MISSING', state), state)).toBe(false);
  });

  it('records a visit when the outcome changes', () => {
    expect(
      visitStateChanged(visited('DOCUMENTS_MISSING', state), {
        ...state,
        lastOutcome: 'COMPLETED',
      }),
    ).toBe(true);
  });

  it('records a visit when the return date is cleared', () => {
    // Clearing is a change. Under the old `??` merge it was indistinguishable
    // from "leave it alone", which is how finished households kept a return
    // date that had already passed and sat in «مستحقة» forever.
    expect(
      visitStateChanged(visited('DOCUMENTS_MISSING', state), { ...state, nextVisitAt: null }),
    ).toBe(true);
  });

  it('records a visit when a وكيل is named or removed', () => {
    const abroad = visited('ABROAD', { ...state, proxyName: 'سليم خليل' });
    expect(visitStateChanged(abroad, { ...state, proxyName: null })).toBe(true);
  });
});

describe('mergeDraftLists — reconciling a device with the server', () => {
  const NONE = new Set<string>();

  it('keeps a household the device has and the server has never seen', () => {
    // Entered at a door ten minutes ago, still in the outbox. A wholesale
    // replacement would erase it before it was ever pushed.
    const merged = mergeDraftLists([], [household()], NONE);
    expect(merged.map((d) => d.clientId)).toEqual([HOUSEHOLD]);
  });

  it('prefers whichever side was edited later, whole', () => {
    const older = household({ updatedAt: '2026-08-01T10:00:00.000Z', citizenName: 'قديم' });
    const newer = household({ updatedAt: '2026-08-02T10:00:00.000Z', citizenName: 'جديد' });
    expect(mergeDraftLists([older], [newer], NONE)[0]?.citizenName).toBe('جديد');
    expect(mergeDraftLists([newer], [older], NONE)[0]?.citizenName).toBe('جديد');
  });

  it('never blends two versions of the same household field by field', () => {
    // Half of a stale record merged into half of a fresh one is a record that
    // existed on neither side — and that is what `??`-merging produced.
    const server = household({
      updatedAt: '2026-08-02T10:00:00.000Z',
      citizenName: 'جديد',
      note: null,
      nextVisitAt: null,
    });
    const local = household({
      updatedAt: '2026-08-01T10:00:00.000Z',
      citizenName: 'قديم',
      note: 'ملاحظة قديمة',
      nextVisitAt: '2026-08-10T00:00:00.000Z',
    });
    expect(mergeDraftLists([server], [local], NONE)[0]).toEqual(server);
  });

  it('does not resurrect a household that has become a citizen record', () => {
    /*
     * The server stops sending a draft the moment it is promoted, which looks
     * exactly like "the server has not been told about it yet" — so the union
     * handed it straight back, and the parcel sat in «المسودات» forever with no
     * way to clear it. The retired set is the missing third state.
     */
    expect(mergeDraftLists([], [household()], new Set([HOUSEHOLD]))).toEqual([]);
  });

  it('drops a retired household even when the server still lists it', () => {
    expect(mergeDraftLists([household()], [household()], new Set([HOUSEHOLD]))).toEqual([]);
  });

  it('returns newest first, so a switcher opens on the one being worked', () => {
    const first = household({ clientId: HOUSEHOLD, updatedAt: '2026-08-01T10:00:00.000Z' });
    const second = household({ clientId: NEIGHBOUR, updatedAt: '2026-08-05T10:00:00.000Z' });
    expect(mergeDraftLists([first, second], [], NONE).map((d) => d.clientId)).toEqual([
      NEIGHBOUR,
      HOUSEHOLD,
    ]);
  });
});

describe('the outcome vocabulary both screens are built from', () => {
  it('gives every outcome a disposition, so no option is unreachable', () => {
    // Both screens build their grids by filtering all outcomes through
    // OUTCOME_DISPOSITION. One missing from the map would silently vanish from
    // the UI rather than fail loudly — which is how the doorstep form came to
    // offer seven outcomes against the sheet's fifteen.
    for (const outcome of VISIT_OUTCOME) {
      expect(OUTCOME_DISPOSITION[outcome]).toBeDefined();
    }
  });

  it('refuses every note-requiring outcome that arrives without one', () => {
    // The doorstep form had no note field at all, so REFUSED saved to the
    // device and was rejected at every sync from then on — stuck in the outbox,
    // on a screen with no way to edit it.
    for (const outcome of OUTCOME_REQUIRES_NOTE) {
      const result = recordVisitSchema.safeParse({
        clientId: CLIENT_ID,
        parcelNumber: '412',
        outcome,
        visitedAt: new Date(),
        draftClientId: HOUSEHOLD,
      });
      expect(result.success).toBe(false);
    }
  });
});

describe('discardDraftSchema — taking back a household that was a mistake', () => {
  const base = {
    clientId: CLIENT_ID,
    draftClientId: HOUSEHOLD,
    parcelNumber: '412',
    reason: 'أُضيف بالخطأ — نفس العائلة مسجّلة في البطاقة الأولى',
    discardedAt: new Date(),
  };

  it('accepts a discard with a real reason', () => {
    expect(discardDraftSchema.safeParse(base).success).toBe(true);
  });

  it('gives the discard its own id, distinct from the household it names', () => {
    /*
     * Not a nicety. The outbox is keyed on `clientId`, so a discard that reused
     * the household's id would overwrite the queued draft it is about — the two
     * records would be one row, and which survived would depend on write order.
     */
    const parsed = discardDraftSchema.parse(base);
    expect(parsed.clientId).not.toBe(parsed.draftClientId);
  });

  it('refuses a discard with no reason', () => {
    // This is the only action a field worker can take that removes a household
    // from the queue without visiting anybody. `OUTCOME_REQUIRES_NOTE` already
    // settled that such an act costs a sentence.
    expect(discardDraftSchema.safeParse({ ...base, reason: '' }).success).toBe(false);
  });

  it('refuses a reason too short to mean anything', () => {
    // A bar to «.» and to a mis-tap on a confirm button, not to anyone with a
    // reason to give.
    expect(discardDraftSchema.safeParse({ ...base, reason: 'خطأ' }).success).toBe(false);
  });

  it('refuses a discard that does not name a household', () => {
    const { draftClientId, ...withoutHousehold } = base;
    void draftClientId;
    expect(discardDraftSchema.safeParse(withoutHousehold).success).toBe(false);
  });

  it('rides in the same envelope as drafts and visits', () => {
    /*
     * A worker can create a household, record a visit against it, and only then
     * realise it was the wrong door — all offline, all in one push. The server
     * applies the three lists in order, so the row is created, the visit
     * attaches, and the row is then marked discarded. Split across requests, or
     * applied in any other order, the discard lands on a draft that does not
     * exist yet and the mistake outlives its own correction.
     */
    const result = syncBatchSchema.safeParse({
      drafts: [
        {
          clientId: HOUSEHOLD,
          parcelNumber: '412',
          payload: completeDraft(),
          updatedAt: new Date(),
        },
      ],
      visits: [
        {
          clientId: '44444444-4444-4444-8444-444444444444',
          parcelNumber: '412',
          outcome: 'NOBODY_HOME',
          visitedAt: new Date(),
        },
      ],
      discards: [base],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a batch from a device that has never heard of discards', () => {
    // The first addition to this contract since it went to real phones. An
    // older build sends two lists and must keep working.
    const result = syncBatchSchema.safeParse({ drafts: [], visits: [] });
    expect(result.success).toBe(true);
  });
});

describe('why a record would not sync, and what to do about it', () => {
  it('gives every failure code a resolution and an owner', () => {
    /*
     * The device renders these verbatim. A code with no guidance would render
     * as an empty box next to a record the worker cannot act on — which is
     * precisely the state this whole panel exists to replace.
     */
    for (const code of Object.keys(SYNC_FAILURE_GUIDANCE) as SyncFailureCode[]) {
      const guidance = SYNC_FAILURE_GUIDANCE[code];
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.resolution.length).toBeGreaterThan(0);
      expect(['worker', 'supervisor']).toContain(guidance.actor);
    }
  });

  it('never offers to drop a record the worker is supposed to fix', () => {
    // The escape hatch must not become the way people deal with every
    // rejection. It is offered only where a phone genuinely cannot resolve it.
    for (const code of Object.keys(SYNC_FAILURE_GUIDANCE) as SyncFailureCode[]) {
      const guidance = SYNC_FAILURE_GUIDANCE[code];
      if (guidance.actor === 'worker') expect(guidance.droppable).toBe(false);
    }
  });

  it('sends a parcel outside the worker’s share to the supervisor, not the worker', () => {
    // Told to "fix" something only a supervisor can change, a worker retries it
    // for a fortnight. Told whose it is, they raise it once.
    expect(SYNC_FAILURE_GUIDANCE.PARCEL_NOT_ASSIGNED.actor).toBe('supervisor');
    expect(SYNC_FAILURE_GUIDANCE.PARCEL_NOT_ASSIGNED.droppable).toBe(false);
  });

  it('keeps an incomplete record fixable on the device', () => {
    expect(SYNC_FAILURE_GUIDANCE.INVALID_RECORD.actor).toBe('worker');
  });
});

describe('the whole batch is validated as one, so one bad record must not travel', () => {
  /*
   * `syncBatchSchema` is applied to the entire envelope by a `ZodValidationPipe`.
   * One malformed record does not fail alone — it 422s the request, and because
   * nothing is ever dropped from the outbox it does so again on every sync
   * thereafter. A single visit saved without its required note is enough to
   * freeze a worker's whole queue permanently.
   *
   * These two tests pin that behaviour down, which is why the device now
   * validates each record on its own before batching and holds back the ones
   * that fail.
   */
  const goodVisit = {
    clientId: CLIENT_ID,
    parcelNumber: '412',
    outcome: 'NOBODY_HOME' as const,
    visitedAt: new Date(),
  };

  const poison = {
    clientId: '55555555-5555-4555-8555-555555555555',
    parcelNumber: '412',
    // REFUSED is in OUTCOME_REQUIRES_NOTE and this has no note.
    outcome: 'REFUSED' as const,
    visitedAt: new Date(),
  };

  it('rejects the whole envelope when any one record is invalid', () => {
    const result = syncBatchSchema.safeParse({ drafts: [], visits: [goodVisit, poison] });
    expect(result.success).toBe(false);
  });

  it('accepts the same envelope once the invalid record is held back', () => {
    // What `validateForPush` does on the device: the good record goes, the bad
    // one stays behind with a reason the worker can read and act on.
    const result = syncBatchSchema.safeParse({ drafts: [], visits: [goodVisit] });
    expect(result.success).toBe(true);
  });

  it('the held-back record fails its own schema, so it can be named individually', () => {
    // The per-record check the device runs, and the source of the Arabic
    // sentence shown next to the stuck row.
    const single = recordVisitSchema.safeParse(poison);
    expect(single.success).toBe(false);
    if (!single.success) {
      expect(single.error.issues[0]?.message).toContain('ملاحظة');
    }
  });
});
