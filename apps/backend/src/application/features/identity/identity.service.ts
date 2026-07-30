import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  PASSWORD_HASHER,
  TOTP_SERVICE,
  USER_REPOSITORY,
} from '../../../domain/interfaces/base-repository.interface';
import {
  PasswordHasher,
  TotpService,
} from '../../../domain/interfaces/otp-repository.interface';
import {
  CitizenChoice,
  UserRepository,
} from '../../../domain/interfaces/user-repository.interface';
import { StaffRole } from '../../../domain/entities/user.entity';
import { NotFoundError, UnauthorizedError } from '../../common/exceptions';
import { OtpService } from './otp.service';

/** The single token shape. Both citizens and staff carry exactly this. */
export interface SessionClaims {
  sub: string;
  tenantSlug: string;
  kind: 'STAFF' | 'CITIZEN';
  role?: StaffRole;
}

export interface SessionResult {
  accessToken: string;
  expiresIn: string;
  user: { id: string; name: string; kind: 'STAFF' | 'CITIZEN'; role?: StaffRole };
}

/** OTP succeeded, but the phone belongs to several household members. */
export interface DisambiguationRequired {
  status: 'CHOOSE_PROFILE';
  phone: string;
  choices: CitizenChoice[];
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOTP_SERVICE) private readonly totp: TotpService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  // ────────────────────────────  Staff  ────────────────────────────

  /**
   * Email + password, then TOTP for SUPER_ADMIN.
   *
   * Every failure path returns the same message and does the same work: telling
   * an attacker whether an email exists, or short-circuiting before the hash
   * compare, turns this endpoint into an account-enumeration oracle.
   */
  async loginStaff(input: {
    tenantSlug: string;
    email: string;
    password: string;
    totpToken?: string;
    /** "تذكّرني على هذا الجهاز" — issues JWT_STAFF_REMEMBER_TTL instead of JWT_STAFF_TTL. */
    remember?: boolean;
    context: { ip?: string; userAgent?: string };
  }): Promise<SessionResult | { status: 'TOTP_REQUIRED' }> {
    const user = await this.users.findStaffByEmail(input.email.toLowerCase());

    if (!user) {
      // Burn comparable time so a missing account is not faster than a wrong
      // password.
      await this.hasher.verify(input.password, DUMMY_HASH);
      throw new UnauthorizedError('بيانات الدخول غير صحيحة');
    }

    const passwordValid = await this.hasher.verify(input.password, user.passwordHash ?? '');
    if (!passwordValid) {
      throw new UnauthorizedError('بيانات الدخول غير صحيحة');
    }

    // Refuses a deactivated account, and refuses a SUPER_ADMIN who never
    // finished TOTP enrolment.
    user.assertMayStartSession();

    if (user.requiresTotp) {
      if (!input.totpToken) {
        // Password was right; the client now needs to collect the second factor.
        return { status: 'TOTP_REQUIRED' };
      }
      if (!this.totp.verify(input.totpToken, user.totpSecret ?? '')) {
        throw new UnauthorizedError('رمز التحقق غير صحيح');
      }
    }

    if (user.tenantSlug !== input.tenantSlug) {
      // A staff row from another municipality reaching this schema means the
      // factory handed out the wrong client. Refuse rather than proceed.
      throw new UnauthorizedError('بيانات الدخول غير صحيحة');
    }

    await this.users.markLoggedIn(user.id);
    user.recordLogin(input.context);
    this.publish(user.pullEvents(), input.tenantSlug);

    return this.issueSession({
      id: user.id,
      name: user.fullName,
      kind: 'STAFF',
      role: user.role,
      tenantSlug: input.tenantSlug,
      remember: input.remember,
    });
  }

  /** Enrolment: hands back the otpauth:// URI for the authenticator app. */
  async beginTotpEnrolment(
    userId: string,
    tenantSlug: string,
  ): Promise<{ secret: string; keyUri: string }> {
    const user = await this.users.findById(userId);
    if (!user || user.kind !== 'STAFF') {
      throw new NotFoundError('Staff user', userId);
    }

    const secret = this.totp.generateSecret();
    await this.users.saveTotpSecret(user.id, secret);

    return {
      secret,
      keyUri: this.totp.keyUri(secret, user.email ?? user.id, `Baladiya ${tenantSlug}`),
    };
  }

  /** Confirms enrolment only after the admin proves the app produces valid codes. */
  async confirmTotpEnrolment(userId: string, token: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || !user.totpSecret) {
      throw new NotFoundError('TOTP enrolment', userId);
    }
    if (!this.totp.verify(token, user.totpSecret)) {
      throw new UnauthorizedError('رمز التحقق غير صحيح');
    }

    await this.users.confirmTotp(user.id);
  }

  // ───────────────────────────  Citizens  ───────────────────────────

  async requestOtp(phone: string, attempt = 1) {
    return this.otp.issue(phone, attempt);
  }

  /**
   * Verifies the code, then resolves *which person* is logging in.
   *
   * A household sharing one phone is the normal case, not an edge case, so a
   * phone matching several profiles returns a choice rather than guessing — and
   * the choice is only offered after the code proved the caller holds the phone.
   */
  async verifyOtp(input: {
    tenantSlug: string;
    phone: string;
    code: string;
    citizenId?: string;
    context: { ip?: string; userAgent?: string };
  }): Promise<SessionResult | DisambiguationRequired> {
    const phone = await this.otp.verify(input.phone, input.code);
    const candidates = await this.users.findCitizensByPhone(phone);

    if (candidates.length === 0) {
      throw new NotFoundError('لا يوجد طلب مسجّل بهذا الرقم');
    }

    if (candidates.length > 1 && !input.citizenId) {
      return { status: 'CHOOSE_PROFILE', phone, choices: candidates };
    }

    const chosenId = input.citizenId ?? candidates[0].id;

    // The chosen id must be one the OTP actually covered — otherwise a valid
    // code for one phone would authenticate any citizen whose id was guessed.
    if (!candidates.some((candidate) => candidate.id === chosenId)) {
      throw new UnauthorizedError('اختيار غير صالح');
    }

    const user = await this.users.findById(chosenId);
    if (!user) {
      throw new NotFoundError('Citizen', chosenId);
    }

    user.assertMayStartSession();

    await this.users.markLoggedIn(user.id);
    user.recordLogin(input.context);
    this.publish(user.pullEvents(), input.tenantSlug);

    return this.issueSession({
      id: user.id,
      name: user.fullName,
      kind: 'CITIZEN',
      tenantSlug: input.tenantSlug,
    });
  }

  // ────────────────────────────  Shared  ────────────────────────────

  /**
   * One issuer, one signing key, one claim shape for both kinds of user — which
   * is the entire reason v2 merged the two auth systems.
   */
  private issueSession(input: {
    id: string;
    name: string;
    kind: 'STAFF' | 'CITIZEN';
    role?: StaffRole;
    tenantSlug: string;
    /** STAFF only — see loginStaff. */
    remember?: boolean;
  }): SessionResult {
    const claims: SessionClaims = {
      sub: input.id,
      tenantSlug: input.tenantSlug,
      kind: input.kind,
      ...(input.role ? { role: input.role } : {}),
    };

    const expiresIn =
      input.kind === 'STAFF'
        ? this.config.get<string>(
            input.remember ? 'JWT_STAFF_REMEMBER_TTL' : 'JWT_STAFF_TTL',
            input.remember ? '30d' : '12h',
          )
        : this.config.get<string>('JWT_CITIZEN_TTL', '7d');

    return {
      accessToken: this.jwt.sign(claims, { expiresIn }),
      expiresIn,
      user: { id: input.id, name: input.name, kind: input.kind, role: input.role },
    };
  }

  private publish(events: ReturnType<typeof Array.prototype.slice>, tenantSlug: string): void {
    for (const event of events as Array<{ name: string; payload: Record<string, unknown> }>) {
      this.events.emit(event.name, { ...event.payload, tenantSlug });
    }
  }
}

/**
 * A real bcrypt hash of a value nothing can match, used to keep the timing of
 * "no such account" close to "wrong password".
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.eS3.eXwuNfMmZLbTfjA.9YMK1XwK1Wu';
