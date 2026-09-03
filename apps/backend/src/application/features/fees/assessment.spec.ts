import { assessCitizen } from './fees.service';
import { billableUnits, isUnsurveyed } from '../../../domain/entities/billable-unit';
import type { BillablePropertyEntry } from '../../../domain/entities/billable-unit';

/**
 * Per-unit assessment — what a citizen actually owes, from what they hold.
 *
 * The register could always say a citizen holds six shops; the biller could
 * not read it and charged the same for six as for one. These pin down the
 * arithmetic and, more importantly, the two places it is allowed to refuse to
 * do arithmetic at all.
 */

const building = (
  propertyNumber: string,
  units: Array<[string, number | null] | [string, number | null, string]>,
  occupancyType = 'OWNER',
): BillablePropertyEntry => ({
  propertyType: 'BUILDING',
  propertyNumber,
  occupancyType,
  unitType: null,
  unitArea: null,
  units: units.map(([unitType, unitArea, unitStatus]) => ({
    unitType,
    unitArea,
    unitStatus: unitStatus ?? null,
  })),
});

const card = (
  propertyType: string,
  propertyNumber: string,
  unitType: string | null,
  unitArea: number | null,
  extra: { occupancyType?: string; unitStatus?: string } = {},
): BillablePropertyEntry => ({
  propertyType,
  propertyNumber,
  occupancyType: extra.occupancyType ?? 'OWNER',
  unitType,
  unitArea,
  unitStatus: extra.unitStatus ?? null,
  units: [],
});

describe('billable units — one list from two storage shapes', () => {
  it('reads a building as its unit rows', () => {
    const units = billableUnits(building('1553', [['SHOP', 40], ['APARTMENT', 120]]));

    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.unitType)).toEqual(['SHOP', 'APARTMENT']);
  });

  it('reads a plot as the single unit sitting flat on the card', () => {
    const units = billableUnits(card('LAND', '1553', null, 800));

    expect(units).toEqual([
      {
        unitType: null,
        unitArea: 800,
        unitStatus: null,
        occupancyType: 'OWNER',
        propertyType: 'LAND',
        propertyNumber: '1553',
      },
    ]);
  });

  it('reads several structures on one parcel as several units', () => {
    // The case this whole change exists for: one deed, three things on it.
    const entries = [
      building('1553', [['APARTMENT', 100]]),
      card('HOUSE', '1553', 'INDEPENDENT_HOUSE', 90),
      card('LAND', '1553', null, 400),
    ];

    expect(entries.flatMap(billableUnits)).toHaveLength(3);
  });

  it('does not invent a unit for a building nobody surveyed', () => {
    const unsurveyed = building('1553', []);

    expect(isUnsurveyed(unsurveyed)).toBe(true);
    expect(billableUnits(unsurveyed)).toEqual([]);
  });
});

describe('assessment', () => {
  const shops = [building('1553', [['SHOP', 40], ['SHOP', 25], ['APARTMENT', 120]])];

  it('charges six shops six times what it charges one', () => {
    const one = assessCitizen([building('1', [['SHOP', 40]])], {
      amount: 100_000,
      basis: 'PER_UNIT',
      targetCategory: 'SHOP',
    });
    const six = assessCitizen(
      [building('2', Array.from({ length: 6 }, () => ['SHOP', 40] as [string, number]))],
      { amount: 100_000, basis: 'PER_UNIT', targetCategory: 'SHOP' },
    );

    expect(one.kind).toBe('assessed');
    expect(six.kind).toBe('assessed');
    expect(one.kind === 'assessed' && one.amount).toBe(100_000);
    expect(six.kind === 'assessed' && six.amount).toBe(600_000);
  });

  it('counts only the units the notice is aimed at', () => {
    const result = assessCitizen(shops, {
      amount: 50_000,
      basis: 'PER_UNIT',
      targetCategory: 'SHOP',
    });

    // The apartment in the same building is not a shop and is not billed.
    expect(result.kind === 'assessed' && result.amount).toBe(100_000);
    expect(result.kind === 'assessed' && result.assessment.unitCount).toBe(2);
  });

  it('bills by area when that is the basis', () => {
    const result = assessCitizen(shops, {
      amount: 1_000,
      basis: 'PER_AREA',
      targetCategory: 'SHOP',
    });

    expect(result.kind === 'assessed' && result.amount).toBe(65_000);
    expect(result.kind === 'assessed' && result.assessment.totalArea).toBe(65);
  });

  it('leaves a flat notice charging exactly what it always did', () => {
    const result = assessCitizen(shops, { amount: 250_000, basis: 'FLAT' });

    // Nothing is multiplied: FLAT is the original behaviour, and every notice
    // written before per-unit billing existed is one.
    expect(result.kind === 'assessed' && result.amount).toBe(250_000);
  });

  it('keeps a breakdown that explains the number at the counter', () => {
    const result = assessCitizen(shops, {
      amount: 50_000,
      basis: 'PER_UNIT',
      targetCategory: 'SHOP',
    });

    expect(result.kind === 'assessed' && result.assessment.lines).toEqual([
      { propertyNumber: '1553', propertyType: 'BUILDING', unitType: 'SHOP', unitArea: null },
      { propertyNumber: '1553', propertyType: 'BUILDING', unitType: 'SHOP', unitArea: null },
    ]);
  });

  it('refuses to bill a building nobody has been inside', () => {
    // The trap: counted as zero, the largest building in the municipality pays
    // nothing, and the fee schedule is most generous to the biggest property.
    const result = assessCitizen([building('1553', [])], {
      amount: 100_000,
      basis: 'PER_UNIT',
      targetCategory: 'SHOP',
    });

    expect(result.kind).toBe('unassessable');
    expect(result.kind === 'unassessable' && result.reason).toContain('1553');
  });

  it('does not let an unsurveyed building block a flat charge', () => {
    /*
      A flat notice does not ask the register anything — its amount *is* the
      invoice. Refusing it because a building was never surveyed would drop a
      citizen out of a billing run over a number the bill never depended on.
    */
    const result = assessCitizen([building('1553', [])], { amount: 250_000, basis: 'FLAT' });

    expect(result.kind === 'assessed' && result.amount).toBe(250_000);
  });

  it('does not let an unsurveyed building block a fee aimed at land', () => {
    /*
      Units inside a building are always BUILDING-typed, so nothing found by
      surveying one can add or remove a matching unit from an أرض notice. The
      citizen's plot is measurable and must still be billed — blocking here
      under-collects for exactly the reason the refusal exists to prevent.
    */
    const result = assessCitizen([building('1553', []), card('LAND', '1554', null, 800)], {
      amount: 1_000,
      basis: 'PER_AREA',
      targetCategory: 'LAND',
    });

    expect(result.kind === 'assessed' && result.amount).toBe(800_000);
  });

  it('still blocks an unsurveyed building when the fee could reach inside it', () => {
    // The same building, a notice aimed at BUILDING rather than LAND.
    const result = assessCitizen([building('1553', []), card('LAND', '1554', null, 800)], {
      amount: 100_000,
      basis: 'PER_UNIT',
      targetCategory: 'BUILDING',
    });

    expect(result.kind).toBe('unassessable');
  });

  it('refuses to bill by area for a unit with no area recorded', () => {
    const result = assessCitizen([building('1553', [['SHOP', null]])], {
      amount: 1_000,
      basis: 'PER_AREA',
      targetCategory: 'SHOP',
    });

    expect(result.kind).toBe('unassessable');
  });

  /**
   * Who bears the fee — the rule deciding which of a citizen's units are
   * theirs to pay for.
   *
   * The table below is exhaustive on purpose. There are only fourteen
   * reachable combinations of occupancy, unit status and bearer; every one of
   * them decides money, and several read as obviously right in prose and come
   * out inverted in code. Enumerating them is cheaper than trusting four lines
   * of `bearsFee` to keep reading correctly forever.
   */
  describe('bearer', () => {
    const rate = { amount: 100_000, basis: 'PER_UNIT' as const, targetCategory: 'SHOP' };

    /** One shop, held as described, and whether each bearer charges for it. */
    const cases: Array<{
      occupancyType: string;
      unitStatus?: string;
      occupant: boolean;
      owner: boolean;
      why: string;
    }> = [
      {
        occupancyType: 'OWNER',
        occupant: true,
        owner: true,
        why: 'nobody was asked, so the owner is presumed to be in it',
      },
      {
        occupancyType: 'OWNER',
        unitStatus: 'OWNER_OCCUPIED',
        occupant: true,
        owner: true,
        why: 'the owner is the occupant',
      },
      {
        occupancyType: 'OWNER',
        unitStatus: 'RENTED',
        occupant: false,
        owner: true,
        why: 'the tenant is billed for it on their own card',
      },
      {
        occupancyType: 'OWNER',
        unitStatus: 'VACANT',
        occupant: false,
        owner: true,
        why: 'nobody occupies it, but it is still owned',
      },
      {
        occupancyType: 'OWNER',
        unitStatus: 'UNDER_CONSTRUCTION',
        occupant: false,
        owner: true,
        why: 'not finished, still owned',
      },
      {
        occupancyType: 'TENANT',
        occupant: true,
        owner: false,
        why: 'a tenant occupies but owns nothing',
      },
      {
        occupancyType: 'FREE_OCCUPANT',
        occupant: true,
        owner: false,
        why: 'a free occupant occupies but owns nothing',
      },
    ];

    for (const entry of cases) {
      const held = entry.unitStatus
        ? `${entry.occupancyType} / ${entry.unitStatus}`
        : `${entry.occupancyType} / unrecorded`;

      const one = (): BillablePropertyEntry =>
        building(
          '1553',
          [entry.unitStatus ? ['SHOP', 40, entry.unitStatus] : ['SHOP', 40]],
          entry.occupancyType,
        );

      it(`occupant-borne: ${entry.occupant ? 'charges' : 'skips'} ${held} — ${entry.why}`, () => {
        const result = assessCitizen([one()], { ...rate, bearer: 'OCCUPANT' });

        expect(result.kind === 'assessed' && result.amount).toBe(entry.occupant ? 100_000 : 0);
      });

      it(`owner-borne: ${entry.owner ? 'charges' : 'skips'} ${held} — ${entry.why}`, () => {
        const result = assessCitizen([one()], { ...rate, bearer: 'OWNER' });

        expect(result.kind === 'assessed' && result.amount).toBe(entry.owner ? 100_000 : 0);
      });
    }

    /** A landlord's two flats — one they live in, one they have let. */
    const landlord = () =>
      building('1553', [
        ['APARTMENT', 100, 'OWNER_OCCUPIED'],
        ['APARTMENT', 100, 'RENTED'],
      ]);

    /** The tenant of that second flat, filing their own card on the same parcel. */
    const tenant = () => building('1553', [['APARTMENT', 100]], 'TENANT');

    const flats = {
      amount: 100_000,
      basis: 'PER_UNIT' as const,
      targetCategory: 'APARTMENT',
    };

    it('ends the double-charge on a flat the owner has let', () => {
      /*
        The case the whole enum exists for, both halves of it in one test.

        A building is filed once by its owner and again by the tenant of one
        flat — the same apartment under two citizens, which is correct, because
        ownership and occupancy are different facts about it. Under an
        occupant-borne fee exactly one of them owes for it: the tenant. Before
        this, both did, and the municipality collected twice for one flat.
      */
      const landlordBill = assessCitizen([landlord()], { ...flats, bearer: 'OCCUPANT' });
      const tenantBill = assessCitizen([tenant()], { ...flats, bearer: 'OCCUPANT' });

      expect(landlordBill.kind === 'assessed' && landlordBill.amount).toBe(100_000);
      expect(tenantBill.kind === 'assessed' && tenantBill.amount).toBe(100_000);

      // Two flats on the parcel, two charges raised — not three.
      const total =
        (landlordBill.kind === 'assessed' ? landlordBill.amount : 0) +
        (tenantBill.kind === 'assessed' ? tenantBill.amount : 0);
      expect(total).toBe(200_000);
    });

    it('bills the owner for both flats when the fee is owner-borne', () => {
      // A pavement fee does not care who sleeps there, and the tenant owes none
      // of it — they own nothing.
      const landlordBill = assessCitizen([landlord()], { ...flats, bearer: 'OWNER' });
      const tenantBill = assessCitizen([tenant()], { ...flats, bearer: 'OWNER' });

      expect(landlordBill.kind === 'assessed' && landlordBill.amount).toBe(200_000);
      expect(tenantBill.kind === 'assessed' && tenantBill.amount).toBe(0);
    });

    it('defaults to the occupant, and to the arithmetic that came before it', () => {
      /*
        The compatibility guarantee, stated as a test.

        On a register where nobody has recorded a unit status, every unit reads
        as null — presumed occupied by its owner — so an occupant-borne notice
        charges for all of them. That is exactly what the biller did before any
        of this existed, which is what makes OCCUPANT safe to default to, and
        why the correction only switches itself on as landlords actually mark
        units as let.
      */
      const unmarked = [building('1553', [['SHOP', 40], ['SHOP', 25], ['SHOP', 30]])];

      const defaulted = assessCitizen(unmarked, rate);
      const explicit = assessCitizen(unmarked, { ...rate, bearer: 'OCCUPANT' });

      expect(defaulted.kind === 'assessed' && defaulted.amount).toBe(300_000);
      expect(explicit.kind === 'assessed' && explicit.amount).toBe(300_000);
    });

    it('counts what it left out, so the invoice can say so', () => {
      const result = assessCitizen(
        [
          building('1553', [
            ['SHOP', 40, 'OWNER_OCCUPIED'],
            ['SHOP', 25, 'RENTED'],
            ['SHOP', 30, 'VACANT'],
          ]),
        ],
        { ...rate, bearer: 'OCCUPANT' },
      );

      expect(result.kind === 'assessed' && result.amount).toBe(100_000);
      expect(result.kind === 'assessed' && result.assessment.unitCount).toBe(1);
      expect(result.kind === 'assessed' && result.assessment.excludedUnitCount).toBe(2);
    });

    it('excludes nothing when every unit is borne by the person assessed', () => {
      const result = assessCitizen([building('1553', [['SHOP', 40]])], {
        ...rate,
        bearer: 'OCCUPANT',
      });

      expect(result.kind === 'assessed' && result.assessment.excludedUnitCount).toBe(0);
    });

    it('applies the same rule to a house filed on its own card', () => {
      // The two storage shapes have to agree, or what someone owes would depend
      // on how the register happened to file their property.
      const rented = card('HOUSE', '1554', 'INDEPENDENT_HOUSE', 90, { unitStatus: 'RENTED' });
      const notice = {
        amount: 100_000,
        basis: 'PER_UNIT' as const,
        targetCategory: 'INDEPENDENT_HOUSE',
      };

      const asOccupant = assessCitizen([rented], { ...notice, bearer: 'OCCUPANT' });
      const asOwner = assessCitizen([rented], { ...notice, bearer: 'OWNER' });

      expect(asOccupant.kind === 'assessed' && asOccupant.amount).toBe(0);
      expect(asOwner.kind === 'assessed' && asOwner.amount).toBe(100_000);
    });

    it('measures only the units it charges for, under a per-area fee', () => {
      const result = assessCitizen(
        [
          building('1553', [
            ['SHOP', 40, 'OWNER_OCCUPIED'],
            ['SHOP', 25, 'RENTED'],
          ]),
        ],
        { amount: 1_000, basis: 'PER_AREA', targetCategory: 'SHOP', bearer: 'OCCUPANT' },
      );

      expect(result.kind === 'assessed' && result.assessment.totalArea).toBe(40);
      expect(result.kind === 'assessed' && result.amount).toBe(40_000);
    });

    it('does not refuse a per-area bill over a unit it is not charging for', () => {
      /*
        A missing area on a flat this person does not owe for cannot change what
        they owe, so stranding the whole household over it would be a refusal
        that protects nothing.
      */
      const result = assessCitizen(
        [
          building('1553', [
            ['SHOP', 40, 'OWNER_OCCUPIED'],
            ['SHOP', null, 'RENTED'],
          ]),
        ],
        { amount: 1_000, basis: 'PER_AREA', targetCategory: 'SHOP', bearer: 'OCCUPANT' },
      );

      expect(result.kind === 'assessed' && result.amount).toBe(40_000);
    });

    it('still refuses a per-area bill over a unit it is charging for', () => {
      const result = assessCitizen([building('1553', [['SHOP', null, 'OWNER_OCCUPIED']])], {
        amount: 1_000,
        basis: 'PER_AREA',
        targetCategory: 'SHOP',
        bearer: 'OCCUPANT',
      });

      expect(result.kind).toBe('unassessable');
    });

    it('never lets the bearer reach a flat charge', () => {
      // FLAT does not ask the register what anyone holds, so there is no unit
      // for a bearer rule to include or exclude. A tenant still owes it.
      const result = assessCitizen([tenant()], {
        amount: 250_000,
        basis: 'FLAT',
        bearer: 'OWNER',
      });

      expect(result.kind === 'assessed' && result.amount).toBe(250_000);
    });

    it('keeps a breakdown listing only the units actually charged', () => {
      const result = assessCitizen(
        [
          building('1553', [
            ['SHOP', 40, 'OWNER_OCCUPIED'],
            ['SHOP', 25, 'VACANT'],
          ]),
        ],
        { ...rate, bearer: 'OCCUPANT' },
      );

      expect(result.kind === 'assessed' && result.assessment.lines).toEqual([
        { propertyNumber: '1553', propertyType: 'BUILDING', unitType: 'SHOP', unitArea: null },
      ]);
    });
  });

  it('reaches a standalone house through the unit-type category it carries', () => {
    /*
      «منازل مستقلة» is a unit-type category and a منزل carries its type on the
      card rather than in a `units` row. Matching only inside `units` — which is
      what the target query did — found buildings and missed every house in the
      register, so the notice reported that nobody held the category.
    */
    const result = assessCitizen([card('HOUSE', '1553', 'INDEPENDENT_HOUSE', 90)], {
      amount: 100_000,
      basis: 'PER_UNIT',
      targetCategory: 'INDEPENDENT_HOUSE',
    });

    expect(result.kind === 'assessed' && result.amount).toBe(100_000);
  });

  it('does not let an unsurveyed building block a fee aimed at houses', () => {
    /*
      The one unit type a building cannot contain: an INDEPENDENT_HOUSE is what
      a whole HOUSE card is, so surveying the building can never turn up
      another. Blocking here would strand a citizen over a number the notice
      never depended on — the same silent under-collection the refusal exists
      to prevent, arrived at backwards.
    */
    const result = assessCitizen(
      [building('1553', []), card('HOUSE', '1554', 'INDEPENDENT_HOUSE', 90)],
      { amount: 100_000, basis: 'PER_UNIT', targetCategory: 'INDEPENDENT_HOUSE' },
    );

    expect(result.kind === 'assessed' && result.amount).toBe(100_000);
  });

  it('still blocks an unsurveyed building for a category it could be hiding', () => {
    // مستودع is exactly what an unsurveyed building might hold.
    const result = assessCitizen([building('1553', [])], {
      amount: 100_000,
      basis: 'PER_UNIT',
      targetCategory: 'WAREHOUSE',
    });

    expect(result.kind).toBe('unassessable');
  });

  it('bills a citizen who holds none of it nothing at all', () => {
    // Not an error — they simply owe zero, and the caller raises no invoice.
    const result = assessCitizen([card('LAND', '1553', null, 800)], {
      amount: 100_000,
      basis: 'PER_UNIT',
      targetCategory: 'SHOP',
    });

    expect(result.kind === 'assessed' && result.amount).toBe(0);
  });
});
