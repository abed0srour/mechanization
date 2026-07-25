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
        propertyNumber: 'T-303',
      }),
    ).toThrow(/location/);

    const tent = PropertyEntry.create({
      occupancyType: 'OWNER',
      propertyType: 'TENT',
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
