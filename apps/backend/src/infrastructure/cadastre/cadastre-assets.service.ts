import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { APP_CONFIG } from '../../presentation/config/app.config';

/**
 * Reads the derived cadastre layers the import writes — parcel shapes and the
 * municipality outline — for the code that has to reason about them rather than
 * merely draw them.
 *
 * These are static files rather than tables (see `cadastre:import`), so this is
 * where the rest of the backend gets at them. Parsed once and held per tenant:
 * a municipality's cadastre changes on import, which is a manual act performed
 * a handful of times in a deployment's life, but the zone editor reads these
 * shapes on every save. The file's mtime is the cache key, so a re-import is
 * picked up without a restart and without a cache-invalidation event to forget
 * to emit.
 */
@Injectable()
export class CadastreAssetsService {
  private readonly logger = new Logger(CadastreAssetsService.name);
  private readonly cache = new Map<string, { mtimeMs: number; value: unknown }>();

  /** Parcel shapes by رقم العقار. Empty when the tenant has no cadastre yet. */
  getParcelPolygons(tenantSlug: string): Map<string, Feature<Polygon>> {
    const collection = this.read<FeatureCollection>(tenantSlug, 'parcel-polygons.geojson');
    if (!collection) return new Map();

    const byNumber = new Map<string, Feature<Polygon>>();
    for (const feature of collection.features) {
      const parcelNumber = feature.properties?.parcelNumber;
      if (typeof parcelNumber !== 'string' || feature.geometry?.type !== 'Polygon') continue;
      byNumber.set(parcelNumber, feature as Feature<Polygon>);
    }
    return byNumber;
  }

  /**
   * The municipality outline, or null when it has not been derived yet. Callers
   * must read null as "boundary unknown" and skip the containment check, never
   * as "nothing is inside the municipality" — the latter would reject every
   * parcel for a tenant whose cadastre predates this feature.
   */
  getCityBoundary(tenantSlug: string): Feature<Polygon> | null {
    const collection = this.read<FeatureCollection>(tenantSlug, 'city-boundary.geojson');
    const feature = collection?.features?.[0];
    if (!feature || feature.geometry?.type !== 'Polygon') return null;
    return feature as Feature<Polygon>;
  }

  private read<T>(tenantSlug: string, fileName: string): T | null {
    const path = join(APP_CONFIG.cadastre.mapAssetsDir(tenantSlug), fileName);
    if (!existsSync(path)) return null;

    const key = `${tenantSlug}:${fileName}`;
    const mtimeMs = statSync(path).mtimeMs;
    const hit = this.cache.get(key);
    if (hit && hit.mtimeMs === mtimeMs) return hit.value as T;

    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as T;
      this.cache.set(key, { mtimeMs, value });
      return value;
    } catch (error) {
      // A corrupt asset must not take the API down with it: the zone editor
      // degrades to "no shapes known", which its callers already handle.
      this.logger.error(`Failed to parse ${path}: ${(error as Error).message}`);
      return null;
    }
  }
}
