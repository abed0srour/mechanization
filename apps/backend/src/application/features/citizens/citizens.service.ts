import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AdminCreateCitizen, AdminUpdateCitizen } from '@mechanization/shared-schemas';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { withConnectionRetry } from '../../../infrastructure/prisma/with-connection-retry';
import { Prisma } from '../../../generated/tenant-client';
import { PropertyEntry, PropertyType } from '../../../domain/entities/property-entry.entity';
import { ReferenceNumber } from '../../../domain/value-objects/reference-number.vo';
import { PARCEL_REPOSITORY } from '../../../domain/interfaces/base-repository.interface';
import type { ParcelRepository } from '../../../domain/interfaces/parcel-repository.interface';
import { ConflictError, NotFoundError, ValidationError } from '../../common/exceptions';
import { RegistrationService } from '../registration/registration.service';
import { TenantService } from '../tenant/tenant.service';

/** A page of the registry beyond this is a report, not a screen. */
const MAX_LIST_ROWS = 500;

/**
 * One row of the staff citizens registry.
 *
 * Deliberately flat and pre-aggregated: this is what a table renders, so the
 * money columns arrive as totals rather than as an invoice array the browser
 * would have to sum per row — which is the version that quietly becomes an
 * N+1 the first time someone adds a filter.
 */
export interface CitizenListItem {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  referenceNumber: string | null;
  identityDocType: string | null;
  identityDocNumber: string | null;
  residentStatus: string | null;
  isActive: boolean;
  registeredAt: string;

  registrationCount: number;
  propertyCount: number;
  /** Status of the most recent registration, or null for a citizen with none. */
  latestStatus: string | null;
  latestSubmittedAt: string | null;

  /** Everything ever billed to this citizen. */
  feesTotal: number;
  paidTotal: number;
  /** Billed and not yet confirmed paid — includes claims awaiting a clerk. */
  outstandingTotal: number;
  /**
   * The slice of `outstandingTotal` whose due date has passed — المتأخرات.
   *
   * Derived from `dueDate < now()` at read time for the same reason
   * `FeesService` derives the OVERDUE status that way: a stored flag is wrong
   * for every hour between a due date passing and a job next running. This
   * system charges no penalty on top, so a late fee *is* the unpaid fee — it
   * is reported separately here because "owes 400,000" and "owes 400,000, all
   * of it late" are different conversations at the counter.
   */
  overdueTotal: number;
  overdueCount: number;
  pendingReviewCount: number;
}

/** A shape the raw list query returns, before ISO/Number normalisation. */
interface CitizenListRow {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  phone: string | null;
  whatsapp: string | null;
  referenceNumber: string | null;
  identityDocType: string | null;
  identityDocNumber: string | null;
  residentStatus: string | null;
  isActive: boolean;
  createdAt: Date;
  registrationCount: number;
  propertyCount: number;
  latestStatus: string | null;
  latestSubmittedAt: Date | null;
  feesTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  overdueTotal: number;
  overdueCount: number;
  pendingReviewCount: number;
  total: number;
}

/**
 * Staff-side management of the citizen registry.
 *
 * The public wizard is gone from the landing page — a municipality clerk now
 * enters registrations from whatever the citizen brought to the counter — so
 * this is where creating a citizen lives. Creation deliberately delegates to
 * `RegistrationService.submit` rather than writing its own rows: the cadastre
 * lookup that turns رقم العقار into coordinates, the tenant's enabled property
 * types, the aggregate's own taxonomy checks and the `registration.submitted`
 * event (which is what invalidates the dashboard cache and writes the audit
 * entry) all hang off that one path. A second write path would be a second set
 * of those guarantees to keep in step, and the first one to drift silently.
 */
@Injectable()
export class CitizensService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly registrations: RegistrationService,
    private readonly tenants: TenantService,
    @Inject(PARCEL_REPOSITORY) private readonly parcels: ParcelRepository,
    private readonly events: EventEmitter2,
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  // ──────────────────────────────  Read  ──────────────────────────────

  /**
   * The registry table: every citizen with their registration summary and
   * their standing with the municipality's fees.
   *
   * One query with scalar subqueries rather than a `findMany` plus a
   * `groupBy` per money column — same reasoning as
   * `ReportingService.computeDashboardCounters`: against a pooler holding a
   * single connection per tenant schema, parallel queries contend with each
   * other, and this page opens with all of them at once.
   */
  async list(filter: { search?: string; limit?: number; offset?: number } = {}): Promise<{
    items: CitizenListItem[];
    total: number;
  }> {
    const limit = Math.min(filter.limit ?? 100, MAX_LIST_ROWS);
    const offset = Math.max(filter.offset ?? 0, 0);
    const search = filter.search?.trim();

    // `%` and `_` in a citizen's own search term are literals, not wildcards.
    const pattern = search ? `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;

    const searchFilter = pattern
      ? Prisma.sql`AND (
          (u."firstName" || ' ' || COALESCE(u."middleName" || ' ', '') || u."lastName") ILIKE ${pattern}
          OR u.phone ILIKE ${pattern}
          OR u."referenceNumber" ILIKE ${pattern}
          OR u."identityDocNumber" ILIKE ${pattern}
        )`
      : Prisma.empty;

    const rows = await withConnectionRetry(() =>
      this.db.$queryRaw<CitizenListRow[]>`
        SELECT
          u.id,
          u."firstName",
          u."middleName",
          u."lastName",
          u.phone,
          u.whatsapp,
          u."referenceNumber",
          u."identityDocType"::text  AS "identityDocType",
          u."identityDocNumber",
          u."residentStatus"::text   AS "residentStatus",
          u."isActive",
          u."createdAt",
          (SELECT count(*)::int FROM registrations r WHERE r."citizenId" = u.id)
            AS "registrationCount",
          (SELECT count(*)::int
             FROM property_entries pe
             JOIN registrations r ON r.id = pe."registrationId"
            WHERE r."citizenId" = u.id)
            AS "propertyCount",
          (SELECT r.status::text FROM registrations r
            WHERE r."citizenId" = u.id ORDER BY r."submittedAt" DESC LIMIT 1)
            AS "latestStatus",
          (SELECT r."submittedAt" FROM registrations r
            WHERE r."citizenId" = u.id ORDER BY r."submittedAt" DESC LIMIT 1)
            AS "latestSubmittedAt",
          COALESCE((SELECT sum(p.amount) FROM citizen_payments p
                     WHERE p."citizenId" = u.id), 0)::float8
            AS "feesTotal",
          COALESCE((SELECT sum(p.amount) FROM citizen_payments p
                     WHERE p."citizenId" = u.id AND p."paymentStatus" = 'PAID'), 0)::float8
            AS "paidTotal",
          COALESCE((SELECT sum(p.amount) FROM citizen_payments p
                     WHERE p."citizenId" = u.id AND p."paymentStatus" <> 'PAID'), 0)::float8
            AS "outstandingTotal",
          COALESCE((SELECT sum(p.amount) FROM citizen_payments p
                     WHERE p."citizenId" = u.id
                       AND p."paymentStatus" = 'UNPAID'
                       AND p."dueDate" < now()), 0)::float8
            AS "overdueTotal",
          (SELECT count(*)::int FROM citizen_payments p
            WHERE p."citizenId" = u.id
              AND p."paymentStatus" = 'UNPAID'
              AND p."dueDate" < now())
            AS "overdueCount",
          (SELECT count(*)::int FROM citizen_payments p
            WHERE p."citizenId" = u.id AND p."paymentStatus" = 'PENDING_REVIEW')
            AS "pendingReviewCount",
          count(*) OVER()::int AS total
        FROM users u
        WHERE u.kind = 'CITIZEN'
        ${searchFilter}
        ORDER BY u."createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        fullName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' '),
        phone: row.phone,
        whatsapp: row.whatsapp,
        referenceNumber: row.referenceNumber,
        identityDocType: row.identityDocType,
        identityDocNumber: row.identityDocNumber,
        residentStatus: row.residentStatus,
        isActive: row.isActive,
        registeredAt: row.createdAt.toISOString(),
        registrationCount: row.registrationCount,
        propertyCount: row.propertyCount,
        latestStatus: row.latestStatus,
        latestSubmittedAt: row.latestSubmittedAt?.toISOString() ?? null,
        feesTotal: row.feesTotal,
        paidTotal: row.paidTotal,
        outstandingTotal: row.outstandingTotal,
        overdueTotal: row.overdueTotal,
        overdueCount: row.overdueCount,
        pendingReviewCount: row.pendingReviewCount,
      })),
      total: rows[0]?.total ?? 0,
    };
  }

  /**
   * The citizen's record shaped back into the form that edits it.
   *
   * Returns exactly the three sections `adminUpdateCitizenSchema` expects, so
   * the edit page can load and post the same object. Only the *latest*
   * registration's properties are included — see `update` for why that is the
   * one the form owns.
   */
  async getEditable(citizenId: string) {
    const citizen = await withConnectionRetry(() =>
      this.db.user.findFirst({
        where: { id: citizenId, kind: 'CITIZEN' },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          gender: true,
          nationality: true,
          isLebanese: true,
          residencyNumber: true,
          residentStatus: true,
          identityDocType: true,
          identityDocNumber: true,
          civilRecordNumber: true,
          phone: true,
          whatsapp: true,
          maritalStatus: true,
          familySize: true,
          registrations: {
            orderBy: { submittedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              referenceNumber: true,
              status: true,
              properties: {
                orderBy: { createdAt: 'asc' },
                include: { units: { orderBy: { createdAt: 'asc' } } },
              },
            },
          },
        },
      }),
    );

    if (!citizen) throw new NotFoundError('Citizen', citizenId);

    const registration = citizen.registrations[0] ?? null;

    return {
      id: citizen.id,
      registrationId: registration?.id ?? null,
      referenceNumber: registration?.referenceNumber ?? null,
      status: registration?.status ?? null,
      personal: {
        firstName: citizen.firstName,
        middleName: citizen.middleName ?? '',
        lastName: citizen.lastName,
        gender: citizen.gender,
        nationality: citizen.nationality,
        isLebanese: citizen.isLebanese,
        residencyNumber: citizen.residencyNumber ?? '',
        residentStatus: citizen.residentStatus,
        identityDocType: citizen.identityDocType,
        identityDocNumber: citizen.identityDocNumber ?? '',
        civilRecordNumber: citizen.civilRecordNumber ?? '',
      },
      contact: {
        phone: citizen.phone,
        whatsapp: citizen.whatsapp,
        // The stored pair is what it is; the form re-derives its own checkbox
        // from whether the two numbers currently match.
        whatsappSameAsPhone: citizen.whatsapp === citizen.phone,
        maritalStatus: citizen.maritalStatus,
        familySize: citizen.familySize,
      },
      properties: (registration?.properties ?? []).map((property) => ({
        id: property.id,
        occupancyType: property.occupancyType,
        landlordName: property.landlordName,
        landlordPhone: property.landlordPhone,
        propertyType: property.propertyType,
        neighborhood: property.neighborhood,
        propertyNumber: property.propertyNumber,
        landType: property.landType,
        buildingName: property.buildingName,
        side: property.side,
        tentLocation: property.tentLocation,
        // Decimal → number at the edge, as everywhere else in this codebase.
        unitArea: property.unitArea == null ? null : Number(property.unitArea),
        sharedRights: property.sharedRights,
        units: property.units.map((unit) => ({
          id: unit.id,
          unitType: unit.unitType,
          floor: unit.floor,
          side: unit.side,
          unitArea: Number(unit.unitArea),
          sharedRights: unit.sharedRights,
        })),
      })),
    };
  }

  // ──────────────────────────────  Write  ──────────────────────────────

  /**
   * A clerk filing a citizen and their first registration.
   *
   * The claim lands as PENDING, exactly as a citizen-filed one did: a clerk
   * typing what someone handed over the counter has not thereby verified it,
   * and skipping the review queue would hide staff-entered claims from the
   * only screen that checks them.
   */
  async create(input: {
    tenantSlug: string;
    payload: AdminCreateCitizen;
    actor: { id: string; role: string };
  }) {
    const result = await this.registrations.submit({
      tenantSlug: input.tenantSlug,
      // `documentSlots` and `declarationAccepted` belong to the citizen-facing
      // wizard; the submit path reads neither, and the schema that requires
      // them is not the one that validated this payload.
      payload: {
        personal: input.payload.personal,
        contact: input.payload.contact,
        properties: input.payload.properties,
        documentSlots: [],
        declarationAccepted: true,
      } as never,
    });

    this.events.emit('citizen.changed', {
      tenantSlug: input.tenantSlug,
      citizenId: result.citizenId,
      action: 'CITIZEN_CREATED',
      after: {
        referenceNumber: result.referenceNumber,
        propertyCount: result.propertyCount,
      },
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return {
      citizenId: result.citizenId,
      registrationId: result.registrationId,
      referenceNumber: result.referenceNumber,
      propertyCount: result.propertyCount,
    };
  }

  /**
   * A clerk correcting a citizen already on file.
   *
   * Properties are reconciled against the citizen's **latest** registration
   * only. A citizen may hold several — someone who came back a year later with
   * a second building — and each is a separate claim with its own review state
   * and its own attached deeds; letting one form silently rewrite all of them
   * would mean a typo fix on a name could reopen a claim approved months ago.
   * The earlier registrations stay visible, and editable through their own
   * review screen, on the citizen's profile page.
   *
   * A property present in the database and absent from the payload is deleted,
   * and its attached documents go with it (`Document.propertyEntryId` cascades)
   * — the UI says so before it lets the row be removed.
   */
  async update(input: {
    tenantSlug: string;
    citizenId: string;
    payload: AdminUpdateCitizen;
    actor: { id: string; role: string };
  }) {
    const tenant = await this.tenants.resolve(input.tenantSlug);

    const citizen = await this.db.user.findFirst({
      where: { id: input.citizenId, kind: 'CITIZEN' },
      select: {
        id: true,
        referenceNumber: true,
        registrations: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { id: true, properties: { select: { id: true } } },
        },
      },
    });
    if (!citizen) throw new NotFoundError('Citizen', input.citizenId);

    // Same construction the submit path performs: the taxonomy rules live in
    // the aggregate, so an edit gets the identical guarantees a submission did.
    const cadastre = await this.resolveParcels(
      input.payload.properties.map((property) => property.propertyNumber),
    );

    const entries = input.payload.properties.map((property) => {
      const { id, ...values } = property as { id?: string } & Record<string, unknown>;
      const parcel = cadastre.get(String(values.propertyNumber).trim());
      return {
        id,
        entry: PropertyEntry.create({
          ...values,
          latitude: parcel?.latitude ?? null,
          longitude: parcel?.longitude ?? null,
        } as never),
      };
    });

    for (const { entry } of entries) {
      if (!tenant.allowsPropertyType(entry.props.propertyType as PropertyType)) {
        throw new ConflictError(
          `هذه البلدية لا تستقبل حالياً تسجيل هذا النوع من العقارات (${entry.props.propertyType})`,
        );
      }
    }

    const existing = citizen.registrations[0];
    const existingIds = new Set(existing?.properties.map((property) => property.id) ?? []);

    // An id from another citizen's claim must not be steered into this one.
    // Checked before anything is written, so a crafted payload fails whole.
    for (const { id } of entries) {
      if (id && !existingIds.has(id)) {
        throw new ValidationError('هذا العقار لا ينتمي إلى آخر طلب لهذا المواطن', {
          propertyId: id,
        });
      }
    }

    const keptIds = new Set(entries.map(({ id }) => id).filter(Boolean) as string[]);
    const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: citizen.id },
        data: {
          firstName: input.payload.personal.firstName,
          middleName: input.payload.personal.middleName || null,
          lastName: input.payload.personal.lastName,
          gender: input.payload.personal.gender as never,
          nationality: input.payload.personal.nationality,
          isLebanese: input.payload.personal.isLebanese,
          residencyNumber: input.payload.personal.residencyNumber || null,
          residentStatus: input.payload.personal.residentStatus as never,
          identityDocType: input.payload.personal.identityDocType as never,
          identityDocNumber:
            input.payload.personal.identityDocNumber ||
            input.payload.personal.residencyNumber ||
            '',
          civilRecordNumber: input.payload.personal.civilRecordNumber || null,
          phone: input.payload.contact.phone,
          whatsapp: input.payload.contact.whatsapp ?? input.payload.contact.phone,
          maritalStatus: input.payload.contact.maritalStatus as never,
          familySize: input.payload.contact.familySize,
        },
      });

      // A citizen with no registration at all (never expected from this form,
      // but reachable if their only claim was deleted) gets one rather than
      // silently dropping the properties they just typed.
      const registrationId =
        existing?.id ??
        (
          await tx.registration.create({
            data: {
              citizenId: citizen.id,
              referenceNumber: ReferenceNumber.generate(tenant.referencePrefix).value,
              status: 'PENDING',
            },
            select: { id: true },
          })
        ).id;

      if (removedIds.length > 0) {
        await tx.propertyEntry.deleteMany({
          where: { id: { in: removedIds }, registrationId },
        });
      }

      for (const { id, entry } of entries) {
        const p = entry.props;
        const data = {
          occupancyType: p.occupancyType as never,
          landlordName: p.landlordName ?? null,
          landlordPhone: p.landlordPhone ?? null,
          propertyType: p.propertyType as never,
          neighborhood: p.neighborhood,
          propertyNumber: p.propertyNumber,
          unitType: (p.unitType ?? null) as never,
          landType: (p.landType ?? null) as never,
          buildingName: p.buildingName ?? null,
          floor: p.floor ?? null,
          side: p.side ?? null,
          tentLocation: p.tentLocation ?? null,
          unitArea: p.unitArea ?? null,
          sharedRights: p.sharedRights ?? [],
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
        };

        const units = (p.units ?? []).map((unit) => ({
          unitType: unit.unitType as never,
          floor: unit.floor,
          side: unit.side ?? null,
          unitArea: unit.unitArea,
          sharedRights: unit.sharedRights ?? [],
        }));

        if (id) {
          await tx.propertyEntry.update({
            where: { id },
            data: {
              ...data,
              // Units are replaced wholesale rather than reconciled one by one.
              // They carry no documents and no id anyone outside this record
              // holds, so identity buys nothing here — unlike the property row
              // above, whose id a deed is attached to.
              units: { deleteMany: {}, create: units },
            },
          });
        } else {
          await tx.propertyEntry.create({
            data: { registrationId, ...data, units: { create: units } },
          });
        }
      }
    });

    this.events.emit('citizen.changed', {
      tenantSlug: input.tenantSlug,
      citizenId: citizen.id,
      action: 'CITIZEN_UPDATED',
      after: {
        propertyCount: entries.length,
        propertiesRemoved: removedIds.length,
      },
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { updated: true, citizenId: citizen.id };
  }

  /**
   * Erases a citizen and everything hanging off them — registrations,
   * properties, units, documents rows and invoices, all by cascade.
   *
   * Refused while any money has actually changed hands. A PAID invoice is the
   * municipality's own record of a receipt it issued, and deleting the person
   * would delete the only row saying the payment happened; whoever wants the
   * citizen gone can wait for the ledger to be reconciled, or deactivate them
   * instead. Unpaid and rejected-claim rows carry no such record and go.
   */
  async remove(input: {
    tenantSlug: string;
    citizenId: string;
    actor: { id: string; role: string };
  }) {
    const citizen = await this.db.user.findFirst({
      where: { id: input.citizenId, kind: 'CITIZEN' },
      select: { id: true, firstName: true, lastName: true, referenceNumber: true },
    });
    if (!citizen) throw new NotFoundError('Citizen', input.citizenId);

    const settled = await this.db.citizenPayment.count({
      where: { citizenId: citizen.id, paymentStatus: 'PAID' },
    });
    if (settled > 0) {
      throw new ConflictError(
        `لا يمكن حذف مواطن لديه ${settled} دفعة مسدّدة — سجل المدفوعات يعود للبلدية. يمكنك تعطيل الحساب بدلاً من ذلك.`,
      );
    }

    await this.db.user.delete({ where: { id: citizen.id } });

    this.events.emit('citizen.changed', {
      tenantSlug: input.tenantSlug,
      citizenId: citizen.id,
      action: 'CITIZEN_DELETED',
      before: {
        name: `${citizen.firstName} ${citizen.lastName}`,
        referenceNumber: citizen.referenceNumber,
      },
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { deleted: true };
  }

  /** Soft delete and its undo — the reversible half of `remove`. */
  async setActive(input: {
    tenantSlug: string;
    citizenId: string;
    isActive: boolean;
    actor: { id: string; role: string };
  }) {
    const citizen = await this.db.user.findFirst({
      where: { id: input.citizenId, kind: 'CITIZEN' },
      select: { id: true },
    });
    if (!citizen) throw new NotFoundError('Citizen', input.citizenId);

    await this.db.user.update({
      where: { id: citizen.id },
      data: { isActive: input.isActive },
    });

    this.events.emit('citizen.changed', {
      tenantSlug: input.tenantSlug,
      citizenId: citizen.id,
      action: input.isActive ? 'CITIZEN_REACTIVATED' : 'CITIZEN_DEACTIVATED',
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });

    return { isActive: input.isActive };
  }

  /**
   * The same cadastre resolution the submission path performs — a رقم العقار
   * either exists in this municipality's registry or the edit is a typo, and a
   * municipality with no cadastre imported keeps the permissive behaviour.
   */
  private async resolveParcels(propertyNumbers: readonly string[]) {
    const found = await this.parcels.findManyByNumber(propertyNumbers);

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
}
