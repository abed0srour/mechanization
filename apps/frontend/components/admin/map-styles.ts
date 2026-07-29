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
