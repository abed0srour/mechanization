import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { SubmitRegistration } from '@mechanization/shared-schemas';
import { PropertyEntry, PropertyType } from '../../../domain/entities/property-entry.entity';
import { Registration, ReportStatus } from '../../../domain/entities/registration.entity';
import { ReferenceNumber } from '../../../domain/value-objects/reference-number.vo';
import {
  PARCEL_REPOSITORY,
  REGISTRATION_REPOSITORY,
} from '../../../domain/interfaces/base-repository.interface';
import type { ParcelRepository } from '../../../domain/interfaces/parcel-repository.interface';
import {
  RegistrationListItem,
  RegistrationRepository,
} from '../../../domain/interfaces/registration-repository.interface';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/exceptions';
import { TenantService } from '../tenant/tenant.service';

/** How many alternative parcel numbers to offer when a number is not found. */
const SUGGESTION_LIMIT = 8;

export interface PropertyNumberCheck {
  propertyNumber: string;
  /** Not already registered by someone else in this municipality. */
  available: boolean;
  /**
   * Whether the number exists in the municipality's cadastre. `null` when the
   * municipality has not imported one, i.e. the question does not apply.
   */
  inCadastre: boolean | null;
  location: { latitude: number; longitude: number; approximate: boolean } | null;
  /** Nearby real parcel numbers, offered only when the typed one is unknown. */
  suggestions: string[];
}

export interface SubmitResult {
  registrationId: string;
  citizenId: string;
  referenceNumber: string;
  status: ReportStatus;
  propertyCount: number;
  propertyIds: string[];
}

/**
 * One service, both reads and writes.
 *
 * v1 split this into SubmitRegistrationCommand / ChangeStatusCommand /
 * GetByIdQuery / CheckPropertyNumberQuery — four classes, four files, four
 * handler registrations for what is four methods. CQRS earns that when the read
 * and write models genuinely diverge; here they are the same tables.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(REGISTRATION_REPOSITORY) private readonly registrations: RegistrationRepository,
    @Inject(PARCEL_REPOSITORY) private readonly parcels: ParcelRepository,
    private readonly tenants: TenantService,
    private readonly events: EventEmitter2,
  ) {}

  async submit(input: {
    tenantSlug: string;
    payload: SubmitRegistration;
  }): Promise<SubmitResult> {
    const tenant = await this.tenants.resolve(input.tenantSlug);

    /**
     * Coordinates come from the municipality's cadastre, not from the citizen.
     *
     * The survey office already knows where parcel 1553 is, to better precision
     * than anyone can achieve by dragging a pin on a phone — so the wizard no
     * longer asks. رقم العقار is the location.
     */
    const cadastre = await this.resolveParcels(
      input.payload.properties.map((entry) => entry.propertyNumber),
    );

    // Zod validated the wire format at the controller. These construct domain
    // objects, which is where the taxonomy rules actually live — so a seed
    // script or a future CSV import gets the same guarantees as an HTTP request.
    const properties = input.payload.properties.map((entry) => {
      const parcel = cadastre.get(entry.propertyNumber.trim());
      return PropertyEntry.create({
        ...(entry as unknown as Record<string, unknown>),
        latitude: parcel?.latitude ?? null,
        longitude: parcel?.longitude ?? null,
      } as never);
    });

    for (const property of properties) {
      if (!tenant.allowsPropertyType(property.propertyType as PropertyType)) {
        throw new ConflictError(
          `هذه البلدية لا تستقبل حالياً تسجيل هذا النوع من العقارات (${property.propertyType})`,
        );
      }
    }

    const citizenReference = ReferenceNumber.generate(tenant.referencePrefix).value;
    const registrationReference = ReferenceNumber.generate(tenant.referencePrefix).value;

    // Constructs the aggregate — rejects an empty submission and duplicate
    // property numbers within it — and records the submitted event.
    const registration = Registration.create({
      id: 'pending',
      citizenId: 'pending',
      referenceNumber: registrationReference,
      properties,
    });

    const result = await this.registrations.submit({
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

    // Published only after the transaction committed — nothing is announced
    // that did not persist.
    registration.pullEvents();
    this.events.emit('registration.submitted', {
      tenantSlug: input.tenantSlug,
      registrationId: result.registrationId,
      citizenId: result.citizenId,
      referenceNumber: result.referenceNumber,
      propertyCount: properties.length,
    });

    return {
      registrationId: result.registrationId,
      citizenId: result.citizenId,
      referenceNumber: result.referenceNumber,
      status: 'PENDING',
      propertyCount: properties.length,
      propertyIds: result.propertyIds,
    };
  }

  /**
   * Staff transition. The legality of the move is decided by the aggregate, not
   * by whichever controller happened to call this.
   */
  async changeStatus(input: {
    tenantSlug: string;
    registrationId: string;
    status: ReportStatus;
    reason?: string;
    actor: { id: string; role: string };
  }): Promise<{ from: ReportStatus; to: ReportStatus }> {
    const registration = await this.registrations.findById(input.registrationId);
    if (!registration) {
      throw new NotFoundError('Registration', input.registrationId);
    }

    // FIELD_INSPECTOR may progress a report through review but not approve it —
    // final approval is what releases a claim, so it stays with SUPER_ADMIN.
    if (input.status === 'APPROVED' && input.actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('الموافقة النهائية تتطلب صلاحية المدير');
    }

    const transition = registration.changeStatus(input.status, input.actor, input.reason);

    await this.registrations.persistStatusChange({
      registrationId: registration.id,
      status: transition.to,
      reason: input.reason,
      reviewedById: input.actor.id,
    });

    for (const event of registration.pullEvents()) {
      this.events.emit(event.name, { ...event.payload, tenantSlug: input.tenantSlug });
    }

    return transition;
  }

  /**
   * Looks every submitted رقم العقار up in the municipality's cadastre.
   *
   * A municipality that has not imported one gets the previous behaviour — any
   * well-formed number is accepted, with no coordinates — so onboarding a tenant
   * does not have to wait on their survey office. Where a cadastre *does* exist
   * it is authoritative: a number that is not in it is a typo, and catching it
   * at submission is far cheaper than a clerk failing to find the property weeks
   * later.
   */
  private async resolveParcels(propertyNumbers: readonly string[]) {
    const found = await this.parcels.findManyByNumber(propertyNumbers);

    // Only asked when something is missing: with every number resolved there is
    // nothing for the count to decide.
    const missing = propertyNumbers
      .map((number) => number.trim())
      .filter((number) => !found.has(number));

    if (missing.length > 0 && (await this.parcels.count()) > 0) {
      throw new ValidationError(
        `رقم العقار غير موجود في سجل البلدية العقاري: ${missing.join('، ')}`,
        { propertyNumber: missing[0] },
      );
    }

    return found;
  }

  /**
   * Blur-check while the citizen types رقم العقار — now answering two questions
   * at once: is this a real parcel in this municipality, and is it still free?
   */
  async checkPropertyNumberAvailable(propertyNumber: string): Promise<PropertyNumberCheck> {
    const trimmed = propertyNumber.trim();

    const [available, parcel, cadastreSize] = await Promise.all([
      this.registrations.isPropertyNumberAvailable(trimmed),
      this.parcels.findByNumber(trimmed),
      this.parcels.count(),
    ]);

    const hasCadastre = cadastreSize > 0;

    return {
      propertyNumber: trimmed,
      available,
      inCadastre: hasCadastre ? parcel !== null : null,
      location: parcel
        ? {
            latitude: parcel.latitude,
            longitude: parcel.longitude,
            approximate: parcel.approximate,
          }
        : null,
      suggestions:
        hasCadastre && !parcel ? await this.parcels.suggest(trimmed, SUGGESTION_LIMIT) : [],
    };
  }

  async getById(id: string): Promise<Registration> {
    const registration = await this.registrations.findById(id);
    if (!registration) {
      throw new NotFoundError('Registration', id);
    }
    return registration;
  }

  /**
   * Citizen-facing lookup by رقم مرجعي. Scoped to the caller's own id so a
   * guessed reference number does not open someone else's report.
   */
  async getForCitizen(referenceNumber: string, citizenId: string): Promise<Registration> {
    const registration = await this.registrations.findByReferenceNumber(
      ReferenceNumber.parse(referenceNumber).value,
    );

    if (!registration || registration.citizenId !== citizenId) {
      // Same error either way: distinguishing "not found" from "not yours"
      // confirms which reference numbers exist.
      throw new NotFoundError('Registration');
    }

    return registration;
  }

  async listMine(citizenId: string): Promise<RegistrationListItem[]> {
    return this.registrations.listByCitizen(citizenId);
  }

  async listForReview(filter: { status?: ReportStatus; limit: number; offset: number }) {
    return this.registrations.listForReview(filter);
  }
}
