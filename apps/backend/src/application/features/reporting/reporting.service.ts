import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { withConnectionRetry } from '../../../infrastructure/prisma/with-connection-retry';

export interface DashboardCounters {
  total: number;
  byStatus: Record<string, number>;
  byPropertyType: Record<string, number>;
  byResidentStatus: Record<string, number>;
  submittedLast7Days: number;
}

export interface SpatialFeature {
  id: string;
  propertyNumber: string;
  propertyType: string;
  status: string;
  latitude: number;
  longitude: number;
}

/** One citizen registered against a parcel, as the staff map drawer shows them. */
export interface ParcelRegistrant {
  citizenId: string;
  registrationId: string;
  fullName: string;
  phone: string | null;
  /** مالك / مستأجر — the closest thing to a "role" this domain has. */
  occupancyType: string;
  propertyType: string;
  /** Which building this registrant's unit sits in — a parcel can carry more
   * than one, so this is what actually distinguishes them in the drawer. */
  buildingName: string | null;
  status: string;
  registeredAt: string;
  /** Units inside this citizen's slice of the building, if any. */
  unitCount: number;
}

/**
 * A parcel that has at least one registration, with everyone attached to it.
 *
 * Only registered parcels appear. The map draws all ~1,800 cadastral parcels
 * from a static GeoJSON underneath; an interactive marker is reserved for the
 * handful that actually have citizen data, so a dot on the map always means
 * "there is something to open here".
 */
export interface RegisteredParcel {
  propertyNumber: string;
  latitude: number;
  longitude: number;
  registrants: ParcelRegistrant[];
}

export interface CitizenProfileProperty {
  id: string;
  neighborhood: string;
  propertyNumber: string;
  propertyType: string;
  occupancyType: string;
  buildingName: string | null;
  unitArea: number | null;
  latitude: number | null;
  longitude: number | null;
  unitCount: number;
}

export interface CitizenProfileDocument {
  id: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  propertyEntryId: string | null;
  createdAt: string;
}

export interface CitizenProfileRegistration {
  id: string;
  referenceNumber: string;
  status: string;
  submittedAt: string;
  properties: CitizenProfileProperty[];
  documents: CitizenProfileDocument[];
}

/** The staff-facing view of one citizen and everything they have filed. */
export interface CitizenProfile {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  gender: string | null;
  nationality: string | null;
  isLebanese: boolean | null;
  residencyNumber: string | null;
  residentStatus: string | null;
  identityDocType: string | null;
  identityDocNumber: string | null;
  civilRecordNumber: string | null;
  familySize: number | null;
  maritalStatus: string | null;
  referenceNumber: string | null;
  registeredAt: string;
  registrations: CitizenProfileRegistration[];
}

/**
 * Read side of the dashboard.
 *
 * These are `groupBy` aggregates and multi-table reads over tables with
 * thousands of rows per municipality, which Postgres alone answers in
 * single-digit milliseconds — but admins hit `counters`, `map`, `map/parcels`
 * and a citizen's profile repeatedly (dashboard polling, re-opening the same
 * map drawer, a citizen page revisited mid-review), so a short-lived cache
 * still cuts real load even though no single query is slow. `RedisCacheService`
 * degrades to a no-op when `REDIS_URL` is unset, so this is additive rather
 * than a hard dependency.
 *
 * This service reads the tenant client directly rather than going through a
 * repository port: these are reporting projections with no domain invariants to
 * enforce, and routing them through an entity-shaped port would mean mapping
 * rows into aggregates only to count them.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly events: EventEmitter2,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  private get cacheTtlSeconds(): number {
    return this.config.get<number>('DASHBOARD_CACHE_TTL_SECONDS') ?? 60;
  }

  /** Namespaced per tenant so one municipality's cache entries can be
   * invalidated, or simply expire, without touching any other's. */
  private cacheKey(name: string): string {
    return `dashboard:${this.tenantContext.tenantSlug}:${name}`;
  }

  async getDashboardCounters(): Promise<DashboardCounters> {
    const key = this.cacheKey('counters');
    const cached = await this.cache.get<DashboardCounters>(key);
    if (cached) return cached;

    const counters = await this.computeDashboardCounters();
    await this.cache.set(key, counters, this.cacheTtlSeconds);
    return counters;
  }

  /**
   * One round trip instead of five separate queries across three tables. The
   * five used to run via `Promise.all`, which — against a pooler with
   * `connection_limit=1` — meant five queries briefly fighting over one
   * connection on every cache miss; combining them into a single query with
   * scalar subqueries removes that contention entirely rather than just
   * widening the pool to tolerate it.
   */
  private async computeDashboardCounters(): Promise<DashboardCounters> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000);

    const [row] = await withConnectionRetry(() =>
      this.db.$queryRaw<
        Array<{
          total: number;
          recent: number;
          byStatus: Record<string, number>;
          byPropertyType: Record<string, number>;
          byResidentStatus: Record<string, number>;
        }>
      >`
        SELECT
          (SELECT count(*)::int FROM registrations) AS total,
          (SELECT count(*)::int FROM registrations WHERE "submittedAt" >= ${sevenDaysAgo}) AS recent,
          (SELECT COALESCE(json_object_agg(status, cnt), '{}'::json)
             FROM (SELECT status, count(*)::int AS cnt FROM registrations GROUP BY status) s
          ) AS "byStatus",
          (SELECT COALESCE(json_object_agg("propertyType", cnt), '{}'::json)
             FROM (SELECT "propertyType", count(*)::int AS cnt FROM property_entries GROUP BY "propertyType") p
          ) AS "byPropertyType",
          (SELECT COALESCE(json_object_agg("residentStatus", cnt), '{}'::json)
             FROM (
               SELECT "residentStatus", count(*)::int AS cnt FROM users
               WHERE kind = 'CITIZEN' AND "residentStatus" IS NOT NULL
               GROUP BY "residentStatus"
             ) u
          ) AS "byResidentStatus"
      `,
    );

    return {
      total: row.total,
      byStatus: row.byStatus,
      byPropertyType: row.byPropertyType,
      byResidentStatus: row.byResidentStatus,
      submittedLast7Days: row.recent,
    };
  }

  /**
   * Points for the admin map. Returns plain coordinates rather than GeoJSON
   * because the frontend uses MapLibre markers directly — v2 dropped deck.gl,
   * whose WebGL layer pipeline bought nothing at a few hundred points and cost
   * bundle size on exactly the low-end Android devices this project targets.
   */
  async getSpatialData(): Promise<SpatialFeature[]> {
    const key = this.cacheKey('map');
    const cached = await this.cache.get<SpatialFeature[]>(key);
    if (cached) return cached;

    const features = await this.computeSpatialData();
    await this.cache.set(key, features, this.cacheTtlSeconds);
    return features;
  }

  private async computeSpatialData(): Promise<SpatialFeature[]> {
    const rows = await withConnectionRetry(() =>
      this.db.propertyEntry.findMany({
        where: { latitude: { not: null }, longitude: { not: null } },
        select: {
          id: true,
          propertyNumber: true,
          propertyType: true,
          latitude: true,
          longitude: true,
          registration: { select: { status: true } },
        },
        // A municipality that somehow has more than this has a data problem, and
        // a map with 5k markers is unusable anyway.
        take: 5000,
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      propertyNumber: row.propertyNumber,
      propertyType: row.propertyType,
      status: row.registration.status,
      latitude: row.latitude!,
      longitude: row.longitude!,
    }));
  }

  /**
   * Everything staff see on one citizen's page: who they are, and every
   * property they have filed.
   *
   * Returns null rather than throwing so the controller decides the HTTP shape
   * — this layer has no opinion about 404s.
   */
  async getCitizenProfile(citizenId: string): Promise<CitizenProfile | null> {
    const key = this.cacheKey(`citizen:${citizenId}`);
    const cached = await this.cache.get<CitizenProfile>(key);
    if (cached) return cached;

    const profile = await this.computeCitizenProfile(citizenId);
    // A missing citizen isn't cached: caching the 404 would keep serving it
    // for the TTL window even after the citizen is created moments later.
    if (profile) await this.cache.set(key, profile, this.cacheTtlSeconds);
    return profile;
  }

  private async computeCitizenProfile(citizenId: string): Promise<CitizenProfile | null> {
    const citizen = await withConnectionRetry(() => this.db.user.findFirst({
      // `kind` is part of the filter, not an afterthought: without it a staff
      // id in the URL would render a staff member through the citizen view.
      where: { id: citizenId, kind: 'CITIZEN' },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        phone: true,
        whatsapp: true,
        gender: true,
        nationality: true,
        isLebanese: true,
        residencyNumber: true,
        residentStatus: true,
        identityDocType: true,
        identityDocNumber: true,
        civilRecordNumber: true,
        familySize: true,
        maritalStatus: true,
        referenceNumber: true,
        createdAt: true,
        registrations: {
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            submittedAt: true,
            properties: {
              select: {
                id: true,
                neighborhood: true,
                propertyNumber: true,
                propertyType: true,
                occupancyType: true,
                buildingName: true,
                unitArea: true,
                latitude: true,
                longitude: true,
                _count: { select: { units: true } },
              },
            },
            // Staff previously had no way to see a citizen's uploaded proofs
            // from this page at all — the documents existed (uploaded and
            // stored correctly) but were never queried here.
            documents: {
              select: {
                id: true,
                type: true,
                mimeType: true,
                sizeBytes: true,
                propertyEntryId: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    }));

    if (!citizen) return null;

    return {
      id: citizen.id,
      fullName: [citizen.firstName, citizen.middleName, citizen.lastName]
        .filter(Boolean)
        .join(' '),
      phone: citizen.phone,
      whatsapp: citizen.whatsapp,
      gender: citizen.gender,
      nationality: citizen.nationality,
      isLebanese: citizen.isLebanese,
      residencyNumber: citizen.residencyNumber,
      residentStatus: citizen.residentStatus,
      identityDocType: citizen.identityDocType,
      identityDocNumber: citizen.identityDocNumber,
      civilRecordNumber: citizen.civilRecordNumber,
      familySize: citizen.familySize,
      maritalStatus: citizen.maritalStatus,
      referenceNumber: citizen.referenceNumber,
      registeredAt: citizen.createdAt.toISOString(),
      registrations: citizen.registrations.map((registration) => ({
        id: registration.id,
        referenceNumber: registration.referenceNumber,
        status: registration.status,
        submittedAt: registration.submittedAt.toISOString(),
        properties: registration.properties.map((property) => ({
          id: property.id,
          neighborhood: property.neighborhood,
          propertyNumber: property.propertyNumber,
          propertyType: property.propertyType,
          occupancyType: property.occupancyType,
          buildingName: property.buildingName,
          unitArea: property.unitArea == null ? null : Number(property.unitArea),
          latitude: property.latitude,
          longitude: property.longitude,
          unitCount: property._count.units,
        })),
        documents: registration.documents.map((document) => ({
          id: document.id,
          type: document.type,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          propertyEntryId: document.propertyEntryId,
          createdAt: document.createdAt.toISOString(),
        })),
      })),
    };
  }

  /**
   * Parcels that have registrations, each with every citizen attached to it.
   *
   * Grouped by رقم العقار rather than returned as a flat property list because
   * that is the unit the staff map interacts with: one dot per parcel, and
   * clicking it opens everyone on it. An apartment building is a single
   * cadastral number shared by all its residents, so the many-to-one shape
   * here is the common case and not an edge one.
   *
   * Coordinates come from the property row, which the submission path fills
   * from the cadastre — so a parcel missing them was registered before the
   * cadastre import and simply cannot be placed on a map.
   */
  async getRegisteredParcels(): Promise<RegisteredParcel[]> {
    const key = this.cacheKey('parcels');
    const cached = await this.cache.get<RegisteredParcel[]>(key);
    if (cached) return cached;

    const parcels = await this.computeRegisteredParcels();
    await this.cache.set(key, parcels, this.cacheTtlSeconds);
    return parcels;
  }

  private async computeRegisteredParcels(): Promise<RegisteredParcel[]> {
    const rows = await withConnectionRetry(() =>
      this.db.propertyEntry.findMany({
        where: { latitude: { not: null }, longitude: { not: null } },
        select: {
          propertyNumber: true,
          propertyType: true,
          occupancyType: true,
          buildingName: true,
          latitude: true,
          longitude: true,
          createdAt: true,
          _count: { select: { units: true } },
          registration: {
            select: {
              id: true,
              status: true,
              submittedAt: true,
              citizen: {
                select: {
                  id: true,
                  firstName: true,
                  middleName: true,
                  lastName: true,
                  phone: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 5000,
      }),
    );

    const byParcel = new Map<string, RegisteredParcel>();

    for (const row of rows) {
      const parcel = byParcel.get(row.propertyNumber) ?? {
        propertyNumber: row.propertyNumber,
        latitude: row.latitude!,
        longitude: row.longitude!,
        registrants: [],
      };

      parcel.registrants.push({
        citizenId: row.registration.citizen.id,
        registrationId: row.registration.id,
        fullName: [
          row.registration.citizen.firstName,
          row.registration.citizen.middleName,
          row.registration.citizen.lastName,
        ]
          .filter(Boolean)
          .join(' '),
        phone: row.registration.citizen.phone,
        occupancyType: row.occupancyType,
        propertyType: row.propertyType,
        buildingName: row.buildingName,
        status: row.registration.status,
        registeredAt: row.registration.submittedAt.toISOString(),
        unitCount: row._count.units,
      });

      byParcel.set(row.propertyNumber, parcel);
    }

    return [...byParcel.values()];
  }

  /**
   * CSV export. Emits an audit event with the row count, because this is the
   * action that turns a governed dashboard into an ungoverned spreadsheet.
   */
  async exportCsv(input: {
    tenantSlug: string;
    status?: string;
    actor: { id: string; role: string; email?: string };
  }): Promise<string> {
    const where = input.status ? { status: input.status as never } : {};

    const rows = await this.db.registration.findMany({
      where,
      include: {
        citizen: {
          select: {
            firstName: true,
            middleName: true,
            lastName: true,
            phone: true,
            residentStatus: true,
            familySize: true,
          },
        },
        properties: {
          select: {
            propertyNumber: true,
            propertyType: true,
            occupancyType: true,
            unitArea: true,
            buildingName: true,
            units: {
              select: { unitType: true, floor: true, unitArea: true },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const header = [
      'reference_number',
      'status',
      'submitted_at',
      'citizen_name',
      'phone',
      'resident_status',
      'family_size',
      'property_number',
      'property_type',
      'occupancy_type',
      'building_name',
      'unit_type',
      'floor',
      'unit_area',
    ];

    const lines = [header.join(',')];

    for (const row of rows) {
      const name = [row.citizen.firstName, row.citizen.middleName, row.citizen.lastName]
        .filter(Boolean)
        .join(' ');

      // One line per property, so a citizen with three properties produces three
      // rows — municipality staff filter by property, not by person. A building
      // goes one further and emits a line per unit: the whole point of owning
      // one is that it holds several, and a single row would report the parcel
      // while hiding everything inside it.
      const properties = row.properties.length > 0 ? row.properties : [null];

      for (const property of properties) {
        const units =
          property && property.units.length > 0
            ? property.units
            : [null];

        for (const unit of units) {
          lines.push(
            [
              row.referenceNumber,
              row.status,
              row.submittedAt.toISOString(),
              name,
              row.citizen.phone ?? '',
              row.citizen.residentStatus ?? '',
              row.citizen.familySize ?? '',
              property?.propertyNumber ?? '',
              property?.propertyType ?? '',
              property?.occupancyType ?? '',
              property?.buildingName ?? '',
              unit?.unitType ?? '',
              unit?.floor ?? '',
              // The area lives on the unit for a building and on the property
              // itself for everything else.
              (unit?.unitArea ?? property?.unitArea)?.toString() ?? '',
            ]
              .map(csvCell)
              .join(','),
          );
        }
      }
    }

    this.events.emit('report.exported', {
      tenantSlug: input.tenantSlug,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      actorEmail: input.actor.email,
      rowCount: rows.length,
      filter: { status: input.status ?? 'ALL' },
    });

    return lines.join('\n');
  }

  /**
   * Cache invalidation, event-driven like the audit trail: this service does
   * not know which feature just wrote data, only that everything under the
   * tenant's `dashboard:` namespace is now stale — counters, map parcels, and
   * RegistrationService's cached list table all share that one prefix, so a
   * single wildcard delete clears all three without a listener per cache key.
   * Listeners run inside the emitting request's tenant scope (see
   * app.module.ts), so this needs no tenant slug from the event payload.
   */
  @OnEvent('registration.submitted')
  @OnEvent('registration.status-changed')
  @OnEvent('cadastre.imported')
  async onDashboardDataChanged(): Promise<void> {
    await this.cache.invalidatePrefix(`dashboard:${this.tenantContext.tenantSlug}:`);
  }
}

/**
 * Quotes a CSV field, and neutralises formula injection.
 *
 * Arabic names are fine, but a value starting with =, +, - or @ is executed by
 * Excel when a staff member opens the export — a field a citizen controls should
 * not be able to run a formula on a municipality clerk's machine.
 */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
