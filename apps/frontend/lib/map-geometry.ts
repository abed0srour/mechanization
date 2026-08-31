/**
 * Geodesic calculations for GIS measurement tools (Distance & Area).
 * Uses spherical Earth model (WGS 84 radius = 6378137 meters).
 */

const EARTH_RADIUS = 6378137; // meters

/** Convert degrees to radians */
function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates distance between two [lng, lat] coordinates in meters.
 */
export function haversineDistance(
  coord1: [number, number],
  coord2: [number, number],
): number {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

/**
 * Calculates total cumulative distance along a line of [lng, lat] coordinates.
 */
export function computeTotalDistance(points: [number, number][]): {
  meters: number;
  kilometers: number;
} {
  if (points.length < 2) return { meters: 0, kilometers: 0 };

  let totalMeters = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalMeters += haversineDistance(points[i], points[i + 1]);
  }

  return {
    meters: Math.round(totalMeters * 10) / 10,
    kilometers: Math.round((totalMeters / 1000) * 100) / 100,
  };
}

/**
 * Calculates spherical polygon surface area in square meters and Dunams (1 Dunam = 1000 m²).
 */
export function computePolygonArea(coordinates: [number, number][]): {
  squareMeters: number;
  dunams: number;
} {
  if (coordinates.length < 3) return { squareMeters: 0, dunams: 0 };

  let total = 0;
  const len = coordinates.length;

  for (let i = 0; i < len; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[(i + 1) % len];

    const radLat1 = toRad(lat1);
    const radLat2 = toRad(lat2);
    const radLngDiff = toRad(lng2 - lng1);

    total += radLngDiff * (2 + Math.sin(radLat1) + Math.sin(radLat2));
  }

  const area = Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2.0);

  return {
    squareMeters: Math.round(area * 10) / 10,
    dunams: Math.round((area / 1000) * 100) / 100,
  };
}

/**
 * Formats distance with appropriate unit (m / km).
 */
export function formatDistance(meters: number, locale: string = 'ar'): string {
  if (meters >= 1000) {
    const km = (meters / 1000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return locale === 'en' ? `${km} km` : `${km} كم`;
  }

  const m = Math.round(meters).toLocaleString('en-US');
  return locale === 'en' ? `${m} m` : `${m} متر`;
}

/**
 * Formats area with square meters and Dunams.
 */
export function formatArea(squareMeters: number, locale: string = 'ar'): string {
  const m2 = Math.round(squareMeters).toLocaleString('en-US');
  const dunams = (squareMeters / 1000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (locale === 'en') {
    return `${m2} m² (${dunams} Dunams)`;
  }
  return `${m2} م² (${dunams} دونم)`;
}

/**
 * Calculates surface area of a GeoJSON Geometry (Polygon or MultiPolygon).
 */
export function computeGeoJsonArea(geometry: GeoJSON.Geometry | null | undefined): {
  squareMeters: number;
  dunams: number;
  squareKilometers: number;
} {
  if (!geometry) return { squareMeters: 0, dunams: 0, squareKilometers: 0 };

  let totalSqM = 0;

  if (geometry.type === 'Polygon') {
    const coords = (geometry as GeoJSON.Polygon).coordinates;
    if (coords.length > 0) {
      const outer = computePolygonArea(coords[0] as [number, number][]);
      let holes = 0;
      for (let i = 1; i < coords.length; i++) {
        holes += computePolygonArea(coords[i] as [number, number][]).squareMeters;
      }
      totalSqM += Math.max(0, outer.squareMeters - holes);
    }
  } else if (geometry.type === 'MultiPolygon') {
    const polys = (geometry as GeoJSON.MultiPolygon).coordinates;
    for (const poly of polys) {
      if (poly.length > 0) {
        const outer = computePolygonArea(poly[0] as [number, number][]);
        let holes = 0;
        for (let i = 1; i < poly.length; i++) {
          holes += computePolygonArea(poly[i] as [number, number][]).squareMeters;
        }
        totalSqM += Math.max(0, outer.squareMeters - holes);
      }
    }
  }

  return {
    squareMeters: Math.round(totalSqM * 10) / 10,
    dunams: Math.round((totalSqM / 1000) * 100) / 100,
    squareKilometers: Math.round((totalSqM / 1_000_000) * 1000) / 1000,
  };
}