import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnauthorizedError } from '../../shared-kernel/domain/errors';
import { PASSWORD_HASHER, PasswordHasher } from '../domain/password-hasher';
import {
  STAFF_USER_REPOSITORY,
  StaffUserRepository,
} from '../domain/staff-user.repository';

export interface StaffJwtPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  role: string;
  email: string;
}

@Injectable()
export class LoginStaffUseCase {
  constructor(
    @Inject(STAFF_USER_REPOSITORY) private readonly staff: StaffUserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: {
    tenantId: string;
    tenantSlug: string;
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const user = await this.staff.findByEmail(input.tenantId, input.email);

    /**
     * Same error and roughly the same work for "no such user", "wrong password"
     * and "deactivated", so the response cannot be used to enumerate which
     * emails exist in a municipality.
     */
    const passwordOk = user
      ? await this.hasher.verify(input.password, user.passwordHash)
      : await this.hasher.verify(input.password, DUMMY_HASH).then(() => false);

    if (!user || !passwordOk || !user.isActive) {
      this.events.emit('audit.record', {
        tenantId: input.tenantId,
        action: 'STAFF_LOGIN_FAILED',
        entityType: 'MunicipalityUser',
        actorEmail: input.email,
        actorType: 'STAFF',
        after: { reason: !user ? 'UNKNOWN_EMAIL' : !passwordOk ? 'BAD_PASSWORD' : 'INACTIVE' },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedError('Email or password is incorrect');
    }

    user.assertBelongsTo(input.tenantId);
    await this.staff.recordLogin(user.id, new Date());

    const payload: StaffJwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      tenantSlug: input.tenantSlug,
      role: user.role,
      email: user.email,
    };

    this.events.emit('audit.record', {
      tenantId: input.tenantId,
      action: 'STAFF_LOGIN',
      entityType: 'MunicipalityUser',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      actorType: 'STAFF',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn: 12 * 60 * 60,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: input.tenantSlug,
      },
    };
  }
}

/** A real bcrypt hash of a random string, used only to equalise timing. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Hh0Vc5oMPvvbYcnQ0Y0Zk1qA1oQ7Xy';
