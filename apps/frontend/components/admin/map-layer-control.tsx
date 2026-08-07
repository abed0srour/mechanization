'use client';

import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BASEMAPS, type BasemapId } from './map-styles';

/**
 * Floating basemap switcher, pinned bottom-centre over the map canvas.
 *
 * Chrome is the same `bg-card/95` surface every other floating panel on this
 * screen uses, rather than a bespoke light/dark pair keyed off the active
 * basemap. One card surface over imagery reads as part of the app instead of
 * as map furniture, and it is the only treatment that follows the design
 * tokens when a municipality overrides its palette.
 *
 * Segmented rather than a dropdown — three options, and switching basemap is
 * something staff do repeatedly while reading a parcel, so it should cost one
 * tap and never hide the current choice behind a menu.
 */
export function MapLayerControl({
  value,
  onChange,
}: {
  value: BasemapId;
  onChange: (next: BasemapId) => void;
}) {
  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2',
        // Centred by transform, so nothing else bounds its width — the `max-w`
        // is what keeps three basemap labels from running off both edges of a
        // phone, and `flex-wrap` is what they do instead.
        'flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-1 rounded-lg border bg-card/95 p-1 shadow-lg backdrop-blur',
      )}
      role="group"
      aria-label="نمط الخريطة"
    >
      <Layers className="ms-2 size-4 shrink-0 text-muted-foreground" aria-hidden />

      {BASEMAPS.map((basemap) => {
        const active = basemap.id === value;
        return (
          <Button
            key={basemap.id}
            variant={active ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onChange(basemap.id)}
            aria-pressed={active}
            // Override the button's default radius to fit the segmented control.
            className={cn('rounded-md', active ? 'shadow-sm' : 'text-muted-foreground')}
          >
            {basemap.label}
          </Button>
        );
      })}
    </div>
  );
}
