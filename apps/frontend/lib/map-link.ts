import type { CitizenProfileProperty } from './api-client';

type LocatableProperty = Pick<CitizenProfileProperty, 'propertyNumber' | 'latitude' | 'longitude'>;

/** First property with a known location — the one a single "عرض على الخريطة"
 * action points at when a citizen has several on file. */
export function findLocatedProperty(
  properties: readonly LocatableProperty[],
): LocatableProperty | undefined {
  return properties.find((property) => property.latitude != null && property.longitude != null);
}

/** Builds the map deep-link `FullscreenMap` reads via its `focusParcelNumber`/
 * `focusLat`/`focusLng` props — see fullscreen-map.tsx. */
export function mapHref(base: string, property: LocatableProperty): string {
  const params = new URLSearchParams({ parcel: property.propertyNumber });
  if (property.latitude != null) params.set('lat', String(property.latitude));
  if (property.longitude != null) params.set('lng', String(property.longitude));
  return `${base}/map?${params}`;
}
