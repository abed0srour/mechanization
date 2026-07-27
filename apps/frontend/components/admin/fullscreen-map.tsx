'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Loader2, Search } from 'lucide-react';
import { checkPropertyNumber, type RegisteredParcel } from '@/lib/api-client';
import { MapLayerControl } from './map-layer-control';
import { CitizenDetailDrawer } from './citizen-detail-drawer';
import { basemapById, styleFor, type BasemapId, DEFAULT_BASEMAP } from './map-styles';

/** Parcel numbers only become legible — and useful — this far in. */
const PARCEL_LABEL_MIN_ZOOM = 16;

/** Albazourieh's cadastre sits here; the fallback view before data loads. */
const FALLBACK_CENTER: [number, number] = [35.2654, 33.2539];
const FALLBACK_ZOOM = 13.5;

const SOURCE = { cadastre: 'cadastre', parcels: 'parcels' } as const;
const LAYER = {
  cadastreLines: 'cadastre-lines',
  parcelLabels: 'parcel-labels',
} as const;

/**
 * Fullscreen cadastral map.
 *
 * Fills its parent via `relative h-full w-full`, exactly like the sibling
 * Mechanization project's `BazoreyyeMap` — the parent (`map/page.tsx`) is a
 * `flex h-screen flex-col` column with a header in normal flow and this
 * component in the `flex-1` remainder. Deliberately not `position: fixed`:
 * fixed positioning breaks the moment an ancestor gets a `transform`,
 * `filter` or `contain` — a fragile way to reach "cover the viewport" when a
 * flex column reaches it directly, with no such landmine.
 *
 * Three things are layered here, and the distinction between them is the whole
 * point of the screen:
 *
 *   1. the basemap — switchable satellite / light / dark;
 *   2. the *whole* cadastre, ~1,800 parcels drawn from a static GeoJSON as
 *      lines and numbers, with no interactivity;
 *   3. a marker on each parcel that has citizen registrations behind it.
 *
 * Only (3) is clickable, and it is deliberately sparse. If every parcel carried
 * a dot, the map would show 1,800 identical markers of which a handful mean
 * anything — so a visible dot here is a promise that there is something to open.
 *
 * MapLibre rather than Leaflet: it is already this project's map library (and
 * is the open-source fork of Mapbox GL), so this needs no new dependency and
 * the raster-basemap decision documented in the README still holds.
 */
export function FullscreenMap({
  tenant,
  parcels,
  citizenHref,
  refreshToken,
}: {
  tenant: string;
  parcels: RegisteredParcel[];
  citizenHref: (citizenId: string) => string;
  /** Bumped by the page after a cadastre upload to force the static
   * GeoJSON layers to reload — otherwise they are fetched once and never
   * revisited for the lifetime of the map instance. */
  refreshToken?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP);
  const [selected, setSelected] = useState<RegisteredParcel | null>(null);
  const [cadastreReady, setCadastreReady] = useState(false);

  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'not-found'>('idle');

  const dark = basemapById(basemap).dark;

  /**
   * Adds the cadastre overlay to whichever style is currently loaded.
   *
   * Called on first load *and* after every basemap switch: `setStyle` replaces
   * the entire style docum ent, taking every custom source and layer with it,
   * so the overlay has to be reattached rather than merely restyled.
   */
  const attachCadastre = useCallback(
    async (map: maplibregl.Map, force = false) => {
      const base = `/tenants/${encodeURIComponent(tenant)}`;
      // A plain cache-buster: these are static files served with long-lived
      // cache headers, so a freshly-uploaded cadastre would otherwise keep
      // serving the browser's cached copy of the old one.
      const bust = refreshToken ? `?v=${refreshToken}` : '';
      const [cadastre, parcelPoints] = await Promise.all([
        fetchGeoJson(`${base}/cadastre.geojson${bust}`),
        fetchGeoJson(`${base}/parcels.geojson${bust}`),
      ]);

      // The style can be swapped again while these are in flight.
      if (!mapRef.current || mapRef.current !== map) return;

      if (force) {
        if (map.getLayer(LAYER.cadastreLines)) map.removeLayer(LAYER.cadastreLines);
        if (map.getSource(SOURCE.cadastre)) map.removeSource(SOURCE.cadastre);
        if (map.getLayer(LAYER.parcelLabels)) map.removeLayer(LAYER.parcelLabels);
        if (map.getSource(SOURCE.parcels)) map.removeSource(SOURCE.parcels);
      }

      if (cadastre && !map.getSource(SOURCE.cadastre)) {
        map.addSource(SOURCE.cadastre, { type: 'geojson', data: cadastre });
        map.addLayer({
          id: LAYER.cadastreLines,
          type: 'line',
          source: SOURCE.cadastre,
          paint: {
            // Boundaries have to read against imagery and against a dark
            // street map, which want opposite treatments.
            'line-color': dark ? '#7dd3fc' : '#0f766e',
            'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 18, 1.6],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.35, 16, 0.85],
          },
        });
      }

      if (parcelPoints && !map.getSource(SOURCE.parcels)) {
        map.addSource(SOURCE.parcels, { type: 'geojson', data: parcelPoints });
        map.addLayer({
          id: LAYER.parcelLabels,
          type: 'symbol',
          source: SOURCE.parcels,
          minzoom: PARCEL_LABEL_MIN_ZOOM,
          layout: {
            'text-field': ['get', 'parcelNumber'],
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 15],
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': dark ? '#ffffff' : '#0f172a',
            // Without a halo the numbers disappear into roof imagery.
            'text-halo-color': dark ? 'rgba(0,0,0,0.85)' : '#ffffff',
            'text-halo-width': 1.6,
          },
        });
      }

      setCadastreReady(Boolean(cadastre || parcelPoints));
    },
    [tenant, dark, refreshToken],
  );

  // ── Map lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(DEFAULT_BASEMAP),
      center: FALLBACK_CENTER,
      zoom: FALLBACK_ZOOM,
      attributionControl: { compact: true },
    });

    // Kept on the physical right, matching the sibling project: the basemap
    // switcher sits bottom-centre and the drawer opens from the left, so the
    // right edge is the one side nothing else claims.
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('load', () => void attachCadastre(map));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-only: attachCadastre is re-run explicitly on basemap change below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Basemap switching ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    setCadastreReady(false);
    map.setStyle(styleFor(basemap));
    // `styledata` rather than `load`: the map is long since loaded, and this is
    // the event that fires once the *replacement* style is in place.
    map.once('styledata', () => void attachCadastre(map));
  }, [basemap, attachCadastre]);

  // ── Cadastre refresh (after an admin upload) ───────────────────────
  const isFirstRefresh = useRef(true);
  useEffect(() => {
    if (isFirstRefresh.current) {
      isFirstRefresh.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    setCadastreReady(false);
    void attachCadastre(map, true);
    // Only the token's *change* should force a reload — attachCadastre itself
    // is intentionally excluded to avoid re-running this on every basemap swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // ── Registration markers ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (parcels.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    for (const parcel of parcels) {
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute(
        'aria-label',
        `العقار ${parcel.propertyNumber} — ${parcel.registrants.length} مسجّل`,
      );
      element.className = 'map-parcel-dot';
      // A parcel with several people on it earns a visibly bigger dot and a
      // count: co-ownership is the thing staff most need to spot from afar.
      if (parcel.registrants.length > 1) {
        element.classList.add('map-parcel-dot--many');
        element.textContent = String(parcel.registrants.length);
      }

      element.addEventListener('click', (event) => {
        event.stopPropagation();
        setSelected(parcel);
        map.flyTo({ center: [parcel.longitude, parcel.latitude], zoom: 17, duration: 600 });
      });

      markersRef.current.push(
        new maplibregl.Marker({ element })
          .setLngLat([parcel.longitude, parcel.latitude])
          .addTo(map),
      );

      bounds.extend([parcel.longitude, parcel.latitude]);
    }

    map.fitBounds(bounds, { padding: 96, maxZoom: 16, duration: 0 });
  }, [parcels]);

  // ── Search by رقم العقار ────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    const map = mapRef.current;
    const propertyNumber = query.trim();
    if (!map || !propertyNumber) return;

    setSearchStatus('searching');

    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;

    // An exact match among the registered parcels already on the map takes
    // the citizen-facing lookup path: same fly-to-and-open behaviour as
    // clicking its dot directly, so a search and a click land on the same
    // outcome for the same parcel.
    const registered = parcels.find((parcel) => parcel.propertyNumber === propertyNumber);
    if (registered) {
      setSelected(registered);
      map.flyTo({ center: [registered.longitude, registered.latitude], zoom: 17, duration: 900 });
      setSearchStatus('idle');
      return;
    }

    try {
      const result = await checkPropertyNumber(tenant, propertyNumber);
      if (!result.location) {
        setSearchStatus('not-found');
        return;
      }

      const element = document.createElement('div');
      element.className = 'map-search-pin';
      searchMarkerRef.current = new maplibregl.Marker({ element })
        .setLngLat([result.location.longitude, result.location.latitude])
        .addTo(map);

      map.flyTo({
        center: [result.location.longitude, result.location.latitude],
        zoom: 17,
        duration: 900,
      });
      setSearchStatus('idle');
    } catch {
      setSearchStatus('not-found');
    }
  }, [query, parcels, tenant]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="خريطة العقارات" />

      {/* Search by رقم العقار — top-centre, clear of the nav controls
          (top-right), legend (top-left) and basemap switcher (bottom-centre). */}
      <div className="absolute left-1/2 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-lg border bg-card/95 p-1.5 shadow-sm backdrop-blur">
          <Search className="ms-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (searchStatus === 'not-found') setSearchStatus('idle');
            }}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="ابحث برقم العقار"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={searchStatus === 'searching' || !query.trim()}
            className="flex h-8 shrink-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {searchStatus === 'searching' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              'بحث'
            )}
          </button>
        </div>
        {searchStatus === 'not-found' ? (
          <p className="mt-1.5 rounded-md border bg-card/95 px-3 py-1.5 text-xs text-destructive shadow-sm backdrop-blur">
            لا يوجد عقار بهذا الرقم في هذه البلدية
          </p>
        ) : null}
      </div>

      {/* Marker styling lives here rather than in globals.css: these classes
          exist only for DOM markers this component creates. */}
      <style>{`
        .map-parcel-dot {
          width: 16px; height: 16px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 9999px;
          background: hsl(var(--primary));
          border: 2px solid #fff;
          box-shadow: 0 1px 6px rgba(15, 23, 42, 0.5);
          cursor: pointer;
          padding: 0;
          font: 600 10px/1 system-ui, sans-serif;
          color: #fff;
          transition: transform 120ms ease;
        }
        .map-parcel-dot:hover { transform: scale(1.25); }
        .map-parcel-dot:focus-visible {
          outline: 2px solid hsl(var(--ring));
          outline-offset: 2px;
        }
        .map-parcel-dot--many { width: 24px; height: 24px; }

        /* Search result on a parcel with no citizen registrations yet — a
           ring rather than a filled dot, so it never reads as "clickable to
           open a sidebar" the way a registered marker does. */
        .map-search-pin {
          width: 22px; height: 22px;
          border-radius: 9999px;
          border: 3px solid hsl(var(--destructive));
          box-shadow: 0 0 0 4px rgba(0,0,0,0.08);
          animation: map-search-pulse 1.4s ease-out 2;
        }
        @keyframes map-search-pulse {
          0% { transform: scale(0.6); opacity: 0.9; }
          70% { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>

      {/* What the dots mean, stated plainly — the conditional-rendering rule
          is otherwise invisible. Pinned physically left, matching the
          reference: MapLibre's own controls sit top/bottom-right. */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg border bg-card/95 px-3 py-2 text-sm shadow-sm backdrop-blur">
        <p className="font-bold">{parcels.length} عقار مسجّل</p>
        {cadastreReady ? (
          <p className="text-xs text-muted-foreground">النقاط تظهر فقط على العقارات المسجّلة</p>
        ) : null}
      </div>

      <MapLayerControl value={basemap} onChange={setBasemap} dark={dark} />

      <CitizenDetailDrawer
        parcel={selected}
        citizenHref={citizenHref}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/**
 * A 404 is an expected answer, not a failure: it means this municipality's
 * cadastre has not been imported. The map still works without it.
 */
async function fetchGeoJson(url: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}
