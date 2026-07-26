import type { StyleSpecification } from 'maplibre-gl';

/**
 * The three basemaps the staff map offers.
 *
 * All raster, all key-free. A vector style would look sharper, but it needs a
 * tile provider account and a WebGL feature set that the older hardware in a
 * municipality office does not reliably have — the same reasoning that kept
 * deck.gl out of this codebase.
 *
 * Satellite is first because it is the one staff actually reason with: a
 * cadastral parcel means little on a street map and a great deal over a roof.
 */
export type BasemapId = 'satellite' | 'light' | 'dark';

export interface Basemap {
  id: BasemapId;
  /** Arabic label shown in the switcher. */
  label: string;
  tiles: string[];
  attribution: string;
  maxzoom: number;
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
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Esri, Maxar, Earthstar Geographics',
    // Esri's imagery has no tiles past 19 here; asking for more returns blanks.
    maxzoom: 19,
    dark: true,
  },
  {
    id: 'light',
    label: 'خريطة فاتحة',
    tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors © CARTO',
    maxzoom: 20,
    dark: false,
  },
  {
    id: 'dark',
    label: 'خريطة داكنة',
    tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors © CARTO',
    maxzoom: 20,
    dark: true,
  },
] as const;

export const DEFAULT_BASEMAP: BasemapId = 'satellite';

export function basemapById(id: BasemapId): Basemap {
  return BASEMAPS.find((basemap) => basemap.id === id) ?? BASEMAPS[0];
}

/**
 * A complete MapLibre style for one basemap.
 *
 * `glyphs` is required even though the basemap itself is raster: the parcel
 * number layer is a symbol layer, and MapLibre renders no text at all without
 * a glyph source.
 */
export function styleFor(id: BasemapId): StyleSpecification {
  const basemap = basemapById(id);

  return {
    version: 8,
    // `fonts.openmaptiles.org` used to sit here and returned an HTML landing
    // page (HTTP 200, `text/html`) instead of a font protobuf for every
    // glyph request — confirmed with a direct curl, not a guess. MapLibre
    // does not treat that as a loud failure; the symbol layer just never
    // gets a font to render with, so parcel-number labels silently never
    // appear. `demotiles.maplibre.org` actually serves `.pbf` glyphs.
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      basemap: {
        type: 'raster',
        tiles: basemap.tiles,
        tileSize: 256,
        maxzoom: basemap.maxzoom,
        attribution: basemap.attribution,
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}
