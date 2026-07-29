/**
 * Administrative sectors (قطاع) the municipality draws over its own cadastre.
 * Like every other port here it takes no tenant argument — the implementation
 * reads the tenant-scoped client out of the request scope.
 */

export interface Zone {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string | null;
  parcelNumbers: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** A parcel number already spoken for, and the zone holding it. */
export interface ZoneParcelOwner {
  parcelNumber: string;
  zoneId: string;
  zoneName: string;
}

export interface ZoneRepository {
  findAll(): Promise<Zone[]>;

  findById(id: string): Promise<Zone | null>;

  findByCode(code: string): Promise<Zone | null>;

  /**
   * Which of these parcel numbers already belong to a zone.
   *
   * `excludeZoneId` skips the zone being edited, so re-saving a zone with the
   * parcels it already owns is not reported as a conflict with itself.
   */
  findOwnersOfParcels(
    parcelNumbers: readonly string[],
    excludeZoneId?: string,
  ): Promise<ZoneParcelOwner[]>;

  create(input: {
    name: string;
    code: string;
    color: string;
    description?: string;
    parcelNumbers: string[];
  }): Promise<Zone>;

  update(
    id: string,
    input: {
      name?: string;
      code?: string;
      color?: string;
      description?: string | null;
      parcelNumbers?: string[];
    },
  ): Promise<Zone>;

  delete(id: string): Promise<void>;
}
