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
): BillablePropertyEntry => ({
  propertyType: 'BUILDING',
  propertyNumber,
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
): BillablePropertyEntry => ({
  propertyType,
  propertyNumber,
  unitType,
  unitArea,
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
   * حالة الوحدة, and the rule that it costs nothing until someone decides it
   * should.
   *
   * The danger this feature carries is not that empty units go unbilled — it
   * is that they go unbilled *by accident*, from a field an officer set months
   * ago, on a recurring notice nobody re-reads. So the exemption is opt-in per
   * notice, an unmarked unit is charged, and whatever was let off is counted.
   */
  describe('unoccupied units', () => {
    const mixed = [
      building('1553', [
        ['SHOP', 40, 'RENTED'],
        ['SHOP', 25, 'VACANT'],
        ['SHOP', 30, 'UNDER_CONSTRUCTION'],
      ]),
    ];

    it('charges vacant units unless the notice says otherwise', () => {
      // The default, and the whole compatibility guarantee: recording a شاغرة
      // on a property card cannot move a bill on its own.
      const result = assessCitizen(mixed, {
        amount: 100_000,
        basis: 'PER_UNIT',
        targetCategory: 'SHOP',
      });

      expect(result.kind === 'assessed' && result.amount).toBe(300_000);
      expect(result.kind === 'assessed' && result.assessment.excludedUnitCount).toBe(0);
    });

    it('exempts vacant and under-construction units when the notice does', () => {
      const result = assessCitizen(mixed, {
        amount: 100_000,
        basis: 'PER_UNIT',
        targetCategory: 'SHOP',
        chargesUnoccupied: false,
      });

      // Only the rented shop is charged; both ways of being empty are exempt.
      expect(result.kind === 'assessed' && result.amount).toBe(100_000);
      expect(result.kind === 'assessed' && result.assessment.excludedUnitCount).toBe(2);
    });

    it('treats a unit nobody recorded a status for as occupied', () => {
      /*
        The direction this has to fail in. Null is "not asked", not "empty" —
        read the other way, every row written before the column existed would
        exempt itself, and the shortfall would be invisible.
      */
      const result = assessCitizen([building('1553', [['SHOP', 40]])], {
        amount: 100_000,
        basis: 'PER_UNIT',
        targetCategory: 'SHOP',
        chargesUnoccupied: false,
      });

      expect(result.kind === 'assessed' && result.amount).toBe(100_000);
      expect(result.kind === 'assessed' && result.assessment.excludedUnitCount).toBe(0);
    });

    it('exempts an empty house filed on its own card, not just a flat', () => {
      // The two storage shapes have to reach the same answer, or the exemption
      // would depend on how the register happened to file the property.
      const house: BillablePropertyEntry = {
        propertyType: 'HOUSE',
        propertyNumber: '1554',
        unitType: 'INDEPENDENT_HOUSE',
        unitArea: 90,
        unitStatus: 'VACANT',
        units: [],
      };

      const result = assessCitizen([house], {
        amount: 100_000,
        basis: 'PER_UNIT',
        targetCategory: 'HOUSE',
        chargesUnoccupied: false,
      });

      expect(result.kind === 'assessed' && result.amount).toBe(0);
      expect(result.kind === 'assessed' && result.assessment.excludedUnitCount).toBe(1);
    });

    it('does not refuse a per-area bill over an exempt unit with no area', () => {
      /*
        The missing area cannot change what this citizen owes — the unit is not
        being charged for either way — so stranding the whole household over it
        would be a refusal that protects nothing.
      */
      const result = assessCitizen(
        [building('1553', [['SHOP', 40, 'RENTED'], ['SHOP', null, 'VACANT']])],
        { amount: 1_000, basis: 'PER_AREA', targetCategory: 'SHOP', chargesUnoccupied: false },
      );

      expect(result.kind === 'assessed' && result.amount).toBe(40_000);
    });

    it('still refuses a per-area bill over a charged unit with no area', () => {
      const result = assessCitizen(
        [building('1553', [['SHOP', null, 'RENTED']])],
        { amount: 1_000, basis: 'PER_AREA', targetCategory: 'SHOP', chargesUnoccupied: false },
      );

      expect(result.kind).toBe('unassessable');
    });

    it('never lets the exemption reach a flat charge', () => {
      // FLAT does not ask the register what anyone holds, so there is nothing
      // for an exemption to remove.
      const result = assessCitizen(mixed, {
        amount: 250_000,
        basis: 'FLAT',
        chargesUnoccupied: false,
      });

      expect(result.kind === 'assessed' && result.amount).toBe(250_000);
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
