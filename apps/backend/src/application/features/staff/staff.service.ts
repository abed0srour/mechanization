import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
  StaffSummary,
  UserRepository,
} from '../../../domain/interfaces/user-repository.interface';
import { StaffRole } from '../../../domain/entities/user.entity';
import { SessionRevocationService } from '../identity/session-revocation.service';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/exceptions';

/**
 * Staff accounts, managed by a SUPER_ADMIN.
 *
 * Two rules here are the whole point of the feature, and neither belongs in a
 * controller:
 *
 *  1. Deactivation is the ordinary "delete". A staff row is referenced by
 *     every audit entry they wrote and every registration they reviewed, so
 *     erasing it would strip the name off a decision the municipality may
 *     later have to answer for.
 *  2. A permanent delete is offered only for an account with no such history —
 *     a mistyped invitation, a colleague who never signed in — where there is
 *     nothing to orphan.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SUPABASE_AUTH_SERVICE) private readonly supabaseAuth: SupabaseAuthService,
    @Inject(TOTP_SERVICE) private readonly totp: TotpService,
    private readonly revocation: SessionRevocationService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Every staff account, each with the history count that decides whether a
   * permanent delete may be offered.
   */
  list(): Promise<StaffSummary[]> {
    return this.users.listStaff();
  }

  async create(input: {
    tenantSlug: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: StaffRole;
    actor: { id: string; role: string };
  }): Promise<{ id: string; totp?: { secret: string; keyUri: string } }> {
    const passwordHash = await this.hasher.hash(input.password);
    const id = await this.users.createStaff({
      tenantSlug: input.tenantSlug,
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
    });

    /**
     * A SUPER_ADMIN is enrolled at creation, not at first sign-in.
     *
     * `IdentityService` refuses a session to that role until enrolment is
     * complete, so an account created without a secret could never sign in —
     * and could not reach the enrolment endpoint either, which is itself behind
     * a session. Issuing the secret here is what keeps that from being a
     * deadlock: the inviting administrator receives it once, in this response,
     * and hands it over with the password.
     *
     * Confirmed immediately rather than after the invitee proves a code,
     * because the person who would prove it cannot sign in to do so. That is a
     * real trade — the secret exists before anyone has scanned it — and the
     * reason `pnpm staff:create --reset-totp` exists: a secret that never
     * reached its owner is reissued rather than leaving the account stranded.
     */
    const totp = input.role === 'SUPER_ADMIN' ? await this.enrolTotp(id) : undefined;

    // Sync to Supabase Auth
    try {
      await this.supabaseAuth.createStaffUser({
        email: input.email,
        password: input.password,
        tenantSlug: input.tenantSlug,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
      });
    } catch {
      // Non-blocking for local fallback if Supabase network is unreachable
    }

    this.events.emit('staff.changed', {
      action: 'STAFF_CREATED',
      tenantSlug: input.tenantSlug,
      staffId: id,
      email: input.email,
      role: input.role,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { id, ...(totp ? { totp } : {}) };
  }

  /**
   * Issues and confirms a second factor for one staff account, returning what
   * the authenticator app needs. Shared by `create` and the `staff:create
   * --reset-totp` CLI, so both produce an account in the same state.
   */
  async enrolTotp(staffId: string): Promise<{ secret: string; keyUri: string }> {
    const user = await this.users.findById(staffId);
    if (!user || user.kind !== 'STAFF') {
      throw new NotFoundError('Staff user', staffId);
    }

    const secret = this.totp.generateSecret();
    await this.users.saveTotpSecret(staffId, secret);
    await this.users.confirmTotp(staffId);

    return {
      secret,
      keyUri: this.totp.keyUri(secret, user.email ?? staffId, `Baladiya ${user.tenantSlug}`),
    };
  }

  async update(input: {
    tenantSlug: string;
    id: string;
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    role?: StaffRole;
    actor: { id: string; role: string };
  }): Promise<void> {
    const target = await this.users.findById(input.id);
    if (!target || target.kind !== 'STAFF') {
      throw new NotFoundError('Staff user', input.id);
    }

    // Demoting yourself out of SUPER_ADMIN can leave a municipality with no
    // one able to manage accounts at all — including no one able to undo it.
    if (input.id === input.actor.id && input.role && input.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('لا يمكنك تغيير صلاحيتك الخاصة');
    }

    await this.users.updateStaff(input.id, {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      ...(input.password ? { passwordHash: await this.hasher.hash(input.password) } : {}),
    });

    // A role or password change bumps `tokenVersion` in the repository; drop
    // the cached copy so the sessions it just revoked stop working now.
    if (input.role || input.password) {
      await this.revocation.forget(input.id);
    }

    // Sync to Supabase Auth
    try {
      await this.supabaseAuth.updateStaffUser({
        email: target.email!,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
      });
    } catch {
      // Non-blocking
    }

    this.events.emit('staff.changed', {
      action: 'STAFF_UPDATED',
      tenantSlug: input.tenantSlug,
      staffId: input.id,
      // Never the new password, hashed or otherwise — the audit trail records
      // that a credential changed, not what it changed to.
      changed: Object.keys({
        ...(input.email ? { email: true } : {}),
        ...(input.firstName ? { firstName: true } : {}),
        ...(input.lastName ? { lastName: true } : {}),
        ...(input.role ? { role: true } : {}),
        ...(input.password ? { password: true } : {}),
      }),
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });
  }

  /** The ordinary delete: the account stops working, the record stays whole. */
  async setActive(input: {
    tenantSlug: string;
    id: string;
    isActive: boolean;
    actor: { id: string; role: string };
  }): Promise<void> {
    const target = await this.users.findById(input.id);
    if (!target || target.kind !== 'STAFF') {
      throw new NotFoundError('Staff user', input.id);
    }

    // Locking yourself out is not a decision worth honouring at 2am.
    if (input.id === input.actor.id && !input.isActive) {
      throw new ForbiddenError('لا يمكنك إلغاء تفعيل حسابك الخاص');
    }

    await this.users.setStaffActive(input.id, input.isActive);
    // The repository has bumped `tokenVersion`; this drops the cached copy so
    // the revocation takes effect now rather than at the end of its TTL.
    await this.revocation.forget(input.id);

    // Sync to Supabase Auth
    try {
      await this.supabaseAuth.updateStaffUser({
        email: target.email!,
        isActive: input.isActive,
      });
    } catch {
      // Non-blocking
    }

    this.events.emit('staff.changed', {
      action: input.isActive ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED',
      tenantSlug: input.tenantSlug,
      staffId: input.id,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });
  }

  /**
   * Erases the row. Refused the moment the account has done anything, which
   * is checked here rather than trusted from the client: the list endpoint
   * reports a history count so the button can be hidden, but hiding a button
   * is not what stops the request.
   */
  async remove(input: {
    tenantSlug: string;
    id: string;
    actor: { id: string; role: string };
  }): Promise<void> {
    const target = await this.users.findById(input.id);
    if (!target || target.kind !== 'STAFF') {
      throw new NotFoundError('Staff user', input.id);
    }

    if (input.id === input.actor.id) {
      throw new ForbiddenError('لا يمكنك حذف حسابك الخاص');
    }

    const history = await this.users.countStaffHistory(input.id);
    if (history > 0) {
      throw new ConflictError(
        'لا يمكن حذف هذا الحساب نهائياً لأن له سجل نشاطات — يمكنك إلغاء تفعيله بدلاً من ذلك',
      );
    }

    await this.users.hardDeleteStaff(input.id);

    // Sync to Supabase Auth
    try {
      if (target.email) {
        await this.supabaseAuth.deleteStaffUser(target.email);
      }
    } catch {
      // Non-blocking
    }

    this.events.emit('staff.changed', {
      action: 'STAFF_DELETED',
      tenantSlug: input.tenantSlug,
      staffId: input.id,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });
  }

  /**
   * Change own password. Verifies current password first.
   */
  async changePassword(input: {
    tenantSlug: string;
    staffId: string;
    currentPassword: string;
    newPassword: string;
    actor: { id: string; role: string };
  }): Promise<void> {
    const target = await this.users.findById(input.staffId);
    if (!target || target.kind !== 'STAFF' || !target.passwordHash) {
      throw new NotFoundError('Staff user', input.staffId);
    }

    const match = await this.hasher.verify(input.currentPassword, target.passwordHash);
    if (!match) {
      throw new UnauthorizedError('كلمة المرور الحالية غير صحيحة');
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.users.updateStaff(input.staffId, { passwordHash });

    await this.revocation.forget(input.staffId);

    try {
      if (target.email) {
        await this.supabaseAuth.updateStaffUser({
          email: target.email,
          password: input.newPassword,
        });
      }
    } catch {
      // Non-blocking
    }

    this.events.emit('staff.changed', {
      action: 'STAFF_PASSWORD_CHANGED',
      tenantSlug: input.tenantSlug,
      staffId: input.staffId,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });
  }

  /**
   * Change own email. Verifies current password first and ensures new email is not taken.
   */
  async changeEmail(input: {
    tenantSlug: string;
    staffId: string;
    newEmail: string;
    currentPassword: string;
    actor: { id: string; role: string };
  }): Promise<{ email: string }> {
    const target = await this.users.findById(input.staffId);
    if (!target || target.kind !== 'STAFF' || !target.passwordHash) {
      throw new NotFoundError('Staff user', input.staffId);
    }

    const match = await this.hasher.verify(input.currentPassword, target.passwordHash);
    if (!match) {
      throw new UnauthorizedError('كلمة المرور الحالية غير صحيحة');
    }

    const nextEmail = input.newEmail.trim().toLowerCase();
    if (nextEmail === target.email?.toLowerCase()) {
      return { email: nextEmail };
    }

    const existing = await this.users.findStaffByEmail(nextEmail);
    if (existing) {
      throw new ConflictError('البريد الإلكتروني مستخدم بالفعل من قبل موظف آخر');
    }

    await this.users.updateStaff(input.staffId, { email: nextEmail });

    try {
      if (target.email) {
        await this.supabaseAuth.updateStaffUser({
          email: target.email,
          newEmail: nextEmail,
        });
      }
    } catch {
      // Non-blocking
    }

    this.events.emit('staff.changed', {
      action: 'STAFF_EMAIL_CHANGED',
      tenantSlug: input.tenantSlug,
      staffId: input.staffId,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { email: nextEmail };
  }

  async sendPasswordResetEmail(input: {
    staffId: string;
    redirectTo?: string;
  }): Promise<{ message: string }> {
    const user = await this.users.findById(input.staffId);
    if (!user || !user.email) {
      throw new NotFoundError('Staff user', input.staffId);
    }
    await this.supabaseAuth.sendPasswordResetEmail(user.email, input.redirectTo);
    return { message: 'تم إرسال بريد إعادة تعيين كلمة المرور بنجاح' };
  }
}
