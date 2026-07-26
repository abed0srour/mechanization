'use client';

import Link from 'next/link';
import { ArrowLeft, Phone, User } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import type { RegisteredParcel } from '@/lib/api-client';
import { Badge, STATUS_BADGE_VARIANT } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';

/**
 * Everyone registered on one parcel, in a drawer over the map.
 *
 * Pinned physically left regardless of text direction. The marker that opened
 * it stays visible on the right of the canvas, so the panel reads as attached
 * to the thing it describes rather than as a page-level dialog.
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
  const count = parcel?.registrants.length ?? 0;

  return (
    <Sheet
      open={parcel !== null}
      onClose={onClose}
      side="left"
      title={parcel ? `العقار رقم ${parcel.propertyNumber}` : ''}
      description={
        count === 1 ? 'مواطن واحد مسجّل على هذا العقار' : `${count} مواطنين مسجّلين على هذا العقار`
      }
    >
      {parcel ? (
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

                    <Badge variant={STATUS_BADGE_VARIANT[registrant.status] ?? 'secondary'}>
                      {ar.reportStatus[registrant.status as never] ?? registrant.status}
                    </Badge>
                  </div>

                  <dl className="space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">تاريخ التسجيل</dt>
                      <dd>{new Date(registrant.registeredAt).toLocaleDateString('ar-LB')}</dd>
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
      ) : null}
    </Sheet>
  );
}
