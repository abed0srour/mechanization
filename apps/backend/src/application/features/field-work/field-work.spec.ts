import {
  OUTCOME_DISPOSITION,
  OUTCOME_REQUIRES_NOTE,
  VISIT_OUTCOME,
  contactPhone,
  draftGaps,
  isDraftFilable,
  recordVisitSchema,
  syncBatchSchema,
  assignZoneSchema,
  splitEvenly,
  type FieldDraftPayload,
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
      lastName: 'خليل',
      gender: 'MALE',
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
