import { PropertyEntry } from './property-entry.entity';
import { Registration } from './registration.entity';
import { ConflictError, ValidationError } from '../errors/domain-error';

const property = (propertyNumber: string): PropertyEntry =>
  PropertyEntry.create({
    occupancyType: 'OWNER',
    propertyType: 'LAND',
    neighborhood: 'الزهراء',
    propertyNumber,
    landType: 'AGRICULTURAL',
    unitArea: 500,
  });

describe('Registration — creation', () => {
  it('rejects a submission with no properties', () => {
    expect(() =>
      Registration.create({
        id: 'r1',
        citizenId: 'c1',
        referenceNumber: 'BZR-2607-4K9QX2',
        properties: [],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects two cards claiming the same property number', () => {
    expect(() =>
      Registration.create({
        id: 'r1',
        citizenId: 'c1',
        referenceNumber: 'BZR-2607-4K9QX2',
        properties: [property('L-1'), property('L-1')],
      }),
    ).toThrow(ConflictError);
  });

  it('records a submitted event so the audit trail has something to subscribe to', () => {
    const created = Registration.create({
      id: 'r1',
      citizenId: 'c1',
      referenceNumber: 'BZR-2607-4K9QX2',
      properties: [property('L-1')],
    });

    const events = created.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('registration.submitted');

    // Draining twice must not republish — an audit trail with duplicates is
    // worse than one with gaps, because it looks complete.
    expect(created.pullEvents()).toHaveLength(0);
  });
});
