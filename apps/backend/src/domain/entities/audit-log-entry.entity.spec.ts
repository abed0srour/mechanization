import { AuditLogEntry } from './audit-log-entry.entity';

describe('AuditLogEntry — redaction', () => {
  it('redacts identity and contact fields from the trail', () => {
    const entry = AuditLogEntry.create({
      actorType: 'STAFF',
      action: 'STATUS_CHANGE',
      entityType: 'Registration',
      after: {
        status: 'VERIFIED',
        identityDocNumber: '1234567',
        civilRecordNumber: '12',
        phone: '+96170111222',
      },
    });

    expect(entry.props.after).toEqual({
      status: 'VERIFIED',
      identityDocNumber: '[redacted]',
      civilRecordNumber: '[redacted]',
      phone: '[redacted]',
    });
  });

  it('redacts nested and array-nested values', () => {
    // The realistic shape: a before/after diff of a whole registration, where
    // the sensitive fields are two levels down inside a property list.
    const entry = AuditLogEntry.create({
      actorType: 'STAFF',
      action: 'STATUS_CHANGE',
      entityType: 'Registration',
      before: {
        citizen: { firstName: 'علي', identityDocNumber: '1234567' },
        properties: [{ propertyNumber: 'B-101', landlordPhone: '+96176555666' }],
      },
    });

    expect(entry.props.before).toEqual({
      citizen: { firstName: 'علي', identityDocNumber: '[redacted]' },
      properties: [{ propertyNumber: 'B-101', landlordPhone: '[redacted]' }],
    });
  });

  it('redacts credentials regardless of key casing', () => {
    const entry = AuditLogEntry.create({
      actorType: 'SYSTEM',
      action: 'LOGIN',
      entityType: 'User',
      after: { passwordHash: 'x', TotpSecret: 'y', accessToken: 'z' },
    });

    expect(entry.props.after).toEqual({
      passwordHash: '[redacted]',
      TotpSecret: '[redacted]',
      accessToken: '[redacted]',
    });
  });

  it('leaves an absent payload as null rather than inventing an object', () => {
    const entry = AuditLogEntry.create({
      actorType: 'STAFF',
      action: 'LOGIN',
      entityType: 'User',
    });

    expect(entry.props.before).toBeNull();
    expect(entry.props.after).toBeNull();
  });
});
