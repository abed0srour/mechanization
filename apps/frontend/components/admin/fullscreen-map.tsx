'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { FeatureCollection } from 'geojson';
import { Loader2, Search, X } from 'lucide-react';
import {
  checkPropertyNumber,
  getZone,
  getZones,
  getZonesGeoJson,
  type RegisteredParcel,
  type ZoneSummary,
} from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapLayerControl } from './map-layer-control';
import { CitizenDetailDrawer } from './citizen-detail-drawer';
import { ZoneLegend } from './zone-legend';
import {
  basemapById,
  ensureRtlTextPlugin,
  styleFor,
  type BasemapId,
  DEFAULT_BASEMAP,
} from './map-styles';

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

const SOURCE = {
  cadastre: 'cadastre',
  parcels: 'parcels',
  zones: 'zones',
  registered: 'registered-parcels',
} as const;
const LAYER = {
  cadastreLines: 'cadastre-lines',
  parcelLabels: 'parcel-labels',
  zoneFills: 'zone-fills',
  zoneLines: 'zone-lines',
  zoneLabels: 'zone-labels',
  registeredHalo: 'registered-halo',
  registeredDots: 'registered-dots',
  registeredCount: 'registered-count',
} as const;

/**
 * Lifts the registration dots back above everything else.
 *
 * Layer order in Mapbox is insertion order, and the three things drawn here
 * arrive independently: the dots come from `parcels` (already in memory), the
 * cadastre from a static GeoJSON fetch, the zones from an authenticated
 * request. Whichever resolves last sits on top — so on a slow connection the
 * zone fills would land over the dots and swallow the clicks meant for them.
 *
 * Called at the end of each of the other attach paths, so the dots end up on
 * top no matter which order the three finish in. Silently tolerant of a layer
 * that is not there yet: this runs during exactly the window in which some of
 * them are still missing.
 */
function raiseRegistered(map: mapboxgl.Map): void {
  for (const id of [LAYER.registeredHalo, LAYER.registeredDots, LAYER.registeredCount]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/**
 * Adds layers to the map, deferring if the style is not ready to take them.
 *
 * `addSource` throws on a not-yet-loaded style rather than queueing, and a style
 * is mid-load here more often than it looks: a basemap switch replaces the whole
 * style document, taking every source and layer with it.
 *
 * Attempt-then-defer rather than checking `isStyleLoaded()` up front, because
 * that predicate also reports false while the *tiles* of an already-usable style
 * stream in — gating on it stalls the attach indefinitely over satellite
 * imagery, which is this map's default.
 *
 * The wait is on `style.load`, which fires exactly once when a replacement style
 * is in place. Not `styledata`: that fires repeatedly *during* a load, so
 * retrying on it burned through its attempts while the style was still settling
 * and then gave up silently — which is what left the cadastre and the sector
 * overlay missing after every basemap switch.
 */
function attachWhenReady(map: mapboxgl.Map, attach: () => void): void {
  try {
    attach();
  } catch {
    map.once('style.load', () => {
      try {
        attach();
      } catch {
        // Torn down, or swapped again mid-flight; the next swap reattaches.
      }
    });
  }
}

/**
 * Filtering to one sector dims the others rather than hiding them: the point of
 * the filter is to find a sector's parcels *in context*, and a map showing one
 * shape alone loses the surrounding streets that make it locatable.
 */
function zoneFillOpacity(activeZoneId: string | null): mapboxgl.ExpressionSpecification | number {
  if (!activeZoneId) return 0.25;
  return ['case', ['==', ['get', 'zoneId'], activeZoneId], 0.4, 0.06];
}


/**
 * Marker colours, as literals.
 *
 * Mapbox paint properties are evaluated by the GL renderer, not the CSS
 * cascade, so `hsl(var(--primary))` resolves to nothing here. These track the
 * palette in `globals.css` by hand — the civic blue and the amber the rest of
 * the admin uses — and are the one place in this component where a colour is
 * not a token.
 */
const DOT = {
  fill: '#1d4ed8',
  fillDark: '#3b82f6',
  focus: '#b45309',
  focusDark: '#f59e0b',
  stroke: '#ffffff',
} as const;

/**
 * How far above its coordinate a registration dot is drawn, in pixels.
 *
 * The dot and the cadastre's parcel number occupy the same point — the number
 * is drawn at the parcel centroid and so is the dot — so a dot sitting exactly
 * on its coordinate covers the very number that identifies it. The DOM markers
 * this replaced carried `offset: [0, -18]` for that reason, and moving them
 * onto the GPU dropped it.
 *
 * Interpolated rather than fixed, because the dots themselves grow with zoom:
 * a constant lift that clears a 4px dot at zoom 14 is swallowed by a 15px one
 * at zoom 18. These values keep the *bottom edge* of even the largest
 * co-ownership dot clear of the top of the label beneath it.
 *
 * Every layer below shares this. They must: the count sits inside its dot, and
 * a lift applied to one and not the other would peel the number off the circle
 * it belongs to.
 */
const DOT_LIFT: mapboxgl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  14,
  ['literal', [0, -14]],
  18,
  ['literal', [0, -26]],
];

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
  token,
  parcels,
  citizenHref,
  refreshToken,
  focusParcelNumber,
  focusLat,
  focusLng,
}: {
  tenant: string;
  /** Staff access token — the zone overlay is an authenticated endpoint. */
  token: string | null;
  parcels: RegisteredParcel[];
  citizenHref: (citizenId: string) => string;
  /** Bumped by the page after a cadastre upload to force the static
   * GeoJSON layers to reload — otherwise they are fetched once and never
   * revisited for the lifetime of the map instance. */
  refreshToken?: number;
  /** Arrived from a citizen's profile page. When this matches a registered
   * parcel, that marker is highlighted in a distinct colour and its drawer
   * opens automatically — same outcome as clicking it. */
  focusParcelNumber?: string;
  /** Fallback pin for a citizen's property when it isn't a registered
   * parcel (or before `parcels` has loaded) — still shown, just not
   * clickable into a drawer. */
  focusLat?: number;
  focusLng?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  /**
   * Which basemap the live map is *actually* styled with.
   *
   * Deliberately the applied value rather than a "first run" flag. React's
   * dev-mode double invoke tears the map down and builds a new one while refs
   * survive, so a boolean guard reads as "already ran" on the second pass and
   * lets a redundant `setStyle` fire at a map whose initial style is still
   * loading — which is what threw "Style is not done loading" out of
   * `attachCadastre`. Comparing against what is applied makes that redundant
   * call a no-op, because nothing has in fact changed.
   */
  const appliedBasemapRef = useRef<BasemapId>(DEFAULT_BASEMAP);

  /**
   * The dot-layer attach, reachable from the basemap effect above it.
   *
   * `attachRegistered` is a `useCallback` declared further down — after the
   * memo it closes over — and the basemap switch has to call it. Holding it
   * here rather than reordering the file keeps each piece next to the state it
   * belongs to; the effect only ever reads this inside a `style.load` handler,
   * long after render has assigned it.
   */
  const attachRegisteredRef = useRef<((map: mapboxgl.Map) => void) | null>(null);

  const searchMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const citizenPinRef = useRef<mapboxgl.Marker | null>(null);
  const selectedPinRef = useRef<mapboxgl.Marker | null>(null);
  /** Last `focusParcelNumber` handled — see the effect below. */
  const focusMatchedRef = useRef<string | undefined>(undefined);

  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP);
  const [selected, setSelected] = useState<RegisteredParcel | null>(null);
  const [cadastreReady, setCadastreReady] = useState(false);

  /**
   * Whether the map is a finished picture rather than one mid-assembly.
   *
   * Gates the cover below. Set once, on the first paint that has both a
   * rendered style and the cadastre attached — never cleared afterwards,
   * including on a basemap switch: by then the reader is looking at a working
   * map, and dropping a full-screen "loading" over it because they changed the
   * imagery would be a worse flicker than the one this removes.
   */
  const [mapReady, setMapReady] = useState(false);

  /** Read inside the marker effect without making it depend on the selection —
   *  see the `fitBounds` guard there. */
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'not-found'>('idle');
  /** Nearby real parcel numbers the server offers when the typed one is unknown. */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [matchesOpen, setMatchesOpen] = useState(false);

  const [zones, setZones] = useState<ZoneSummary[]>([]);
  const [zonesGeoJson, setZonesGeoJson] = useState<FeatureCollection | null>(null);
  const [zonesVisible, setZonesVisible] = useState(true);
  /** Sector the map is filtered to, or null for all of them. */
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [zoneParcelNumbers, setZoneParcelNumbers] = useState<Set<string> | null>(null);

  /** Read when the zone layers are (re)created, which can happen after the
   *  effects that apply these have already run — see `attachZones`. */
  const zonesVisibleRef = useRef(zonesVisible);
  zonesVisibleRef.current = zonesVisible;
  const activeZoneIdRef = useRef(activeZoneId);
  activeZoneIdRef.current = activeZoneId;

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
      const apiBase = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/t/${encodeURIComponent(tenant)}/cadastre/assets`;
      // A plain cache-buster: these are static files served with long-lived
      // cache headers, so a freshly-uploaded cadastre would otherwise keep
      // serving the browser's cached copy of the old one.
      const bust = refreshToken ? `?v=${refreshToken}` : '';
      const [cadastre, parcelPoints] = await Promise.all([
        fetchGeoJson(`${base}/cadastre.geojson${bust}`, `${apiBase}/cadastre.geojson${bust}`),
        fetchGeoJson(`${base}/parcels.geojson${bust}`, `${apiBase}/parcels.geojson${bust}`),
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

      // The dots may already be attached; whatever was just added went on
      // top of them, so put them back.
      raiseRegistered(map);

      setCadastreReady(Boolean(cadastre || parcelPoints));
    },
    [tenant, dark, refreshToken],
  );

  /**
   * Every call into `attachCadastre` goes through here.
   *
   * It cannot use `attachWhenReady` like the zone layers do: `attachCadastre` is
   * `async`, so a mid-swap style comes back as a *rejected promise* rather than
   * a synchronous throw, sails straight past `try`/`catch`, and surfaces as an
   * unhandled rejection — the runtime error overlay. The wait is on
   * `style.load` for the reason given on `attachWhenReady`.
   */
  const attachCadastreSafely = useCallback(
    (map: mapboxgl.Map, force = false): void => {
      void attachCadastre(map, force).catch(() => {
        map.once('style.load', () => {
          if (mapRef.current === map) void attachCadastre(map, force).catch(() => {});
        });
      });
    },
    [attachCadastre],
  );

  /**
   * Sector overlay, added beneath the parcel labels so a zone's colour tints the
   * neighbourhood without burying the numbers staff are reading it for.
   */
  const attachZones = useCallback(
    (map: mapboxgl.Map, data: FeatureCollection) => {
      if (map.getLayer(LAYER.zoneLabels)) map.removeLayer(LAYER.zoneLabels);
      if (map.getLayer(LAYER.zoneLines)) map.removeLayer(LAYER.zoneLines);
      if (map.getLayer(LAYER.zoneFills)) map.removeLayer(LAYER.zoneFills);
      if (map.getSource(SOURCE.zones)) map.removeSource(SOURCE.zones);

      map.addSource(SOURCE.zones, { type: 'geojson', data });

      // `beforeId` keeps the fill under the parcel numbers. The labels layer may
      // not exist yet if the cadastre is still loading, in which case appending
      // on top is correct — the reattach after that load puts it back in order.
      const beneathLabels = map.getLayer(LAYER.parcelLabels) ? LAYER.parcelLabels : undefined;

      map.addLayer(
        {
          id: LAYER.zoneFills,
          type: 'fill',
          source: SOURCE.zones,
          // `to-color`: a raw property lookup is untyped, and `fill-color`
          // rejects it rather than coercing, which fails the entire style.
          paint: { 'fill-color': ['to-color', ['get', 'color']], 'fill-opacity': 0.25 },
        },
        beneathLabels,
      );

      map.addLayer(
        {
          id: LAYER.zoneLines,
          type: 'line',
          source: SOURCE.zones,
          paint: {
            'line-color': ['to-color', ['get', 'color']],
            'line-width': 2,
            'line-opacity': 0.9,
          },
        },
        beneathLabels,
      );

      map.addLayer({
        id: LAYER.zoneLabels,
        type: 'symbol',
        source: SOURCE.zones,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 17, 18],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': dark ? '#ffffff' : '#0f172a',
          'text-halo-color': dark ? 'rgba(0,0,0,0.85)' : '#ffffff',
          'text-halo-width': 1.8,
        },
      });

      // Re-applied here rather than left to the effects below: when this runs
      // deferred (style still loading above), those effects have already been
      // and gone, so the layers would come back ignoring the current toggle.
      const visibility = zonesVisibleRef.current ? 'visible' : 'none';
      for (const id of [LAYER.zoneFills, LAYER.zoneLines, LAYER.zoneLabels]) {
        map.setLayoutProperty(id, 'visibility', visibility);
      }
      map.setPaintProperty(LAYER.zoneFills, 'fill-opacity', zoneFillOpacity(activeZoneIdRef.current));

      // Zone fills are translucent polygons covering whole neighbourhoods —
      // left on top they would take every click aimed at a dot underneath.
      raiseRegistered(map);
    },
    [dark],
  );

  // ── Map lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Before construction: the plugin shapes Arabic labels, and zone names are
    // Arabic. Registering it after a map exists leaves that map unshaped.
    ensureRtlTextPlugin();

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

    // Matches the style the map was just constructed with, so the basemap
    // effect below sees "nothing changed" rather than swapping it immediately.
    appliedBasemapRef.current = DEFAULT_BASEMAP;

    map.on('load', () => attachCadastreSafely(map));
    mapRef.current = map;

    return () => {
      mapRef.current = null;
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      citizenPinRef.current?.remove();
      citizenPinRef.current = null;
      selectedPinRef.current?.remove();
      selectedPinRef.current = null;
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

  // ── Resize with the container ──────────────────────────────────────
  // Mapbox caches the canvas's pixel size at init/last-resize; it has no way
  // to know the sidebar's collapse toggled the container wider or narrower,
  // so without this the canvas keeps its old size and a blank strip appears
  // (or the map stays cut off) until something else forces a resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Basemap switching ──────────────────────────────────────────────
  // Only a genuine change touches `setStyle`. Mapbox's style-diffing assumes a
  // settled style to diff against, and calling it against a map still building
  // its first one is what produced both this component's historic
  // "applyProjectionUpdate"/"get" crashes and the later "Style is not done
  // loading".
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;

    setCadastreReady(false);
    map.setStyle(styleFor(basemap));
    // `style.load` rather than `load`: the map is long since loaded, and this is
    // the event that fires once the *replacement* style is in place.
    map.once('style.load', () => {
      attachCadastreSafely(map);
      // The dots are GL layers now, so they go with the old style document
      // exactly like the cadastre does and have to be rebuilt beside it. As
      // DOM markers they survived a basemap switch on their own; this is the
      // one thing that regressed in moving them onto the GPU, and it is a line.
      attachRegisteredRef.current?.(map);
    });
  }, [basemap, attachCadastreSafely]);

  // ── Cadastre refresh (after an admin upload) ───────────────────────
  // Same shape as the basemap guard above, and for the same reason: a boolean
  // "first run" flag survives the dev-mode remount that the map does not, and
  // would fire a forced reattach at a freshly-built map.
  const appliedRefreshRef = useRef(refreshToken);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedRefreshRef.current === refreshToken) return;
    appliedRefreshRef.current = refreshToken;

    setCadastreReady(false);
    attachCadastreSafely(map, true);
  }, [refreshToken, attachCadastreSafely]);

  // ── Zone overlay ───────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    // Deliberately not awaited together. The sector list is a cheap read and
    // fills the legend; the overlay has to dissolve every sector's parcels
    // first. Pairing them in one `Promise.all` held the legend back behind the
    // slower call for no reason — a municipality with many sectors would sit
    // with an empty legend for as long as the geometry took.
    getZones(tenant, token)
      .then((list) => {
        if (!cancelled) setZones(list.zones);
      })
      .catch(() => {
        // A municipality that has drawn no sectors is the normal case, not an
        // error — the map is fully usable without the overlay.
        if (!cancelled) setZones([]);
      });

    getZonesGeoJson(tenant, token)
      .then((geojson) => {
        if (!cancelled) setZonesGeoJson(geojson);
      })
      .catch(() => {
        if (!cancelled) setZonesGeoJson(null);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, token, refreshToken]);

  // Not gated on the cadastre: the zone overlay only uses the parcel-label
  // layer as an optional `beforeId`, so tying it to that layer's arrival made a
  // cadastre hiccup silently cost the sectors too. `attachZones` waits for the
  // style itself, which is the dependency that actually exists.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zonesGeoJson) return;
    attachWhenReady(map, () => {
      if (mapRef.current === map) attachZones(map, zonesGeoJson);
    });
  }, [zonesGeoJson, cadastreReady, attachZones]);

  // Both effects below no-op until the layers exist. `attachZones` applies the
  // current values itself when it creates them, so a toggle flipped while the
  // overlay was still loading is not lost.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(LAYER.zoneFills)) return;

    const visibility = zonesVisible ? 'visible' : 'none';
    for (const id of [LAYER.zoneFills, LAYER.zoneLines, LAYER.zoneLabels]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  }, [zonesVisible, zonesGeoJson, cadastreReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(LAYER.zoneFills)) return;
    map.setPaintProperty(LAYER.zoneFills, 'fill-opacity', zoneFillOpacity(activeZoneId));
  }, [activeZoneId, zonesGeoJson, cadastreReady]);

  // Which parcels belong to the filtered sector, so the marker list below can
  // narrow to them. Fetched rather than derived: the list endpoint carries
  // counts only, and the geojson carries dissolved shapes, not membership.
  useEffect(() => {
    if (!token || !activeZoneId) {
      setZoneParcelNumbers(null);
      return;
    }
    let cancelled = false;

    getZone(tenant, token, activeZoneId)
      .then((detail) => {
        if (!cancelled) setZoneParcelNumbers(new Set(detail.parcelNumbers));
      })
      .catch(() => {
        if (!cancelled) setZoneParcelNumbers(null);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, token, activeZoneId]);

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

  // ── Registration dots ──────────────────────────────────────────────
  /**
   * The registered parcels, as a GeoJSON source and three GL layers.
   *
   * These used to be `mapboxgl.Marker`s — one `<button>` element per parcel,
   * which mapbox-gl repositions from JavaScript on *every frame* of every pan
   * and zoom. At a few hundred registered parcels that is a few hundred style
   * recalculations a frame, and it is why the map stuttered while the cadastre
   * lines and the zone fills beside it stayed smooth: those were always GL
   * layers, and only the dots were DOM.
   *
   * On the GPU the cost stops scaling with the number of parcels, and three
   * things that were awkward with DOM markers come free: the dots grow with
   * zoom through an interpolation rather than sitting at a fixed pixel size,
   * the count label is a real symbol, and a filter change is a `setData` rather
   * than removing and rebuilding every marker.
   */
  const registeredGeoJson = useMemo<FeatureCollection>(() => {
    // Filtering to a sector narrows the dots to its parcels, so "12 registered"
    // in the legend and the dots on screen are counting the same thing.
    const visible = zoneParcelNumbers
      ? parcels.filter((parcel) => zoneParcelNumbers.has(parcel.propertyNumber))
      : parcels;

    return {
      type: 'FeatureCollection',
      features: visible.map((parcel) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [parcel.longitude, parcel.latitude] },
        properties: {
          propertyNumber: parcel.propertyNumber,
          registrants: parcel.registrants.length,
          // A number, not a boolean: GL expressions compare numbers reliably
          // and booleans carried through GeoJSON less so.
          focused: parcel.propertyNumber === focusParcelNumber ? 1 : 0,
          // Only a co-owned parcel carries a count; an empty string is how
          // `text-field` is told to draw nothing.
          label: parcel.registrants.length > 1 ? String(parcel.registrants.length) : '',
        },
      })),
    };
  }, [parcels, zoneParcelNumbers, focusParcelNumber]);

  /** Read inside the click handler, so a refetch does not rebind listeners. */
  const parcelsRef = useRef(parcels);
  parcelsRef.current = parcels;

  /** Whether the opening `fitBounds` has already run — see the effect below. */
  const fittedRef = useRef(false);

  /**
   * Adds the dot layers to whichever style is loaded, or updates their data if
   * they are already there. Re-run after a basemap switch for the same reason
   * the cadastre is: `setStyle` discards every custom source and layer.
   */
  const attachRegistered = useCallback(
    (map: mapboxgl.Map) => {
      const existing = map.getSource(SOURCE.registered) as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(registeredGeoJson);
        return;
      }

      map.addSource(SOURCE.registered, { type: 'geojson', data: registeredGeoJson });

      const fill: mapboxgl.ExpressionSpecification = [
        'case',
        ['==', ['get', 'focused'], 1],
        dark ? DOT.focusDark : DOT.focus,
        dark ? DOT.fillDark : DOT.fill,
      ];

      /**
       * The soft outer glow. Its own layer rather than `circle-blur` on the dot
       * itself, because blurring the dot also blurs its white stroke — and that
       * stroke is the whole reason a dot stays legible over satellite imagery.
       */
      map.addLayer({
        id: LAYER.registeredHalo,
        type: 'circle',
        source: SOURCE.registered,
        paint: {
          'circle-color': fill,
          'circle-blur': 0.65,
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.18, 17, 0.35],
          'circle-translate': DOT_LIFT,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            ['case', ['>', ['get', 'registrants'], 1], 11, 8],
            18,
            ['case', ['>', ['get', 'registrants'], 1], 26, 19],
          ],
        },
      });

      map.addLayer({
        id: LAYER.registeredDots,
        type: 'circle',
        source: SOURCE.registered,
        paint: {
          'circle-color': fill,
          'circle-stroke-color': DOT.stroke,
          // Grows with zoom rather than sitting at a fixed 16px: far out these
          // are a density read, close in they are targets to click.
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 17, 2.4],
          'circle-translate': DOT_LIFT,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            ['case', ['>', ['get', 'registrants'], 1], 6, 4.5],
            18,
            ['case', ['>', ['get', 'registrants'], 1], 15, 10],
          ],
        },
      });

      /**
       * The co-ownership count, drawn inside the larger dots.
       *
       * `text-allow-overlap` because this label belongs *to* its dot —
       * suppressing it on collision would leave a big blank circle that reads
       * as a different kind of marker rather than as a hidden number.
       */
      map.addLayer({
        id: LAYER.registeredCount,
        type: 'symbol',
        source: SOURCE.registered,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 18, 15],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': DOT.stroke, 'text-translate': DOT_LIFT },
      });
    },
    [registeredGeoJson, dark],
  );
  attachRegisteredRef.current = attachRegistered;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    attachWhenReady(map, () => attachRegistered(map));
  }, [attachRegistered]);

  /**
   * Lifts the cover, once.
   *
   * `idle` rather than `load`: `load` fires when the style is parsed and the
   * *first* tiles are in, which on satellite imagery is still a half-drawn
   * map. `idle` fires when there is nothing left to fetch or render for the
   * current view — the first moment the map is genuinely finished.
   *
   * Waiting on `cadastreReady` too, because the cadastre is fetched
   * independently of the tiles: an `idle` map without it is a basemap with the
   * parcel boundaries about to pop in on top.
   *
   * The timeout is the honest part. If a layer never arrives — an offline
   * cadastre file, a tile server that stalls — a cover with no exit turns a
   * degraded map into no map at all. Three seconds in, the reader gets
   * whatever there is.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapReady) return;

    const reveal = (): void => setMapReady(true);

    if (cadastreReady) {
      if (map.loaded()) {
        reveal();
      } else {
        map.once('idle', reveal);
      }
    }

    const fallback = setTimeout(reveal, 3_000);
    return () => {
      clearTimeout(fallback);
      map.off('idle', reveal);
    };
  }, [cadastreReady, mapReady]);

  /**
   * Clicking a dot, and the pointer cursor that says it can be clicked.
   *
   * Bound to the *layer* rather than to each marker element, and registered
   * once for the life of the map: `parcels` is read through a ref inside the
   * handler, so a refetch no longer means tearing down and rebinding a
   * listener per parcel.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (
      event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] },
    ) => {
      const number = event.features?.[0]?.properties?.propertyNumber as string | undefined;
      if (!number) return;
      const parcel = parcelsRef.current.find((candidate) => candidate.propertyNumber === number);
      if (parcel) openParcel(parcel);
    };
    const enter = (): void => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const leave = (): void => {
      map.getCanvas().style.cursor = '';
    };

    map.on('click', LAYER.registeredDots, onClick);
    map.on('mouseenter', LAYER.registeredDots, enter);
    map.on('mouseleave', LAYER.registeredDots, leave);

    return () => {
      map.off('click', LAYER.registeredDots, onClick);
      map.off('mouseenter', LAYER.registeredDots, enter);
      map.off('mouseleave', LAYER.registeredDots, leave);
    };
  }, [openParcel]);

  /**
   * Frames every registered parcel — the right opening view, and the wrong
   * thing to do to someone already looking at one.
   *
   * Guarded by a ref rather than by the dependency list: the data can be
   * refetched, and an unguarded fit would throw the camera back out to the
   * whole municipality mid-review. A deep-linked or currently-open parcel owns
   * the camera instead.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fittedRef.current) return;
    if (focusParcelNumber || selectedRef.current) return;

    const features = registeredGeoJson.features;
    if (features.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const feature of features) {
      if (feature.geometry.type !== 'Point') continue;
      bounds.extend(feature.geometry.coordinates as [number, number]);
    }
    map.fitBounds(bounds, { padding: 96, maxZoom: 16, duration: 0 });
    fittedRef.current = true;
  }, [registeredGeoJson, focusParcelNumber]);

  // ── Pin on the open parcel ─────────────────────────────────────────
  /**
   * A full-size pin on whichever parcel the drawer is describing, however it
   * was opened — a marker click, the search box, or a deep link from a
   * citizen's profile.
   *
   * The 16px dot alone was not enough to answer "which one is 1418?": at the
   * zoom the drawer opens at, it is one small circle among the cadastre lines
   * and the zone overlay, and nothing on the map tied it to the panel that
   * had just appeared. This sits on top of that dot, anchored so its tip
   * touches the parcel's coordinate.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;

    const element = document.createElement('div');
    element.className = 'map-selected-pin';
    selectedPinRef.current?.remove();
    selectedPinRef.current = new mapboxgl.Marker({ element, anchor: 'bottom' })
      .setLngLat([selected.longitude, selected.latitude])
      .addTo(map);

    return () => {
      selectedPinRef.current?.remove();
      selectedPinRef.current = null;
    };
  }, [selected]);

  // ── Citizen focus (arrived from a profile page's "عرض على الخريطة") ──
  // Immediate fallback pin at the citizen's own coordinates, shown the moment
  // the map exists — it does not wait on `parcels`, so there is no visible
  // delay before something appears.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusLat == null || focusLng == null) return;

    const element = document.createElement('div');
    element.className = 'map-citizen-pin';
    citizenPinRef.current?.remove();
    citizenPinRef.current = new mapboxgl.Marker({ element })
      .setLngLat([focusLng, focusLat])
      .addTo(map);
    map.flyTo({ center: [focusLng, focusLat], zoom: 17, duration: 900 });

    return () => {
      citizenPinRef.current?.remove();
      citizenPinRef.current = null;
    };
    // Runs once the map exists and a target is known; not re-run on later
    // renders of the same target.
     
  }, [focusLat, focusLng]);

  // Upgrade path: once `parcels` has loaded and the citizen's property turns
  // out to be a registered one, drop the plain fallback pin and hand off to
  // the same fly-to-and-open-drawer flow a marker click gets — richer, but
  // only available once the registered-parcel data is in.
  //
  // Tracks *which* parcel was last handled, not just whether one ever was:
  // this component can outlive a single citizen's visit (the map route
  // doesn't always remount between two "عرض على الخريطة" links in a row), so
  // a plain boolean would silently ignore every citizen after the first.
  useEffect(() => {
    if (!focusParcelNumber || focusMatchedRef.current === focusParcelNumber) return;
    const matched = parcels.find((parcel) => parcel.propertyNumber === focusParcelNumber);
    if (!matched) return;

    focusMatchedRef.current = focusParcelNumber;
    citizenPinRef.current?.remove();
    citizenPinRef.current = null;
    openParcel(matched);
  }, [parcels, focusParcelNumber, openParcel]);

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
    /*
      `data-sheet-open` while the parcel panel is showing.

      On a phone that panel is a bottom sheet, and everything the map keeps at
      its own bottom edge — the scale bar, the basemap switcher, and Mapbox's
      attribution, which its terms require to stay visible — would sit behind
      it. The rule in the style block below lifts them clear rather than
      leaving a control that is present, unreachable and invisible.
    */
    <div
      className="group/map relative h-full w-full"
      data-sheet-open={selected ? "true" : undefined}
    >
      <div ref={containerRef} className="h-full w-full" aria-label="خريطة العقارات" />

      {/*
        The cover that hides the map assembling itself.

        A Mapbox map does not appear, it accumulates: a grey canvas, then the
        basemap tiles streaming in, then the cadastre GeoJSON once it has been
        fetched and parsed, then the dots, then a `fitBounds` that jumps the
        camera from the fallback centre to the municipality. Watching that
        happen looks like a page repeatedly failing and retrying — which is
        exactly what "the map looks glitchy" describes.

        So the whole sequence happens behind this, and the map is revealed once
        it is a finished picture. It fades rather than cutting, and it is
        `pointer-events-none` while fading so a click during the last 400ms
        reaches the map underneath rather than the ghost of the cover.
      */}
      <div
        aria-hidden={mapReady}
        className={cn(
          'absolute inset-0 z-30 flex flex-col items-center justify-center gap-3',
          'bg-background transition-opacity duration-500',
          mapReady ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        <Loader2 className="size-7 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">جارٍ تحضير الخريطة…</p>
      </div>

      {/* Search by رقم العقار — top-centre, clear of the nav control
          (top-left), legend (top-right) and basemap switcher (bottom-centre).

          That "clear of" holds only while the pill is at its 22rem cap. Below
          about 606px it is `100% - 1.5rem` instead, wide enough to reach under
          the count box pinned to the right edge — so the two overlaid each
          other on every phone and on a small tablet in portrait. The boxes
          below now stack under this one until `sm`, where the cap is back in
          force and the original side-by-side arrangement fits again.

          `z-20` so the match list this opens covers the boxes beneath it
          rather than being covered by them. */}
      <div className="absolute left-1/2 top-3 z-20 w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2">
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

      {/*
        Styling for the DOM markers this component still creates.

        `.map-parcel-dot` used to live here — one element per registered parcel,
        with a `:hover` transform and an infinite pulse on the focused one. It
        is gone: those are GL layers now (see `attachRegistered`), which is what
        stopped the map stuttering during a pan. What remains are the three
        one-off pins, where a single DOM element buys CSS that GL cannot
        express — a teardrop, and a pulse that draws the eye to a single place.
      */}
      <style>{`
        /* The parcel the drawer is currently describing.

           A teardrop rather than another circle: every other mark on this map
           is round, so the one that says "this is the one you opened" is the
           one shape that is not. The marker is anchored bottom, so the tip
           sits on the coordinate and points at the parcel rather than
           covering it. */
        .map-selected-pin {
          position: relative;
          width: 28px; height: 28px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          background: hsl(var(--warning));
          border: 3px solid #fff;
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.55);
        }
        /* Counter-rotated so the hole reads as a circle, not an egg. */
        .map-selected-pin::before {
          content: '';
          position: absolute;
          inset: 6px;
          border-radius: 9999px;
          background: #fff;
        }
        .map-selected-pin::after {
          content: '';
          position: absolute;
          inset: -10px;
          border-radius: 9999px;
          border: 2px solid hsl(var(--warning));
          animation: map-search-pulse 1.8s ease-out 3;
        }

        /* Fallback pin for a citizen's property when it isn't a registered
           parcel — filled (unlike the empty search ring below) since this is
           a known location, not "nothing found here yet". Same amber as the
           focused dot above so the two read as the same concept. */
        .map-citizen-pin {
          position: relative;
          width: 20px; height: 20px;
          border-radius: 9999px;
          background: hsl(var(--warning));
          border: 3px solid #fff;
          box-shadow: 0 1px 6px rgba(15, 23, 42, 0.6);
        }
        .map-citizen-pin::after {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 9999px;
          border: 2px solid hsl(var(--warning));
          animation: map-search-pulse 1.6s ease-out infinite;
        }

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

        /* Below the sm breakpoint the parcel panel is a sheet off the bottom
           edge, capped at 68dvh. Anything the map anchors to that edge goes
           behind it, so it is lifted the sheet's height plus a gap — Mapbox's
           attribution included, which its terms require to remain visible.
           Above sm the panel is a side rail and nothing here is in its way.
           (No backticks in this block: it is inside a template literal.) */
        @media (max-width: 639px) {
          [data-sheet-open] .mapboxgl-ctrl-bottom-left,
          [data-sheet-open] .mapboxgl-ctrl-bottom-right {
            bottom: calc(68dvh + 0.5rem);
            transition: bottom 300ms ease;
          }
        }
      `}</style>

      {/* What the dots mean, stated plainly — the conditional-rendering rule
          is otherwise invisible. Pinned physically right: Mapbox's own nav
          control sits top-left, and the citizen drawer opens from this same
          right edge but well below the header. */}
      <div className="pointer-events-none absolute right-3 top-16 z-10 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur sm:top-3">
        <p className="text-sm font-bold">
          {zoneParcelNumbers
            ? parcels.filter((parcel) => zoneParcelNumbers.has(parcel.propertyNumber)).length
            : parcels.length}{' '}
          عقار مسجّل
        </p>
        {activeZoneId ? (
          <p className="text-xs text-primary">
            ضمن قطاع {zones.find((zone) => zone.id === activeZoneId)?.name ?? ''}
          </p>
        ) : cadastreReady ? (
          <p className="text-xs text-muted-foreground">النقاط تظهر فقط على العقارات المسجّلة</p>
        ) : null}
      </div>

      <ZoneLegend
        zones={zones}
        visible={zonesVisible}
        onVisibleChange={setZonesVisible}
        activeZoneId={activeZoneId}
        onSelectZone={setActiveZoneId}
      />

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
async function fetchGeoJson(url: string, fallbackUrl?: string): Promise<FeatureCollection | null> {
  try {
    let response = await fetch(url);
    if (!response.ok && fallbackUrl) {
      response = await fetch(fallbackUrl);
    }
    if (!response.ok) return null;
    return (await response.json()) as FeatureCollection;
  } catch {
    if (fallbackUrl) {
      try {
        const response = await fetch(fallbackUrl);
        if (response.ok) return (await response.json()) as FeatureCollection;
      } catch {
        return null;
      }
    }
    return null;
  }
}
