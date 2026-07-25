import { PropertyEntry, PropertyEntryProps } from './property-entry.entity';
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
  unitType: 'APARTMENT',
  buildingName: 'مبنى الزهراء',
  floor: '3',
  unitArea: 120,
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
  it('requires unit type, building name, floor and area for a building', () => {
    expect(() => PropertyEntry.create(building({ unitType: null }))).toThrow(/unit type/);
    expect(() => PropertyEntry.create(building({ buildingName: '' }))).toThrow(/building name/);
    expect(() => PropertyEntry.create(building({ floor: '' }))).toThrow(/floor/);
    expect(() => PropertyEntry.create(building({ unitArea: 0 }))).toThrow(/area/);
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
