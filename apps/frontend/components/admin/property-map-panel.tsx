'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { SpatialFeature } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';

/** Status → marker colour. Mirrors STATUS_BADGE_VARIANT so the map and the table agree. */
const STATUS_COLOR: Record<string, string> = {
  PENDING: '#f59e0b',
  UNDER_REVIEW: '#f59e0b',
  VERIFIED: '#0369a1',
  APPROVED: '#059669',
  REJECTED: '#dc2626',
};

const LEGEND: Array<[string, string]> = [
  ['قيد المراجعة', '#f59e0b'],
  ['مدقّق', '#0369a1'],
  ['مقبول', '#059669'],
  ['مرفوض', '#dc2626'],
];

/** Parcel numbers only start being legible — and useful — this far in. */
const PARCEL_LABEL_MIN_ZOOM = 16;

/**
 * Registered properties over the municipality's own cadastre.
 *
 * The parcel grid and the parcel-number labels come from the survey office's
 * KMZ, converted at onboarding into two static GeoJSON files under
 * `public/tenants/<slug>/`. That is why they are fetched rather than queried:
 * they are cartography, identical for every request, and change only when the
 * survey office issues a new export — so a cacheable file beats an endpoint.
 *
 * A municipality without those files still gets a working map; the overlay is
 * simply absent, which is the correct behaviour for a tenant whose cadastre has
 * not been imported.
 *
 * Markers stay plain MapLibre rather than deck.gl: at the few hundred points a
 * single municipality realistically has, a WebGL layer pipeline buys nothing
 * measurable while costing bundle size and a hard WebGL dependency — and staff
 * here are often on the same older hardware as the citizens.
 */
export function PropertyMapPanel({
  tenant,
  features,
}: {
  tenant: string;
  features: SpatialFeature[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [cadastreLoaded, setCadastreLoaded] = useState(false);
  const [parcelCount, setParcelCount] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        // CARTO's free raster basemap: no API key, no Mapbox account, and raster
        // tiles render on low-end devices that struggle with vector styles.
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors © CARTO',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
        // Required for the parcel-number symbol layer; MapLibre will not render
        // text without a glyph source.
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      },
      center: [35.8623, 33.8547],
      zoom: 8,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => void loadCadastre(map, tenant, setCadastreLoaded, setParcelCount));

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [tenant]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Rebuild rather than diff: a few hundred markers is cheap to recreate, and
    // diffing marker sets is a well-known source of orphaned DOM nodes.
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (features.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    for (const feature of features) {
      const element = document.createElement('div');
      element.style.cssText = `
        width: 14px; height: 14px; border-radius: 50%;
        background: ${STATUS_COLOR[feature.status] ?? '#64748b'};
        border: 2px solid #ffffff;
        box-shadow: 0 1px 4px rgba(15,23,42,0.45);
        cursor: pointer;
      `;
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', `عقار ${feature.propertyNumber}`);

      const marker = new maplibregl.Marker({ element })
        .setLngLat([feature.longitude, feature.latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 12 }).setHTML(
            // Values are escaped: a property number is citizen-supplied text.
            `<div style="font-family:system-ui;direction:rtl;font-size:13px">
               <strong>عقار ${escapeHtml(feature.propertyNumber)}</strong><br/>
               ${escapeHtml(feature.propertyType)} — ${escapeHtml(feature.status)}
             </div>`,
          ),
        )
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([feature.longitude, feature.latitude]);
    }

    map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  }, [features]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">خريطة العقارات</h2>
        <p className="text-sm text-muted-foreground">
          {features.length} عقار مسجّل
          {parcelCount !== null ? ` · ${parcelCount} قطعة في السجل العقاري` : ''}
        </p>
      </div>

      <Card className="overflow-hidden">
        <div
          ref={containerRef}
          className="h-[32rem] w-full"
          aria-label="خريطة العقارات المسجّلة فوق المخطط العقاري للبلدية"
        />
      </Card>

      <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 p-0 text-sm">
        {LEGEND.map(([label, color]) => (
          <span key={label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full border border-white shadow"
              style={{ background: color }}
            />
            {label}
          </span>
        ))}

        {cadastreLoaded ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <span aria-hidden className="inline-block h-0.5 w-5 bg-[#0f766e]" />
            حدود القطع العقارية
          </span>
        ) : null}

        {cadastreLoaded ? (
          <span className="text-muted-foreground">
            قرّب الخريطة لعرض أرقام القطع
          </span>
        ) : null}
      </CardContent>
    </section>
  );
}

/**
 * Adds the parcel grid and parcel-number labels, if this municipality has them.
 *
 * A 404 is an expected answer, not a failure: it means the tenant's cadastre has
 * not been imported. The map is still useful without it, so nothing is surfaced
 * to staff beyond the legend quietly omitting the overlay.
 */
async function loadCadastre(
  map: maplibregl.Map,
  tenant: string,
  setLoaded: (value: boolean) => void,
  setParcelCount: (value: number | null) => void,
): Promise<void> {
  const base = `/tenants/${encodeURIComponent(tenant)}`;

  const [cadastre, parcels] = await Promise.all([
    fetchGeoJson(`${base}/cadastre.geojson`),
    fetchGeoJson(`${base}/parcels.geojson`),
  ]);

  if (!map.getStyle()) return; // Unmounted while the files were in flight.

  if (cadastre) {
    map.addSource('cadastre', { type: 'geojson', data: cadastre });

    // Under the markers, and faint: this is context for reading the markers,
    // not a layer anyone came to look at.
    map.addLayer({
      id: 'cadastre-lines',
      type: 'line',
      source: 'cadastre',
      paint: {
        'line-color': '#0f766e',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.3, 17, 1.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.25, 16, 0.7],
      },
    });
  }

  if (parcels) {
    map.addSource('parcels', { type: 'geojson', data: parcels });

    map.addLayer({
      id: 'parcel-numbers',
      type: 'symbol',
      source: 'parcels',
      minzoom: PARCEL_LABEL_MIN_ZOOM,
      layout: {
        'text-field': ['get', 'parcelNumber'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 14],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#0f172a',
        // The basemap is busy at this zoom; without a halo the numbers vanish
        // over roof imagery.
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });

    setParcelCount(parcels.features.length);
  }

  setLoaded(Boolean(cadastre || parcels));
}

async function fetchGeoJson(url: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
