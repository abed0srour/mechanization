import { PropertyEntry } from './property-entry.entity';
import { Registration, ReportStatus } from './registration.entity';
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

const registration = (status: ReportStatus = 'PENDING'): Registration =>
  Registration.rehydrate({
    id: 'r1',
    citizenId: 'c1',
    referenceNumber: 'BZR-2607-4K9QX2',
    status,
    properties: [property('L-1')],
  });

const actor = { id: 'staff-1', role: 'SUPER_ADMIN' };

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

describe('Registration — status transitions', () => {
  it('walks the review lifecycle in order', () => {
    const report = registration('PENDING');

    expect(report.changeStatus('UNDER_REVIEW', actor)).toEqual({
      from: 'PENDING',
      to: 'UNDER_REVIEW',
    });
    expect(report.changeStatus('VERIFIED', actor).to).toBe('VERIFIED');
    expect(report.changeStatus('APPROVED', actor).to).toBe('APPROVED');
  });

  it('refuses to skip review', () => {
    // The rule that matters: nothing reaches APPROVED without a human having
    // moved it through UNDER_REVIEW and VERIFIED first.
    expect(() => registration('PENDING').changeStatus('APPROVED', actor)).toThrow(ConflictError);
    expect(() => registration('PENDING').changeStatus('VERIFIED', actor)).toThrow(ConflictError);
  });

  it('treats APPROVED and REJECTED as terminal', () => {
    expect(() => registration('APPROVED').changeStatus('REJECTED', actor)).toThrow(ConflictError);
    expect(() => registration('REJECTED').changeStatus('UNDER_REVIEW', actor)).toThrow(
      ConflictError,
    );
  });

  it('allows rejection from any non-terminal state, but only with a reason', () => {
    for (const status of ['PENDING', 'UNDER_REVIEW', 'VERIFIED'] as ReportStatus[]) {
      expect(() => registration(status).changeStatus('REJECTED', actor)).toThrow(ValidationError);
      expect(registration(status).changeStatus('REJECTED', actor, 'مستندات ناقصة').to).toBe(
        'REJECTED',
      );
    }
  });

  it('rejects a blank rejection reason as if it were missing', () => {
    expect(() => registration('PENDING').changeStatus('REJECTED', actor, '   ')).toThrow(
      ValidationError,
    );
  });

  it('records the transition with its actor for the audit trail', () => {
    const report = registration('PENDING');
    report.changeStatus('UNDER_REVIEW', actor);

    const [event] = report.pullEvents();
    expect(event.name).toBe('registration.status-changed');
    expect(event.payload).toMatchObject({ from: 'PENDING', to: 'UNDER_REVIEW', actorId: 'staff-1' });
  });

  it('exposes the legal next steps so the dashboard cannot offer an illegal one', () => {
    expect(registration('PENDING').allowedNextStatuses).toEqual(['UNDER_REVIEW', 'REJECTED']);
    expect(registration('APPROVED').allowedNextStatuses).toEqual([]);
  });
});
