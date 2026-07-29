'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { FeatureCollection } from 'geojson';
import { Loader2, Search, X } from 'lucide-react';
import { checkPropertyNumber, type RegisteredParcel } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapLayerControl } from './map-layer-control';
import { CitizenDetailDrawer } from './citizen-detail-drawer';
import { basemapById, styleFor, type BasemapId, DEFAULT_BASEMAP } from './map-styles';

// Falls back to Mapbox's own public example token — never a real project
// token here, since this file is committed. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
// in `.env`/`.env.local` (both gitignored) for real usage.
mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

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
 * Fullscreen cadastral map using Mapbox GL JS.
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
 *   1. the basemap — switchable satellite / light / dark, Mapbox's own hosted
 *      styles;
 *   2. the *whole* cadastre, ~1,800 parcels drawn from a static GeoJSON as
 *      lines and numbers, with no interactivity;
 *   3. a marker on each parcel that has citizen registrations behind it.
 *
 * Only (3) is clickable, and it is deliberately sparse. If every parcel carried
 * a dot, the map would show 1,800 identical markers of which a handful mean
 * anything — so a visible dot here is a promise that there is something to open.
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
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const searchMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP);
  const [selected, setSelected] = useState<RegisteredParcel | null>(null);
  const [cadastreReady, setCadastreReady] = useState(false);

  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'not-found'>('idle');
  /** Nearby real parcel numbers the server offers when the typed one is unknown. */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [matchesOpen, setMatchesOpen] = useState(false);

  const dark = basemapById(basemap).dark;

  const trimmedQuery = query.trim();

  // Registered parcels whose number starts with what has been typed. Staff
  // half-remember a number far more often than they know it exactly, and this
  // list is already in memory — it answers before the server is even asked.
  const localMatches = trimmedQuery
    ? parcels.filter((parcel) => parcel.propertyNumber.startsWith(trimmedQuery)).slice(0, 6)
    : [];

  /**
   * Adds the cadastre overlay to whichever style is currently loaded.
   *
   * Called on first load *and* after every basemap switch: `setStyle` replaces
   * the entire style document, taking every custom source and layer with it,
   * so the overlay has to be reattached rather than merely restyled.
   */
  const attachCadastre = useCallback(
    async (map: mapboxgl.Map, force = false) => {
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
            // Mapbox's own hosted styles ship this font stack — no separate
            // glyph source to wire up, unlike a bare raster style.
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
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

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleFor(DEFAULT_BASEMAP),
      center: FALLBACK_CENTER,
      zoom: FALLBACK_ZOOM,
    });

    // Kept on the physical left: the basemap switcher sits bottom-centre and
    // the citizen drawer opens from the right, so the left edge is the one
    // side nothing else claims. Default options, matching the sibling
    // Mechanization project's `BazoreyyeMap`: zoom in/out plus the compass
    // button (resets bearing to north; doubles as a rotate handle).
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => void attachCadastre(map));
    mapRef.current = map;

    return () => {
      mapRef.current = null;
      try {
        // React StrictMode's dev-only mount→cleanup→remount can tear this
        // down before mapbox-gl's own async style/worker setup has settled;
        // `remove()` mid-setup can throw from inside the library rather than
        // clean up. Never fires in production, where StrictMode's double
        // invoke doesn't happen.
        map.remove();
      } catch {
        // Already torn down (or never finished initializing) — nothing left
        // to clean up.
      }
    };
    // Mount-only: attachCadastre is re-run explicitly on basemap change below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Basemap switching ──────────────────────────────────────────────
  // Fires on mount too, since `basemap`/`attachCadastre` are both "new" the
  // first time this effect runs — without this guard it called `setStyle()`
  // on the map the instant it was constructed, before its *initial* style
  // had loaded. Mapbox's own style-diffing in `setStyle()` assumes a settled
  // style/transform to diff against; hitting it mid-construction is what
  // threw "Cannot read properties of undefined (reading 'applyProjectionUpdate')"
  // and "...(reading 'get')" from inside mapbox-gl.
  const isFirstBasemap = useRef(true);
  useEffect(() => {
    if (isFirstBasemap.current) {
      isFirstBasemap.current = false;
      return;
    }
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

  /**
   * Fly to a registered parcel and open its panel — the single path a marker
   * click, a suggestion pick and a successful search all take, so all three
   * land on exactly the same outcome for the same parcel.
   */
  const openParcel = useCallback((parcel: RegisteredParcel) => {
    setSelected(parcel);
    // A typeahead list left hanging over a panel that has already opened is
    // stale the moment the panel appears — including when the map is clicked.
    setMatchesOpen(false);
    mapRef.current?.flyTo({
      center: [parcel.longitude, parcel.latitude],
      zoom: 17,
      duration: 600,
    });
  }, []);

  // ── Registration markers ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (parcels.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();

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
        openParcel(parcel);
      });

      markersRef.current.push(
        new mapboxgl.Marker({ element, offset: [0, -18] })
          .setLngLat([parcel.longitude, parcel.latitude])
          .addTo(map),
      );

      bounds.extend([parcel.longitude, parcel.latitude]);
    }

    map.fitBounds(bounds, { padding: 96, maxZoom: 16, duration: 0 });
  }, [parcels, openParcel]);

  // ── Search by رقم العقار ────────────────────────────────────────────
  /** Takes an explicit number when the search is re-run from a suggestion. */
  const runSearch = useCallback(
    async (term?: string) => {
      const map = mapRef.current;
      const propertyNumber = (term ?? query).trim();
      if (!map || !propertyNumber) return;

      if (term) setQuery(term);
      setMatchesOpen(false);
      setSuggestions([]);
      setSearchStatus('searching');

      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;

      // An exact match among the registered parcels already on the map takes
      // the citizen-facing lookup path: same fly-to-and-open behaviour as
      // clicking its dot directly, so a search and a click land on the same
      // outcome for the same parcel.
      const registered = parcels.find((parcel) => parcel.propertyNumber === propertyNumber);
      if (registered) {
        openParcel(registered);
        setSearchStatus('idle');
        return;
      }

      try {
        const result = await checkPropertyNumber(tenant, propertyNumber);
        if (!result.location) {
          // The endpoint already knows which real parcel numbers are near the
          // typed one; a dead end that offers them is worth far more than one
          // that only says no.
          setSuggestions(result.suggestions ?? []);
          setSearchStatus('not-found');
          return;
        }

        const element = document.createElement('div');
        element.className = 'map-search-pin';
        searchMarkerRef.current = new mapboxgl.Marker({ element })
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
    },
    [query, parcels, tenant, openParcel],
  );

  /** Resets the field *and* the pin it dropped — one without the other leaves
   *  a marker on the map with nothing on screen explaining it. */
  const clearSearch = useCallback(() => {
    setQuery('');
    setSearchStatus('idle');
    setSuggestions([]);
    setMatchesOpen(false);
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="خريطة العقارات" />

      {/* Search by رقم العقار — top-centre, clear of the nav control
          (top-left), legend (top-right) and basemap switcher (bottom-centre). */}
      <div className="absolute left-1/2 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-lg border bg-card/95 p-1.5 shadow-sm backdrop-blur">
          <Search className="ms-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
          {/* The shared Input, sized down to sit inside the pill: its chrome is
              the pill's border and background, so the field contributes none. */}
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchesOpen(true);
              if (searchStatus === 'not-found') setSearchStatus('idle');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
              if (e.key === 'Escape') clearSearch();
            }}
            placeholder="ابحث برقم العقار"
            aria-label="ابحث برقم العقار"
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={clearSearch}
              aria-label="مسح البحث"
              className="size-8 shrink-0"
            >
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => void runSearch()}
            disabled={searchStatus === 'searching' || !query.trim()}
            className="h-8 shrink-0"
          >
            {searchStatus === 'searching' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              'بحث'
            )}
          </Button>
        </div>

        {/* Typeahead over the parcels already on the map. Rows rather than
            buttons, matching the reference's resident list — a stack of
            button-shaped controls reads as a toolbar, not as results. */}
        {matchesOpen && localMatches.length > 0 ? (
          <ul className="mt-1.5 overflow-hidden rounded-md border bg-card/95 shadow-sm backdrop-blur">
            {localMatches.map((parcel) => (
              <li key={parcel.propertyNumber}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(parcel.propertyNumber);
                    setMatchesOpen(false);
                    setSearchStatus('idle');
                    openParcel(parcel);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm transition-colors hover:bg-accent"
                >
                  <span className="font-medium">العقار رقم {parcel.propertyNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    {parcel.registrants.length} مسجّل
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {searchStatus === 'not-found' ? (
          <div className="mt-1.5 rounded-md border bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur">
            <p className="text-xs text-destructive">لا يوجد عقار بهذا الرقم في هذه البلدية</p>
            {suggestions.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">هل تقصد</span>
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    onClick={() => void runSearch(suggestion)}
                    className="h-7 px-2 text-xs"
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
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
          is otherwise invisible. Pinned physically right: Mapbox's own nav
          control sits top-left, and the citizen drawer opens from this same
          right edge but well below the header. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
        <p className="text-sm font-bold">{parcels.length} عقار مسجّل</p>
        {cadastreReady ? (
          <p className="text-xs text-muted-foreground">النقاط تظهر فقط على العقارات المسجّلة</p>
        ) : null}
      </div>

      <MapLayerControl value={basemap} onChange={setBasemap} />

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
async function fetchGeoJson(url: string): Promise<FeatureCollection | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as FeatureCollection;
  } catch {
    return null;
  }
}
