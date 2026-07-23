import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundError } from '../../shared-kernel/domain/errors';
import { ReportStatus } from '../domain/registration.entity';
import {
  REGISTRATION_REPOSITORY,
  RegistrationRepository,
} from '../domain/registration.repository';

@Injectable()
export class ChangeRegistrationStatusUseCase {
  constructor(
    @Inject(REGISTRATION_REPOSITORY) private readonly registrations: RegistrationRepository,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: {
    tenantId: string;
    registrationId: string;
    status: ReportStatus;
    reason?: string;
    staff: { id: string; email: string; role: string };
  }) {
    const registration = await this.registrations.findById(
      input.tenantId,
      input.registrationId,
    );
    if (!registration) throw new NotFoundError('Registration', input.registrationId);

    // The entity decides whether the transition is legal.
    const change = registration.changeStatus(input.status, input.reason);

    await this.registrations.updateStatus({
      tenantId: input.tenantId,
      registrationId: input.registrationId,
      status: input.status,
      reason: input.reason,
      // Recorded from the verified JWT, never from the request body.
      reviewedById: input.staff.id,
    });

    this.events.emit('audit.record', {
      tenantId: input.tenantId,
      action: 'REGISTRATION_STATUS_CHANGED',
      entityType: 'Registration',
      entityId: input.registrationId,
      actorId: input.staff.id,
      actorEmail: input.staff.email,
      actorRole: input.staff.role,
      actorType: 'STAFF',
      before: { status: change.from },
      after: { status: change.to, reason: input.reason },
    });

    return { id: input.registrationId, status: change.to };
  }
}
