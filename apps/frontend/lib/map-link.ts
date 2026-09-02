import type { CitizenProfileProperty } from './api-client';

type LocatableProperty = Pick<CitizenProfileProperty, 'propertyNumber' | 'latitude' | 'longitude'>;

/**
 * First property with a known location — the one a single "عرض على الخريطة"
 * action points at when a citizen has several on file.
 *
 * A card whose رقم العقار was left «غير مؤكَّد» never went through the cadastre
 * lookup, so it has no coordinates and is skipped here by the same test that
 * has always skipped an unlocatable parcel. It is excluded explicitly anyway:
 * the deep link is *keyed* by parcel number, and a link to `?parcel=` would
 * open the map on nothing.
 */
export function findLocatedProperty(
  properties: readonly LocatableProperty[],
): LocatableProperty | undefined {
  return properties.find(
    (property) =>
      property.propertyNumber != null &&
      property.latitude != null &&
      property.longitude != null,
  );
}

/** Builds the map deep-link `FullscreenMap` reads via its `focusParcelNumber`/
 * `focusLat`/`focusLng` props — see fullscreen-map.tsx. */
export function mapHref(base: string, property: LocatableProperty): string {
  const params = new URLSearchParams({ parcel: property.propertyNumber ?? '' });
  if (property.latitude != null) params.set('lat', String(property.latitude));
  if (property.longitude != null) params.set('lng', String(property.longitude));
  return `${base}/map?${params}`;
}
