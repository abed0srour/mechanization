import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { SubmitRegistration } from '@mechanization/shared-schemas';
import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
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
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextService,
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
    /** Specific fields at fault, for the applicant's correction view. */
    rejectedFields?: string[];
    /** False routes the citizen to the counter instead of the online form. */
    allowCitizenCorrection?: boolean;
    revisitAt?: string;
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
      rejectedFields: input.rejectedFields,
      allowCitizenCorrection: input.allowCitizenCorrection,
      revisitAt: input.revisitAt,
      reviewedById: input.actor.id,
    });

    for (const event of registration.pullEvents()) {
      this.events.emit(event.name, { ...event.payload, tenantSlug: input.tenantSlug });
    }

    return transition;
  }

  /** The rejected claim as its own citizen sees it, for the correction form. */
  async getCorrectionContext(registrationId: string, citizenId: string) {
    const context = await this.registrations.findCorrectionContext({
      registrationId,
      citizenId,
    });
    if (!context) throw new NotFoundError('Registration', registrationId);
    return context;
  }

  /**
   * A citizen's corrections to their own refused claim.
   *
   * The submitted values are filtered against `rejectedFields` before anything
   * is written. That filter is the security boundary of this endpoint, not a
   * convenience: the payload arrives from a browser, so without it "fix your
   * الحي" would double as permission to rewrite an identity document number on
   * a submission a reviewer has already inspected. What was never flagged is
   * silently dropped rather than rejected — a stale form from before a partial
   * re-review should not fail wholesale.
   */
  async applyCorrection(input: {
    tenantSlug: string;
    registrationId: string;
    citizenId: string;
    personal: Record<string, unknown>;
    contact: Record<string, unknown>;
    properties: Array<{ id: string } & Record<string, unknown>>;
  }): Promise<{ from: string; to: string }> {
    const context = await this.registrations.findCorrectionContext({
      registrationId: input.registrationId,
      citizenId: input.citizenId,
    });
    if (!context) throw new NotFoundError('Registration', input.registrationId);

    // The municipality can require this claim be fixed in person — an original
    // document to inspect, an identity to confirm at the counter. Enforced
    // here and not only by hiding the form: the endpoint is reachable
    // regardless of what the page chose to render.
    if (!context.citizenCanCorrect) {
      throw new ForbiddenError('يجب مراجعة البلدية لتصحيح هذا الطلب');
    }

    const registration = await this.registrations.findById(input.registrationId);
    if (!registration) throw new NotFoundError('Registration', input.registrationId);

    const flags = new Set(context.rejectedFields);
    const allowed = <T extends Record<string, unknown>>(
      values: T,
      permittedBy: Record<string, string>,
    ): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(values).filter(
          ([key]) => permittedBy[key] && flags.has(permittedBy[key]),
        ),
      );

    const personal = allowed(input.personal, {
      firstName: 'personal.name',
      middleName: 'personal.name',
      lastName: 'personal.name',
      gender: 'personal.gender',
      nationality: 'personal.nationality',
      residentStatus: 'personal.residentStatus',
      identityDocType: 'personal.identityDocType',
      identityDocNumber: 'personal.identityDocNumber',
      civilRecordNumber: 'personal.civilRecordNumber',
      residencyNumber: 'personal.residencyNumber',
    });

    const contact = allowed(input.contact, {
      phone: 'contact.phone',
      whatsapp: 'contact.whatsapp',
      maritalStatus: 'contact.maritalStatus',
      familySize: 'contact.familySize',
    });

    const properties = input.properties
      .map(({ id, ...values }) => ({
        id,
        ...allowed(values, {
          neighborhood: 'property.neighborhood',
          propertyNumber: 'property.propertyNumber',
          buildingName: 'property.buildingName',
          unitArea: 'property.unitArea',
          landlordName: 'property.landlord',
          landlordPhone: 'property.landlord',
        }),
      }))
      .filter((property) => Object.keys(property).length > 1);

    // Refuses the resubmission unless the claim is actually REJECTED — the
    // aggregate owns that rule, not this method.
    const transition = registration.resubmit(context.rejectedFields);

    await this.registrations.applyCorrection({
      registrationId: input.registrationId,
      citizenId: input.citizenId,
      personal,
      contact,
      properties,
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

  /**
   * One registration for staff review. Throws rather than returning null —
   * callers here have no meaningful "not found" branch.
   */
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

  /**
   * A citizen's own submissions, scoped to their id rather than filtered
   * after the fact.
   */
  async listMine(citizenId: string): Promise<RegistrationListItem[]> {
    return this.registrations.listByCitizen(citizenId);
  }

  /**
   * The dashboard's main table — every registration, optionally filtered by
   * status. Cached under the same `dashboard:{tenant}:` namespace the
   * counters and map parcels use (see ReportingService), so the one
   * event-driven invalidation there clears this too without a second
   * listener to keep in sync.
   */
  async listForReview(filter: { status?: ReportStatus; limit: number; offset: number }) {
    const key = `dashboard:${this.tenantContext.tenantSlug}:list:${filter.status ?? 'ALL'}:${filter.limit}:${filter.offset}`;
    const cached = await this.cache.get<Awaited<ReturnType<RegistrationRepository['listForReview']>>>(key);
    if (cached) return cached;

    const result = await this.registrations.listForReview(filter);
    const ttl = this.config.get<number>('DASHBOARD_CACHE_TTL_SECONDS') ?? 60;
    await this.cache.set(key, result, ttl);
    return result;
  }
}
