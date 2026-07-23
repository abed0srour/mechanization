import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { SubmitRegistration } from '@mechanization/shared-schemas';
import { ConflictError } from '../../shared-kernel/domain/errors';
import { generateReferenceNumber } from '../../shared-kernel/domain/reference-number';
import { ResolveTenantUseCase } from '../../tenant/application/resolve-tenant.use-case';
import { PropertyEntry } from '../domain/property-entry.entity';
import {
  REGISTRATION_REPOSITORY,
  RegistrationRepository,
} from '../domain/registration.repository';

@Injectable()
export class SubmitRegistrationUseCase {
  constructor(
    @Inject(REGISTRATION_REPOSITORY) private readonly registrations: RegistrationRepository,
    private readonly resolveTenant: ResolveTenantUseCase,
    private readonly events: EventEmitter2,
  ) {}

  async execute(input: {
    tenantSlug: string;
    tenantId: string;
    payload: SubmitRegistration;
  }) {
    const tenant = await this.resolveTenant.bySlug(input.tenantSlug);

    // Domain objects validate the taxonomy a second time — the Zod pipe guards
    // the wire format, these guard the business rules.
    const properties = input.payload.properties.map((entry) =>
      PropertyEntry.create(entry as never),
    );

    for (const property of properties) {
      if (!tenant.allowsPropertyType((property.props as { propertyType: string }).propertyType)) {
        throw new ConflictError(
          `This municipality does not currently accept ${
            (property.props as { propertyType: string }).propertyType
          } registrations`,
        );
      }
    }

    const citizenReference = generateReferenceNumber(tenant.referencePrefix);
    const registrationReference = generateReferenceNumber(tenant.referencePrefix);

    const result = await this.registrations.submit({
      tenantId: input.tenantId,
      citizen: {
        phone: input.payload.contact.phone,
        whatsapp: input.payload.contact.whatsapp ?? input.payload.contact.phone,
        firstName: input.payload.personal.firstName,
        middleName: input.payload.personal.middleName || undefined,
        lastName: input.payload.personal.lastName,
        gender: input.payload.personal.gender,
        nationality: input.payload.personal.nationality,
        isLebanese: input.payload.personal.isLebanese,
        residencyNumber: input.payload.personal.residencyNumber || undefined,
        residentStatus: input.payload.personal.residentStatus,
        identityDocType: input.payload.personal.identityDocType,
        identityDocNumber: input.payload.personal.identityDocNumber,
        civilRecordNumber: input.payload.personal.civilRecordNumber,
        familySize: input.payload.contact.familySize,
      },
      citizenReference,
      registrationReference,
      properties,
    });

    this.events.emit('audit.record', {
      tenantId: input.tenantId,
      action: 'REGISTRATION_SUBMITTED',
      entityType: 'Registration',
      entityId: result.registrationId,
      actorType: 'CITIZEN',
      actorId: result.citizenId,
      after: {
        propertyCount: properties.length,
        referenceNumber: result.referenceNumber,
      },
    });

    return {
      registrationId: result.registrationId,
      citizenId: result.citizenId,
      referenceNumber: result.referenceNumber,
      status: 'PENDING' as const,
      propertyCount: properties.length,
    };
  }
}
