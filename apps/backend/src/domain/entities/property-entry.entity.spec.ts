import { BuildingUnitProps, PropertyEntry, PropertyEntryProps } from './property-entry.entity';
import { ValidationError } from '../errors/domain-error';

/**
 * Pure domain tests — no mocks, no database, no Nest testing module. That the
 * taxonomy rules can be tested this way is the point of keeping them in the
 * entity rather than in a Prisma repository or a controller.
 */
const building = (overrides: Partial<PropertyEntryProps> = {}): PropertyEntryProps => ({
  occupancyType: 'OWNER',
  propertyType: 'BUILDING',
  neighborhood: 'الزهراء',
  propertyNumber: 'B-101',
  buildingName: 'مبنى الزهراء',
  units: [{ unitType: 'APARTMENT', floor: '3', unitArea: 120 }],
  ...overrides,
});

describe('PropertyEntry — occupancy rules', () => {
  it('requires landlord details for a tenant', () => {
    expect(() => PropertyEntry.create(building({ occupancyType: 'TENANT' }))).toThrow(
      ValidationError,
    );
  });

  it('accepts a tenant with landlord name and phone', () => {
    const entry = PropertyEntry.create(
      building({
        occupancyType: 'TENANT',
        landlordName: 'سمير مراد',
        landlordPhone: '+96176555666',
      }),
    );

    expect(entry.requiredProofDocument).toBe('RENTAL_CONTRACT');
  });

  it('strips landlord details from an owner entry', () => {
    // A client that sends landlord fields with OWNER must not have them
    // persisted — the record would then contradict its own occupancy type.
    const entry = PropertyEntry.create(
      building({ occupancyType: 'OWNER', landlordName: 'x', landlordPhone: '+96176555666' }),
    );

    expect(entry.props.landlordName).toBeNull();
    expect(entry.props.landlordPhone).toBeNull();
    expect(entry.requiredProofDocument).toBe('OWNERSHIP_PROOF');
  });
});

describe('PropertyEntry — taxonomy rules', () => {
  it('requires a building name and at least one unit for a building', () => {
    expect(() => PropertyEntry.create(building({ buildingName: '' }))).toThrow(/building name/);
    expect(() => PropertyEntry.create(building({ units: [] }))).toThrow(/at least one unit/);
  });

  it('validates every unit in a building, not just the first', () => {
    const withSecondUnit = (unit: Partial<BuildingUnitProps>) =>
      building({
        units: [
          { unitType: 'APARTMENT', floor: '3', unitArea: 120 },
          { unitType: 'SHOP', floor: '0', unitArea: 40, ...unit },
        ],
      });

    // A landlord filling in six apartments gets one wrong on the fourth; the
    // error has to name which, or they are left hunting.
    expect(() => PropertyEntry.create(withSecondUnit({ floor: '' }))).toThrow(
      /unit 2 requires a floor/,
    );
    expect(() => PropertyEntry.create(withSecondUnit({ unitArea: 0 }))).toThrow(
      /unit 2 requires an area/,
    );
    expect(() => PropertyEntry.create(withSecondUnit({}))).not.toThrow();
  });

  it('keeps a building whole rather than one entry per apartment', () => {
    // The parcel has a single رقم العقار and that column is unique, so the
    // units have to hang off it — this is the constraint the model exists for.
    const entry = PropertyEntry.create(
      building({
        units: [
          { unitType: 'APARTMENT', floor: '1', unitArea: 110 },
          { unitType: 'APARTMENT', floor: '2', unitArea: 110 },
          { unitType: 'SHOP', floor: '0', unitArea: 45 },
        ],
      }),
    );

    expect(entry.propertyNumber).toBe('B-101');
    expect(entry.props.units).toHaveLength(3);
    // The single-unit columns stay empty: a building's detail lives in `units`.
    expect(entry.props.unitType).toBeNull();
    expect(entry.props.floor).toBeNull();
    expect(entry.props.unitArea).toBeNull();
  });

  it('refuses to divide anything but a building into units', () => {
    expect(() =>
      PropertyEntry.create({
        occupancyType: 'OWNER',
        propertyType: 'LAND',
        neighborhood: 'الزهراء',
        propertyNumber: 'L-405',
        landType: 'AGRICULTURAL',
        unitArea: 900,
        units: [{ unitType: 'APARTMENT', floor: '1', unitArea: 90 }],
      }),
    ).toThrow(/cannot be divided into units/);
  });

  it('rejects a house that carries a floor or unit type', () => {
    const house: PropertyEntryProps = {
      occupancyType: 'OWNER',
      propertyType: 'HOUSE',
      neighborhood: 'الزهراء',
      propertyNumber: 'H-202',
      buildingName: 'منزل الحديقة',
      unitArea: 85,
    };

    expect(() => PropertyEntry.create({ ...house, floor: '2' })).toThrow(/cannot have a floor/);
    expect(() => PropertyEntry.create({ ...house, unitType: 'SHOP' })).toThrow(
      /cannot have a unit type/,
    );
    expect(() => PropertyEntry.create(house)).not.toThrow();
  });

  it('rejects land that carries building details', () => {
    expect(() =>
      PropertyEntry.create({
        occupancyType: 'OWNER',
        propertyType: 'LAND',
        neighborhood: 'الزهراء',
        propertyNumber: 'L-404',
        landType: 'AGRICULTURAL',
        unitArea: 2400,
        buildingName: 'should not be here',
      }),
    ).toThrow(/cannot carry building details/);
  });

  it('requires a location for a tent and clears its area', () => {
    expect(() =>
      PropertyEntry.create({
        occupancyType: 'OWNER',
        propertyType: 'TENT',
        neighborhood: 'الزهراء',
        propertyNumber: 'T-303',
      }),
    ).toThrow(/location/);

    const tent = PropertyEntry.create({
      occupancyType: 'OWNER',
      propertyType: 'TENT',
      neighborhood: 'الزهراء',
      propertyNumber: 'T-303',
      tentLocation: 'مخيم الشمال — قطاع ب',
      unitArea: 20,
    });

    expect(tent.props.unitArea).toBeNull();
  });
});

describe('PropertyEntry — coordinates', () => {
  it('accepts an entry with no location at all', () => {
    expect(() => PropertyEntry.create(building())).not.toThrow();
  });

  it('rejects a half-supplied location', () => {
    expect(() => PropertyEntry.create(building({ latitude: 33.27 }))).toThrow(
      /both a latitude and a longitude/,
    );
  });

  it('rejects a pin outside Lebanon', () => {
    // Paris. A mis-tap here would silently stretch the admin map's bounds so far
    // that every real marker collapses into a dot.
    expect(() =>
      PropertyEntry.create(building({ latitude: 48.85, longitude: 2.35 })),
    ).toThrow(/خارج حدود لبنان/);
  });

  it('accepts a pin inside Lebanon', () => {
    expect(() =>
      PropertyEntry.create(building({ latitude: 33.2705, longitude: 35.2038 })),
    ).not.toThrow();
  });
});

/**
 * «غير مؤكَّد» — a field officer who could not establish a field, and said so.
 *
 * The waiver reaches the entity as a set of bare field names for one card. What
 * these assert is the narrowness of it: one named field stops being required,
 * and nothing else about the card changes.
 */
describe('PropertyEntry — unestablished fields', () => {
  it('waives only the field named, not the one beside it', () => {
    // Both the name and the units are missing; only the name is excused.
    expect(() =>
      PropertyEntry.create(building({ buildingName: '', units: [] }), new Set(['buildingName'])),
    ).toThrow(/at least one unit/);
  });

  it('accepts a building whose units were never surveyed', () => {
    const entry = PropertyEntry.create(building({ units: [] }), new Set(['units']));
    expect(entry.props.units).toEqual([]);
  });

  it('still validates the units that were recorded', () => {
    // The flag covers "we did not go through the building", not "we wrote this
    // apartment down badly" — a unit that exists is entered whole.
    expect(() =>
      PropertyEntry.create(
        building({ units: [{ unitType: 'APARTMENT', floor: '', unitArea: 90 }] }),
        new Set(['units']),
      ),
    ).toThrow(/requires a floor/);
  });

  it('accepts a tenant whose landlord could not be reached', () => {
    const entry = PropertyEntry.create(
      building({ occupancyType: 'TENANT', landlordName: 'سمير مراد' }),
      new Set(['landlordPhone']),
    );

    expect(entry.props.landlordName).toBe('سمير مراد');
  });

  it('accepts a plot with no رقم العقار and no الحي', () => {
    const entry = PropertyEntry.create(
      {
        occupancyType: 'OWNER',
        propertyType: 'LAND',
        landType: 'AGRICULTURAL',
        unitArea: 800,
      },
      new Set(['neighborhood', 'propertyNumber']),
    );

    // Null rather than an empty string: the column is nullable precisely so it
    // can hold an absence, and '' is a value that would compare equal across
    // every unidentified parcel.
    expect(entry.propertyNumber).toBeNull();
    expect(entry.props.neighborhood).toBeNull();
  });

  it('still refuses a contradiction a flag cannot explain', () => {
    // "Land with units" is not a fact nobody could collect — it is a payload
    // that disagrees with itself, so no waiver applies.
    expect(() =>
      PropertyEntry.create(
        {
          occupancyType: 'OWNER',
          propertyType: 'LAND',
          neighborhood: 'الزهراء',
          propertyNumber: 'L-9',
          landType: 'AGRICULTURAL',
          unitArea: 800,
          units: [{ unitType: 'SHOP', floor: '1', unitArea: 40 }],
        },
        new Set(['units', 'landType', 'unitArea']),
      ),
    ).toThrow(/cannot be divided into units/);
  });

  it('validates exactly as before when nothing is flagged', () => {
    expect(() => PropertyEntry.create(building({ buildingName: '' }))).toThrow(/building name/);
  });
});
