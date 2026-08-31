import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  PASSWORD_HASHER,
  SUPABASE_AUTH_SERVICE,
  TOTP_SERVICE,
  USER_REPOSITORY,
} from '../../../domain/interfaces/base-repository.interface';
import {
  PasswordHasher,
  TotpService,
} from '../../../domain/interfaces/otp-repository.interface';
import { SupabaseAuthService } from '../../../domain/interfaces/supabase-auth.interface';
import {
  CitizenChoice,
  UserRepository,
} from '../../../domain/interfaces/user-repository.interface';
import { StaffRole, User } from '../../../domain/entities/user.entity';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../common/exceptions';
import { OtpService } from './otp.service';

/** The single token shape. Both citizens and staff carry exactly this. */
export interface SessionClaims {
  sub: string;
  tenantSlug: string;
  kind: 'STAFF' | 'CITIZEN';
  role?: StaffRole;
  /**
   * The account's `tokenVersion` when this token was minted.
   *
   * `JwtAuthGuard` compares it against the row on every request, which is what
   * makes a session revocable at all — role travels in this token and is
   * authorised from here, so without the comparison a dismissal or a demotion
   * waited for expiry.
   *
   * Optional on the type because tokens minted before the column existed do
   * not carry it; `SessionRevocationService` reads a missing value as 0, which
   * is every account's starting version.
   */
  tokenVersion?: number;
}

export interface SessionResult {
  accessToken: string;
  supabaseAccessToken?: string;
  expiresIn: string;
  user: { id: string; name: string; kind: 'STAFF' | 'CITIZEN'; role?: StaffRole };
}

/** OTP succeeded, but the phone belongs to several household members. */
export interface DisambiguationRequired {
  status: 'CHOOSE_PROFILE';
  phone: string;
  choices: CitizenChoice[];
}

/**
 * The password was right and a second factor is still owed.
 *
 * Carries nothing else on purpose. Returning the account's name, role or
 * enrolment state here would hand a correct-password-wrong-device caller a
 * confirmation they had found a real administrator, which is most of what the
 * generic login error exists to withhold.
 */
export interface TotpChallengeRequired {
  status: 'TOTP_REQUIRED';
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOTP_SERVICE) private readonly totp: TotpService,
    @Inject(SUPABASE_AUTH_SERVICE) private readonly supabaseAuth: SupabaseAuthService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  // ────────────────────────────  Staff  ────────────────────────────

  /**
   * Email + password, authenticated strictly via Supabase Auth.
   */
  async loginStaff(input: {
    tenantSlug: string;
    email: string;
    password: string;
    totpToken?: string;
    /** "تذكّرني على هذا الجهاز" — issues JWT_STAFF_REMEMBER_TTL instead of JWT_STAFF_TTL. */
    remember?: boolean;
    context: { ip?: string; userAgent?: string };
  }): Promise<SessionResult | TotpChallengeRequired> {
    // 1. Authenticate with Supabase Auth (throws UnauthorizedError if invalid credentials)
    const supabaseResult = await this.supabaseAuth.authenticateStaff(input.email, input.password);

    /**
     * 2. Resolve the staff profile that must already exist in this schema.
     *
     * A missing profile is a refusal, never a provisioning trigger. This block
     * used to create the row on the spot, taking the role and the municipality
     * from `supabaseResult.user.userMetadata` and defaulting them to
     * `SUPER_ADMIN` and *the slug in the request URL* — which meant any account
     * in the shared Supabase project could sign in at any municipality it had
     * no row in and be created as its administrator. `user_metadata` is
     * writable by the account holder through `auth.updateUser()`, so it is not
     * a claim this service may act on; and a fallback that compares the request
     * URL's slug to itself is not a tenant check.
     *
     * Staff accounts are created deliberately, in one of two places: a
     * SUPER_ADMIN inviting a colleague through `StaffService.create`, or
     * `pnpm staff:create` for the first account in a freshly provisioned
     * municipality. Both record who did it.
     */
    const user = await this.users.findStaffByEmail(input.email.toLowerCase());

    if (!user) {
      // Same sentence as a wrong password, deliberately: distinguishing them
      // turns this route into a way to enumerate which emails hold accounts.
      throw new UnauthorizedError('بيانات الدخول غير صحيحة');
    }

    // Refuses a deactivated account
    user.assertMayStartSession();

    if (user.tenantSlug !== input.tenantSlug) {
      // A staff row from another municipality reaching this schema means the
      // factory handed out the wrong client. Refuse rather than proceed.
      throw new UnauthorizedError('بيانات الدخول غير صحيحة');
    }

    /**
     * The second factor, before any session exists.
     *
     * Returns a challenge rather than a session when a code is owed, which is
     * the contract `staffLoginResponseSchema` has always described and the
     * server has never honoured — `totpToken` arrived here and was dropped,
     * so enrolling an authenticator bought exactly nothing.
     */
    const challenge = await this.challengeTotp(user, input.totpToken);
    if (challenge) return challenge;

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
      supabaseAccessToken: supabaseResult.accessToken,
      tokenVersion: user.tokenVersion,
    });
  }

  /**
   * Decides what the second factor owes this login, and enforces it.
   *
   * Returns a challenge when a code is required and none was sent, `null` when
   * the login may proceed, and throws when a code was sent and is wrong. The
   * three outcomes are deliberately distinct: a challenge is not a failure, and
   * answering it with the same `UnauthorizedError` a wrong code gets would
   * leave the client unable to tell "ask for a code" from "you got it wrong".
   *
   * Enforcement follows enrolment rather than role for everyone except
   * SUPER_ADMIN. An AUDITOR who has set up an authenticator is asked for it —
   * having enrolled, being able to sign in without it is precisely the defect
   * this closes.
   */
  private async challengeTotp(
    user: User,
    token?: string,
  ): Promise<TotpChallengeRequired | null> {
    const secret = user.totpSecret;

    if (!user.hasConfirmedTotp || !secret) {
      /**
       * A SUPER_ADMIN reads every citizen's national ID number, residency
       * status and scanned documents, and can export the register or restore
       * over it. Enrolment for that role is a precondition of holding the
       * account, not a setting inside it — so an incomplete one is refused
       * here rather than waved through with a warning.
       *
       * The account is not stranded: `pnpm staff:create` enrols the first
       * administrator of a municipality at creation time, and
       * `StaffService.create` returns an enrolment URI for every SUPER_ADMIN
       * invited afterwards.
       */
      if (user.requiresTotp) {
        throw new UnauthorizedError(
          'هذا الحساب يتطلّب التحقق بخطوتين، ولم يكتمل تسجيل تطبيق المصادقة. يرجى مراجعة مدير النظام.',
        );
      }
      return null;
    }

    if (!token) return { status: 'TOTP_REQUIRED' };

    if (!this.totp.verify(token, secret)) {
      throw new UnauthorizedError('رمز التحقق غير صحيح');
    }

    /**
     * Verified is not yet accepted: the code must also be one this account has
     * not already used.
     *
     * `otplib` runs with a one-step window, so a given six digits verify for
     * roughly ninety seconds. That window is exactly long enough for a code
     * observed over a shoulder, relayed through a phishing page, or left on a
     * shared municipal screen to be replayed. Burning the step closes it.
     *
     * The write is conditional inside the repository, so two logins racing
     * with the same code cannot both win; the loser lands here as a replay.
     */
    await this.users.recordTotpStep(user.id, this.totp.currentStep());

    return null;
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

    // Recorded because issuing a new second factor is exactly the step an
    // account takeover needs, and the trail is the only place that would show
    // it happening. The secret itself is never part of the payload.
    this.events.emit('staff.changed', {
      action: 'TOTP_ENROLLED',
      tenantSlug,
      staffId: user.id,
      actorId: user.id,
      actorRole: user.role ?? '',
    });

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

    this.events.emit('staff.changed', {
      action: 'TOTP_CONFIRMED',
      tenantSlug: user.tenantSlug,
      staffId: user.id,
      actorId: user.id,
      actorRole: user.role ?? '',
    });
  }

  /**
   * Change own password. Verifies current password first, updates passwordHash and Supabase Auth.
   */
  async changeStaffPassword(
    userId: string,
    tenantSlug: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.kind !== 'STAFF' || !user.passwordHash) {
      throw new NotFoundError('Staff user', userId);
    }

    const match = await this.hasher.verify(currentPassword, user.passwordHash);
    if (!match) {
      throw new UnauthorizedError('كلمة المرور الحالية غير صحيحة');
    }

    const passwordHash = await this.hasher.hash(newPassword);
    await this.users.updateStaff(user.id, { passwordHash });

    // Sync to Supabase Auth
    try {
      if (user.email) {
        await this.supabaseAuth.updateStaffUser({
          email: user.email,
          password: newPassword,
        });
      }
    } catch {
      // Non-blocking
    }

    this.events.emit('staff.changed', {
      action: 'STAFF_PASSWORD_CHANGED',
      tenantSlug,
      staffId: user.id,
      actorId: user.id,
      actorRole: user.role ?? '',
    });
  }

  /**
   * Change own email. Verifies current password first, checks uniqueness, and updates Supabase Auth.
   */
  async changeStaffEmail(
    userId: string,
    tenantSlug: string,
    newEmail: string,
    currentPassword: string,
  ): Promise<{ email: string }> {
    const user = await this.users.findById(userId);
    if (!user || user.kind !== 'STAFF' || !user.passwordHash) {
      throw new NotFoundError('Staff user', userId);
    }

    const match = await this.hasher.verify(currentPassword, user.passwordHash);
    if (!match) {
      throw new UnauthorizedError('كلمة المرور الحالية غير صحيحة');
    }

    const nextEmail = newEmail.trim().toLowerCase();
    if (nextEmail === user.email?.toLowerCase()) {
      return { email: nextEmail };
    }

    const existing = await this.users.findStaffByEmail(nextEmail);
    if (existing) {
      throw new ConflictError('البريد الإلكتروني مستخدم بالفعل من قبل موظف آخر');
    }

    await this.users.updateStaff(user.id, { email: nextEmail });

    // Sync to Supabase Auth
    try {
      if (user.email) {
        await this.supabaseAuth.updateStaffUser({
          email: user.email,
          newEmail: nextEmail,
        });
      }
    } catch {
      // Non-blocking
    }

    this.events.emit('staff.changed', {
      action: 'STAFF_EMAIL_CHANGED',
      tenantSlug,
      staffId: user.id,
      actorId: user.id,
      actorRole: user.role ?? '',
    });

    return { email: nextEmail };
  }

  // ───────────────────────────  Citizens  ───────────────────────────

  async requestOtp(phone: string, attempt = 1) {
    return this.otp.issue(phone, attempt);
  }

  /** Whether the citizen login page should collect a code. See `OtpService`. */
  get otpRequired(): boolean {
    return this.otp.enabled;
  }

  /**
   * Citizen sign-in by رقم مرجعي **and** phone number.
   *
   * The reference number alone is not accepted, and that is deliberate: it is
   * printed on a receipt and read aloud at a counter, so treating it as a lone
   * credential would make a citizen's national ID and residency status
   * readable by anyone who glanced at a slip of paper. Requiring the phone on
   * file alongside it is the weakest bar this data can defensibly sit behind.
   *
   * Both failures return the same message for the same reason every other
   * login path here does — a distinct "no such reference" turns this endpoint
   * into a way to enumerate which references exist.
   */
  async loginByReference(input: {
    tenantSlug: string;
    referenceNumber: string;
    phone: string;
    context: { ip?: string; userAgent?: string };
  }): Promise<SessionResult> {
    const citizen = await this.users.findCitizenByReference(input.referenceNumber);

    // Compared here rather than in the query so a wrong phone costs the same
    // work as a wrong reference.
    const phoneMatches =
      citizen?.phone != null && normalisePhone(citizen.phone) === normalisePhone(input.phone);

    if (!citizen || !phoneMatches) {
      throw new UnauthorizedError('الرقم المرجعي أو رقم الهاتف غير صحيح');
    }

    citizen.assertMayStartSession();

    await this.users.markLoggedIn(citizen.id);
    citizen.recordLogin(input.context);
    this.publish(citizen.pullEvents(), input.tenantSlug);

    return this.issueSession({
      id: citizen.id,
      name: citizen.fullName,
      kind: 'CITIZEN',
      tenantSlug: input.tenantSlug,
      tokenVersion: citizen.tokenVersion,
    });
  }

  /**
   * Citizen sign-in by رقم مرجعي alone — the portal's front door.
   *
   * Separate from `loginByReference` rather than a flag on it, so that neither
   * caller can drift into the other's security posture by accident: the
   * payments portal keeps demanding a phone, and only the route that opted into
   * the single-factor bar gets it. See `referenceOnlyLoginSchema` for why the
   * municipality accepts that bar and what actually protects it.
   *
   * The error is the same sentence a wrong-format entry gets, and deliberately
   * does not distinguish "no such reference" from "that citizen is blocked" —
   * a distinct message would turn this into a way to test which references
   * exist.
   */
  async loginByReferenceOnly(input: {
    tenantSlug: string;
    referenceNumber: string;
    context: { ip?: string; userAgent?: string };
  }): Promise<SessionResult> {
    const citizen = await this.users.findCitizenByReference(input.referenceNumber);

    if (!citizen) {
      throw new UnauthorizedError('الرقم المرجعي غير صحيح');
    }

    citizen.assertMayStartSession();

    await this.users.markLoggedIn(citizen.id);
    citizen.recordLogin(input.context);
    this.publish(citizen.pullEvents(), input.tenantSlug);

    return this.issueSession({
      id: citizen.id,
      name: citizen.fullName,
      kind: 'CITIZEN',
      tenantSlug: input.tenantSlug,
      tokenVersion: citizen.tokenVersion,
    });
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
    /** Absent only when OTP is switched off — `otp.verify` enforces it. */
    code?: string;
    citizenId?: string;
    context: { ip?: string; userAgent?: string };
  }): Promise<SessionResult | DisambiguationRequired> {
    // `?? ''` rather than a guard: an empty code fails the hash compare inside
    // `verify` exactly like a wrong one, so a client omitting it while OTP is
    // on is refused by the same path as a client sending six wrong digits.
    const phone = await this.otp.verify(input.phone, input.code ?? '');
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
      tokenVersion: user.tokenVersion,
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
    supabaseAccessToken?: string;
    /** Stamped into the token and compared on every request thereafter. */
    tokenVersion: number;
  }): SessionResult {
    const claims: SessionClaims = {
      sub: input.id,
      tenantSlug: input.tenantSlug,
      kind: input.kind,
      ...(input.role ? { role: input.role } : {}),
      tokenVersion: input.tokenVersion,
    };

    const expiresIn =
      input.kind === 'STAFF'
        ? this.config.get<string>(
            input.remember ? 'JWT_STAFF_REMEMBER_TTL' : 'JWT_STAFF_TTL',
            input.remember ? '30d' : '8h',
          )
        : this.config.get<string>('JWT_CITIZEN_TTL', '7d');

    return {
      accessToken: this.jwt.sign(claims, { expiresIn }),
      ...(input.supabaseAccessToken ? { supabaseAccessToken: input.supabaseAccessToken } : {}),
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
 * Strips formatting so `03 123456`, `+96103123456` and `0096103123456` all
 * compare equal. Not `PhoneNumber.parse` — that throws on a malformed input,
 * and a citizen mistyping their number at the login box should be told their
 * details do not match, not handed a validation error that reveals the
 * reference number itself was fine.
 */
function normalisePhone(value: string): string {
  return value.replace(/[\s-()]/g, '').replace(/^(\+961|00961|0)/, '');
}
