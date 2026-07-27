import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';

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

export interface CitizenProfileRegistration {
  id: string;
  referenceNumber: string;
  status: string;
  submittedAt: string;
  properties: CitizenProfileProperty[];
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
 * v1 planned Redis-cached projections here. These are `groupBy` aggregates over
 * a table with thousands of rows per municipality — Postgres answers them in
 * single-digit milliseconds, and a cache would have added invalidation logic to
 * maintain in exchange for nothing measurable. If a query here ever does show up
 * slow, the first move is a materialized view (one statement, no new service),
 * not a cache layer.
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
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  async getDashboardCounters(): Promise<DashboardCounters> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000);

    const [total, byStatus, byPropertyType, byResidentStatus, recent] = await Promise.all([
      this.db.registration.count(),
      this.db.registration.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.propertyEntry.groupBy({ by: ['propertyType'], _count: { _all: true } }),
      this.db.user.groupBy({
        by: ['residentStatus'],
        where: { kind: 'CITIZEN' },
        _count: { _all: true },
      }),
      this.db.registration.count({ where: { submittedAt: { gte: sevenDaysAgo } } }),
    ]);

    const tally = (rows: Array<Record<string, unknown>>, key: string): Record<string, number> =>
      Object.fromEntries(
        rows
          .filter((row) => row[key] != null)
          .map((row) => [
            String(row[key]),
            (row._count as { _all: number })._all,
          ]),
      );

    return {
      total,
      byStatus: tally(byStatus as never, 'status'),
      byPropertyType: tally(byPropertyType as never, 'propertyType'),
      byResidentStatus: tally(byResidentStatus as never, 'residentStatus'),
      submittedLast7Days: recent,
    };
  }

  /**
   * Points for the admin map. Returns plain coordinates rather than GeoJSON
   * because the frontend uses MapLibre markers directly — v2 dropped deck.gl,
   * whose WebGL layer pipeline bought nothing at a few hundred points and cost
   * bundle size on exactly the low-end Android devices this project targets.
   */
  async getSpatialData(): Promise<SpatialFeature[]> {
    const rows = await this.db.propertyEntry.findMany({
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
    });

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
    const citizen = await this.db.user.findFirst({
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
          },
        },
      },
    });

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
    const rows = await this.db.propertyEntry.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      select: {
        propertyNumber: true,
        propertyType: true,
        occupancyType: true,
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
    });

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
