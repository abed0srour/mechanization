/**
 * The three basemaps the staff map offers, all Mapbox's own hosted styles —
 * no custom style document to maintain, and imagery/label rendering that
 * comes from a real Mapbox account rather than a free raster tile mirror.
 *
 * Satellite is first because it is the one staff actually reason with: a
 * cadastral parcel means little on a street map and a great deal over a roof.
 * `satellite-v9` rather than `satellite-streets-v12`: no street labels
 * competing with the cadastre's own parcel numbers.
 */
import mapboxgl from 'mapbox-gl';

/**
 * Teaches Mapbox to shape Arabic before it draws any.
 *
 * Mapbox GL JS does not do bidirectional text or Arabic glyph joining in its
 * core renderer; without this plugin a label reading "المنطقة الشرقية" is drawn
 * left-to-right from unjoined letterforms — "ةيقرشلا ةقطنملا" — which is not
 * merely ugly but genuinely unreadable. It went unnoticed until zone names
 * reached the map because every label before them was a parcel number, and
 * Latin digits need no shaping.
 *
 * Must run before the first `new mapboxgl.Map()`, and exactly once per page:
 * calling it twice throws.
 *
 * Fetched eagerly — the third argument is `deferred`, and it must stay `false`.
 * Deferring sounds harmless (fetch the plugin only once RTL text shows up) but
 * the trigger never fires: encountering an Arabic label while the plugin is
 * merely *registered* makes Mapbox skip laying that label out rather than
 * download the plugin and retry. The symptom is silent and easy to misread —
 * Latin sector names like "test" draw normally, Arabic ones like "الساحة" draw
 * nothing at all, no error, and the Arabic glyph range is never even requested
 * from the font endpoint.
 */
export function ensureRtlTextPlugin(): void {
  if (mapboxgl.getRTLTextPluginStatus() !== 'unavailable') return;

  mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js',
    null,
    false,
  );
}

export type BasemapId = 'satellite' | 'light' | 'dark';

export interface Basemap {
  id: BasemapId;
  /** Arabic label shown in the switcher. */
  label: string;
  /** Mapbox-hosted style URL, passed straight to `map.setStyle`. */
  styleUrl: string;
  /**
   * Whether the imagery underneath is dark. Drives the switcher's own
   * colouring and the halo behind parcel labels — white text on a white halo
   * is invisible over satellite, and black-on-black is invisible over the dark
   * street map.
   */
  dark: boolean;
}

export const BASEMAPS: readonly Basemap[] = [
  {
    id: 'satellite',
    label: 'قمر صناعي',
    styleUrl: 'mapbox://styles/mapbox/satellite-v9',
    dark: true,
  },
  {
    id: 'light',
    label: 'خريطة فاتحة',
    styleUrl: 'mapbox://styles/mapbox/light-v11',
    dark: false,
  },
  {
    id: 'dark',
    label: 'خريطة داكنة',
    styleUrl: 'mapbox://styles/mapbox/dark-v11',
    dark: true,
  },
] as const;

export const DEFAULT_BASEMAP: BasemapId = 'satellite';

export function basemapById(id: BasemapId): Basemap {
  return BASEMAPS.find((basemap) => basemap.id === id) ?? BASEMAPS[0];
}

export function styleFor(id: BasemapId): string {
  return basemapById(id).styleUrl;
}
