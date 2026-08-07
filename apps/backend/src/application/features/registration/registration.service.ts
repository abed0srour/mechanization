import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AdminCreateCitizen } from '@mechanization/shared-schemas';
import { PropertyEntry, PropertyType } from '../../../domain/entities/property-entry.entity';
import { Registration } from '../../../domain/entities/registration.entity';
import { ReferenceNumber } from '../../../domain/value-objects/reference-number.vo';
import {
  PARCEL_REPOSITORY,
  REGISTRATION_REPOSITORY,
} from '../../../domain/interfaces/base-repository.interface';
import type { ParcelRepository } from '../../../domain/interfaces/parcel-repository.interface';
import { RegistrationRepository } from '../../../domain/interfaces/registration-repository.interface';
import { ConflictError, ValidationError } from '../../common/exceptions';
import { TenantService } from '../tenant/tenant.service';

/** How many alternative parcel numbers to offer when a number is not found. */
const SUGGESTION_LIMIT = 8;

export interface PropertyNumberCheck {
  propertyNumber: string;
  /**
   * Whether the number exists in the municipality's cadastre. `null` when the
   * municipality has not imported one, i.e. the question does not apply.
   *
   * This is the only thing on this response that can be *wrong* — everything
   * else is context.
   */
  inCadastre: boolean | null;
  location: { latitude: number; longitude: number; approximate: boolean } | null;
  /** Nearby real parcel numbers, offered only when the typed one is unknown. */
  suggestions: string[];
  /**
   * How many citizens have already registered this parcel. Reported so the
   * form can say "your neighbours are here too" — never to refuse the entry.
   * An apartment building is one cadastral number shared by everyone in it.
   */
  registeredCount: number;
}

export interface SubmitResult {
  registrationId: string;
  citizenId: string;
  referenceNumber: string;
  propertyCount: number;
  propertyIds: string[];
}

/**
 * Writing a citizen's property filing, and the cadastre lookup behind it.
 *
 * The review half of this service — `changeStatus`, `getCorrectionContext`,
 * `applyCorrection`, `listForReview` — is gone with the طلب workflow it
 * served. What is left is the write path (`submit`, still the single place a
 * citizen + registration + property rows are created, now driven by
 * `CitizensService`) and the رقم العقار check the staff entry form calls on
 * every keystroke.
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
    payload: AdminCreateCitizen;
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
        /**
         * A Lebanese citizen always has this. A non-Lebanese one is only
         * required to supply *one* of a passport number or a رقم إقامة
         * (`personalDetailsSchema`'s refine enforces that), so this falls
         * back to whichever the person actually gave — the identity lookup
         * key needs one real value either way, and the fallback never
         * triggers for a payload that passed validation.
         */
        identityDocNumber:
          input.payload.personal.identityDocNumber || input.payload.personal.residencyNumber || '',
        civilRecordNumber: input.payload.personal.civilRecordNumber || undefined,
        familySize: input.payload.contact.familySize,
        maritalStatus: input.payload.contact.maritalStatus,
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
      propertyCount: properties.length,
      propertyIds: result.propertyIds,
    };
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
   * Live check while the citizen types رقم العقار.
   *
   * Answers one question that can fail — is this a real parcel in this
   * municipality — and one that cannot: how many neighbours are already
   * registered on it. The second used to be a gate, which meant the second
   * resident of an apartment building was told their own address was taken.
   */
  async checkPropertyNumber(propertyNumber: string): Promise<PropertyNumberCheck> {
    const trimmed = propertyNumber.trim();

    const [registeredCount, parcel, cadastreSize] = await Promise.all([
      this.registrations.countRegistrationsForParcel(trimmed),
      this.parcels.findByNumber(trimmed),
      this.parcels.count(),
    ]);

    const hasCadastre = cadastreSize > 0;

    return {
      propertyNumber: trimmed,
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
      registeredCount,
    };
  }

}
