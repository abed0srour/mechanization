/**
 * The municipality's official parcel registry, imported from the survey office's
 * cadastre. Like every other port here it takes no tenant argument — the
 * implementation reads the tenant-scoped client out of the request scope.
 */

export interface ParcelLocation {
  parcelNumber: string;
  latitude: number;
  longitude: number;
  /** The survey drew this parcel as several pieces; the point is their centroid. */
  approximate: boolean;
}

export interface ParcelRepository {
  /**
   * Zero means this municipality has not imported a cadastre, which the
   * application reads as "any well-formed رقم العقار is acceptable". Making that
   * an explicit check keeps a tenant onboarding before their survey data is
   * ready from having every submission rejected.
   */
  count(): Promise<number>;

  findByNumber(parcelNumber: string): Promise<ParcelLocation | null>;

  /** Batched lookup for a submission carrying several property cards. */
  findManyByNumber(parcelNumbers: readonly string[]): Promise<Map<string, ParcelLocation>>;

  /** Nearby numbers to offer when what the citizen typed is not in the cadastre. */
  suggest(prefix: string, limit: number): Promise<string[]>;
}
