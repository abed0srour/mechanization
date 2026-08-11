'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Phone, User, Users, X } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import type { RegisteredParcel } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Everyone registered on one parcel, in a panel over the map.
 *
 * An inline panel inside the map container rather than a page-level modal:
 * this describes the marker that opened it, so the map has to stay visible and
 * usable behind it — staff compare neighbouring parcels constantly, and a
 * scrim plus a body-scroll lock makes that a close-and-reopen loop. It was a
 * `role="dialog" aria-modal="true"` sheet with no focus trap and no focus
 * restore, which is the worst of both: assistive tech hid the rest of the page
 * while the keyboard could still walk out of the panel.
 *
 * Pinned physically right in both text directions — the map's own nav/scale
 * controls sit top/bottom-left (see `fullscreen-map.tsx`) to leave this edge
 * clear for it.
 *
 * A parcel with several people on it is the expected case, not an edge one —
 * an apartment building is one cadastral number — so the list is the primary
 * content and is built to scroll.
 */
export function CitizenDetailDrawer({
  parcel,
  citizenHref,
  onClose,
}: {
  parcel: RegisteredParcel | null;
  /** Builds the tenant-scoped profile URL for a citizen id. */
  citizenHref: (citizenId: string) => string;
  onClose: () => void;
}) {
  // Escape still closes it. Dropping the modal semantics is not a reason to
  // drop the one keyboard affordance every overlay is expected to have.
  useEffect(() => {
    if (!parcel) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [parcel, onClose]);

  if (!parcel) return null;

  const count = parcel.registrants.length;

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l bg-card shadow-xl duration-300 animate-in slide-in-from-right">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Users className="size-5 text-primary" aria-hidden />
            العقار رقم {parcel.propertyNumber}
          </h2>
          <p className="text-xs text-muted-foreground">
            {count === 1
              ? 'مواطن واحد مسجّل على هذا العقار'
              : `${count} مواطنين مسجّلين على هذا العقار`}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
          <X className="size-5" aria-hidden />
        </Button>
      </div>

      {/* Only the list scrolls, so a long co-owner list never pushes the
          header out of reach. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="space-y-3">
          {parcel.registrants.map((registrant) => (
            <li key={registrant.registrationId}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
                      >
                        <User className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{registrant.fullName}</p>
                        <p className="text-sm text-muted-foreground">
                          {ar.occupancyType[registrant.occupancyType as never] ??
                            registrant.occupancyType}
                          {' · '}
                          {ar.propertyType[registrant.propertyType as never] ??
                            registrant.propertyType}
                          {registrant.buildingName ? ` · ${registrant.buildingName}` : ''}
                          {registrant.unitCount > 0 ? ` · ${registrant.unitCount} وحدة` : ''}
                        </p>
                      </div>
                    </div>

                  </div>

                  <dl className="space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">تاريخ التسجيل</dt>
                      <dd>{formatDate(registrant.registeredAt)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">الهاتف</dt>
                      <dd>
                        {registrant.phone ? (
                          <a
                            href={`tel:${registrant.phone}`}
                            dir="ltr"
                            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                          >
                            <Phone className="size-3.5" aria-hidden />
                            {registrant.phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                  </dl>

                  <Link
                    href={citizenHref(registrant.citizenId)}
                    className={buttonVariants({ className: 'w-full' })}
                  >
                    عرض ملف المواطن
                    <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
