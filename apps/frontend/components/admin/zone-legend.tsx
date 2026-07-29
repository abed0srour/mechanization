'use client';

import { Layers, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ZoneSummary } from '@/lib/api-client';

/**
 * Which sector each colour on the map means, and a switch to take them all off.
 *
 * Hiding is all-or-nothing rather than per-zone: the legend exists to answer
 * "what am I looking at", and a per-zone visibility matrix turns reading it
 * into its own task. Staff who want one sector alone filter the map instead.
 */
export function ZoneLegend({
  zones,
  visible,
  onVisibleChange,
  activeZoneId,
  onSelectZone,
}: {
  zones: ZoneSummary[];
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  /** Highlighted row, when the map is filtered to one sector. */
  activeZoneId?: string | null;
  onSelectZone?: (zoneId: string | null) => void;
}) {
  if (zones.length === 0) return null;

  return (
    /* Physical right, below the registered-parcel counter. Not the logical
       `end-3`: under RTL that resolves to the left edge, where Mapbox's own
       zoom and compass controls live, and the panel covered them. */
    <div className="absolute right-3 top-24 z-10 w-56 overflow-hidden rounded-lg border bg-card/95 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Layers className="size-4 text-primary" aria-hidden />
          القطاعات
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => onVisibleChange(!visible)}
          aria-label={visible ? 'إخفاء القطاعات' : 'إظهار القطاعات'}
          aria-pressed={visible}
        >
          {visible ? (
            <Eye className="size-4" aria-hidden />
          ) : (
            <EyeOff className="size-4 text-muted-foreground" aria-hidden />
          )}
        </Button>
      </div>

      {visible ? (
        <ul className="max-h-64 overflow-y-auto py-1">
          {zones.map((zone) => {
            const active = activeZoneId === zone.id;
            return (
              <li key={zone.id}>
                <button
                  type="button"
                  onClick={() => onSelectZone?.(active ? null : zone.id)}
                  disabled={!onSelectZone}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs transition-colors ${
                    active ? 'bg-accent font-bold' : 'hover:bg-accent/60'
                  } ${onSelectZone ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span
                    className="size-3 shrink-0 rounded-sm border border-black/20"
                    style={{ backgroundColor: zone.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{zone.name}</span>
                  <span className="shrink-0 text-muted-foreground" dir="ltr">
                    {zone.parcelCount}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
