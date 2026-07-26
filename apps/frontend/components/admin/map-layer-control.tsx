'use client';

import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BASEMAPS, type BasemapId } from './map-styles';

/**
 * Floating basemap switcher, pinned bottom-centre over the map canvas.
 *
 * It re-colours itself against the active basemap rather than sitting in a
 * fixed light chrome: a white pill over satellite imagery is a bright hole in
 * the middle of the data, and the same pill over the dark street map is worse.
 *
 * Segmented rather than a dropdown — three options, and switching basemap is
 * something staff do repeatedly while reading a parcel, so it should cost one
 * tap and never hide the current choice behind a menu.
 */
export function MapLayerControl({
  value,
  onChange,
  dark,
}: {
  value: BasemapId;
  onChange: (next: BasemapId) => void;
  /** Whether the *current* basemap is dark, so the control can invert. */
  dark: boolean;
}) {
  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2',
        'flex items-center gap-1 rounded-full border p-1 shadow-lg backdrop-blur',
        dark ? 'border-white/15 bg-black/60' : 'border-black/10 bg-white/85',
      )}
      role="group"
      aria-label="نمط الخريطة"
    >
      <Layers
        className={cn('ms-2 size-4 shrink-0', dark ? 'text-white/60' : 'text-black/40')}
        aria-hidden
      />

      {BASEMAPS.map((basemap) => {
        const active = basemap.id === value;
        return (
          <button
            key={basemap.id}
            type="button"
            onClick={() => onChange(basemap.id)}
            aria-pressed={active}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : dark
                  ? 'text-white/80 hover:bg-white/10'
                  : 'text-black/70 hover:bg-black/5',
            )}
          >
            {basemap.label}
          </button>
        );
      })}
    </div>
  );
}
