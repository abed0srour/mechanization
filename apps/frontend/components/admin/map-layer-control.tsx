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
  locale = 'ar',
}: {
  value: BasemapId;
  onChange: (next: BasemapId) => void;
  locale?: string;
}) {
  const getLabel = (id: BasemapId) => {
    if (locale === 'en') {
      switch (id) {
        case 'satellite':
          return 'Satellite';
        case 'light':
          return 'Light';
        case 'dark':
          return 'Dark';
      }
    }
    switch (id) {
      case 'satellite':
        return 'قمر صناعي';
      case 'light':
        return 'خريطة فاتحة';
      case 'dark':
        return 'خريطة داكنة';
    }
  };

  /**
   * The same three options at phone width, where the full labels put a 240px
   * control on a 360px screen and push it into the scale bar. Shortened rather
   * than reduced to icons: «قمر / فاتحة / داكنة» still names the choice, and
   * three unlabelled squares would not.
   */
  const getShortLabel = (id: BasemapId) => {
    if (locale === 'en') {
      switch (id) {
        case 'satellite':
          return 'Sat';
        case 'light':
          return 'Light';
        case 'dark':
          return 'Dark';
      }
    }
    switch (id) {
      case 'satellite':
        return 'قمر';
      case 'light':
        return 'فاتحة';
      case 'dark':
        return 'داكنة';
    }
  };

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 sm:bottom-6',
        'flex max-w-[calc(100vw-1rem)] items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-lg backdrop-blur',
        'transition-[bottom] duration-300',
        // Clears the parcel sheet, which tops out at 75dvh on a phone.
        'group-data-[sheet-open]/map:bottom-[calc(75dvh_+_0.75rem)] sm:group-data-[sheet-open]/map:bottom-6',
      )}
      role="group"
      aria-label={locale === 'en' ? 'Map style' : 'نمط الخريطة'}
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
            className={cn(
              'h-9 rounded-md px-2.5 text-xs sm:h-8 sm:px-3 sm:text-sm',
              active ? 'shadow-sm' : 'text-muted-foreground',
            )}
          >
            <span className="sm:hidden">{getShortLabel(basemap.id)}</span>
            <span className="hidden sm:inline">{getLabel(basemap.id)}</span>
          </Button>
        );
      })}
    </div>
  );
}
