import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { StaffProps, User } from '../../../domain/entities/user.entity';
import { PasswordHasher, TotpService } from '../../../domain/interfaces/otp-repository.interface';
import { SupabaseAuthService } from '../../../domain/interfaces/supabase-auth.interface';
import { UserRepository } from '../../../domain/interfaces/user-repository.interface';
import { UnauthorizedError } from '../../common/exceptions';
import { IdentityService, SessionResult } from './identity.service';
import { OtpService } from './otp.service';

/**
 * The staff sign-in path, which carried two defects that a single test each
 * would have made impossible.
 *
 * The first was a provisioning branch: a login against a municipality the
 * account had no row in *created* that row, reading its role and its
 * municipality from Supabase `user_metadata` and defaulting them to
 * `SUPER_ADMIN` and the slug in the request URL. `user_metadata` is writable by
 * the account holder, and a tenant check whose fallback is the request's own
 * slug compares a value to itself — so any account in the shared Supabase
 * project was one login away from administering any municipality.
 *
 * The second was quieter: `totpToken` reached this service and was never read.
 * `staffLoginResponseSchema` has always described a `TOTP_REQUIRED` challenge,
 * `beginTotpEnrolment` has always worked, and none of it was ever enforced —
 * so an administrator who set up an authenticator gained nothing at all.
 */

const STAFF: StaffProps = {
  id: 'staff-1',
  tenantSlug: 'albazourieh',
  email: 'admin@albazourieh.gov.lb',
  passwordHash: '',
  role: 'SUPER_ADMIN',
  firstName: 'مدير',
  lastName: 'النظام',
  isActive: true,
  totpSecret: 'SECRET',
  totpConfirmedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function staff(overrides: Partial<StaffProps> = {}): User {
  return User.staff({ ...STAFF, ...overrides });
}

/** Supabase says the password was right — every test here starts from there. */
const SUPABASE_OK = {
  user: {
    id: 'sb-1',
    email: STAFF.email,
    // The metadata the removed branch trusted. Left deliberately hostile: these
    // are the values an attacker would set on their own account.
    userMetadata: { role: 'SUPER_ADMIN', tenantSlug: 'some-other-tenant' },
    appMetadata: {},
  },
  accessToken: 'supabase-token',
};

function build(
  repository: Partial<UserRepository>,
  totpVerifies = true,
): { service: IdentityService; createStaff: jest.Mock } {
  const createStaff = jest.fn().mockResolvedValue('should-never-be-called');

  const users = {
    findStaffByEmail: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    markLoggedIn: jest.fn().mockResolvedValue(undefined),
    recordTotpStep: jest.fn().mockResolvedValue(undefined),
    createStaff,
    ...repository,
  } as unknown as UserRepository;

  const service = new IdentityService(
    users,
    { hash: jest.fn(), verify: jest.fn() } as unknown as PasswordHasher,
    {
      generateSecret: jest.fn().mockReturnValue('SECRET'),
      keyUri: jest.fn().mockReturnValue('otpauth://x'),
      verify: jest.fn().mockReturnValue(totpVerifies),
      currentStep: jest.fn().mockReturnValue(58_000_000),
    } as unknown as TotpService,
    {
      authenticateStaff: jest.fn().mockResolvedValue(SUPABASE_OK),
    } as unknown as SupabaseAuthService,
    {} as OtpService,
    { sign: jest.fn().mockReturnValue('jwt-token') } as unknown as JwtService,
    { get: jest.fn().mockReturnValue('12h') } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as EventEmitter2,
  );

  return { service, createStaff };
}

const LOGIN = {
  tenantSlug: 'albazourieh',
  email: STAFF.email,
  password: 'correct-horse-battery-staple',
  context: {},
};

describe('loginStaff — a missing profile is a refusal, not a provisioning trigger', () => {
  it('refuses a Supabase-verified account with no staff row in this municipality', async () => {
    const { service, createStaff } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(null),
    });

    await expect(service.loginStaff(LOGIN)).rejects.toBeInstanceOf(UnauthorizedError);
    // The whole finding in one assertion: no row is created for a caller who
    // simply asked for a municipality they have no account in.
    expect(createStaff).not.toHaveBeenCalled();
  });

  it('does not read role or tenant from Supabase user_metadata', async () => {
    // `SUPABASE_OK` claims SUPER_ADMIN of a different tenant. If any of it were
    // still consulted, this login would succeed or create something.
    const { service, createStaff } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(null),
    });

    await expect(service.loginStaff(LOGIN)).rejects.toThrow('بيانات الدخول غير صحيحة');
    expect(createStaff).not.toHaveBeenCalled();
  });

  it('refuses a staff row belonging to another municipality', async () => {
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff({ tenantSlug: 'zahle' })),
    });

    await expect(service.loginStaff(LOGIN)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses a deactivated account', async () => {
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff({ isActive: false })),
    });

    await expect(service.loginStaff(LOGIN)).rejects.toThrow(/deactivated/i);
  });
});

describe('loginStaff — the second factor is actually checked', () => {
  it('challenges rather than signing in when a code is owed', async () => {
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff()),
    });

    const result = await service.loginStaff(LOGIN);

    expect(result).toEqual({ status: 'TOTP_REQUIRED' });
    // Not a session: the defect was that this branch returned one.
    expect(result).not.toHaveProperty('accessToken');
  });

  it('does not mark a login that never completed', async () => {
    const markLoggedIn = jest.fn();
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff()),
      markLoggedIn,
    });

    await service.loginStaff(LOGIN);

    expect(markLoggedIn).not.toHaveBeenCalled();
  });

  it('refuses a wrong code', async () => {
    const { service } = build(
      { findStaffByEmail: jest.fn().mockResolvedValue(staff()) },
      /* totpVerifies */ false,
    );

    await expect(
      service.loginStaff({ ...LOGIN, totpToken: '000000' }),
    ).rejects.toThrow('رمز التحقق غير صحيح');
  });

  it('issues a session for a correct code', async () => {
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff()),
    });

    const result = (await service.loginStaff({
      ...LOGIN,
      totpToken: '123456',
    })) as SessionResult;

    expect(result.accessToken).toBe('jwt-token');
    expect(result.user.role).toBe('SUPER_ADMIN');
  });

  it('asks an enrolled AUDITOR for a code too', async () => {
    // Enforcement follows enrolment, not role: having set an authenticator up,
    // being able to sign in without it is the defect.
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff({ role: 'AUDITOR' })),
    });

    await expect(service.loginStaff(LOGIN)).resolves.toEqual({ status: 'TOTP_REQUIRED' });
  });

  it('lets an unenrolled AUDITOR sign in', async () => {
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(
        staff({ role: 'AUDITOR', totpSecret: null, totpConfirmedAt: null }),
      ),
    });

    const result = (await service.loginStaff(LOGIN)) as SessionResult;
    expect(result.accessToken).toBe('jwt-token');
  });

  it('allows a SUPER_ADMIN whose enrolment is not yet complete to sign in to set it up', async () => {
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(
        staff({ totpSecret: null, totpConfirmedAt: null }),
      ),
    });

    const result = (await service.loginStaff(LOGIN)) as SessionResult;
    expect(result.accessToken).toBe('jwt-token');
  });

  it('allows a SUPER_ADMIN whose secret was issued but unconfirmed to sign in to finish setup', async () => {
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff({ totpConfirmedAt: null })),
    });

    const result = (await service.loginStaff(LOGIN)) as SessionResult;
    expect(result.accessToken).toBe('jwt-token');
  });
});

describe('loginStaff — a TOTP code is single-use', () => {
  it('burns the step so the same code cannot be replayed', async () => {
    const recordTotpStep = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff()),
      recordTotpStep,
    });

    await service.loginStaff({ ...LOGIN, totpToken: '123456' });

    // Verified is not accepted: with otplib's one-step window the same digits
    // stay valid for about ninety seconds, so the step has to be spent.
    expect(recordTotpStep).toHaveBeenCalledWith('staff-1', 58_000_000);
  });

  it('refuses a code whose step has already been spent', async () => {
    // What a second login with the same digits looks like: the conditional
    // write in the repository matches no row and raises.
    const { service } = build({
      findStaffByEmail: jest.fn().mockResolvedValue(staff()),
      recordTotpStep: jest.fn().mockRejectedValue(new Error('تم استخدام هذا الرمز بالفعل')),
    });

    await expect(
      service.loginStaff({ ...LOGIN, totpToken: '123456' }),
    ).rejects.toThrow(/تم استخدام هذا الرمز/);
  });

  it('does not burn a step when the code was wrong', async () => {
    const recordTotpStep = jest.fn();
    const { service } = build(
      { findStaffByEmail: jest.fn().mockResolvedValue(staff()), recordTotpStep },
      false,
    );

    await expect(service.loginStaff({ ...LOGIN, totpToken: '000000' })).rejects.toThrow();
    expect(recordTotpStep).not.toHaveBeenCalled();
  });
});
