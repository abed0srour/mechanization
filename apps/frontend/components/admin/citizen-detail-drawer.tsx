'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, MapPin, Phone, Search, User, Users, X } from 'lucide-react';
import { getLabels } from '@mechanization/shared-schemas';
import type { RegisteredParcel } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Past this many people, finding one by eye stops working. */
const SEARCH_THRESHOLD = 6;

export function CitizenDetailDrawer({
  parcel,
  citizenHref,
  onClose,
  locale = 'ar',
}: {
  parcel: RegisteredParcel | null;
  /** Builds the tenant-scoped profile URL for a citizen id. */
  citizenHref: (citizenId: string) => string;
  onClose: () => void;
  locale?: string;
}) {
  const labels = getLabels(locale);
  const [query, setQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!parcel) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [parcel, onClose]);

  useEffect(() => {
    if (!parcel) return;
    setQuery('');
    headingRef.current?.focus();
  }, [parcel]);

  const registrants = parcel?.registrants ?? [];

  const filtered = useMemo(() => {
    const list = parcel?.registrants ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (registrant) =>
        registrant.fullName.toLowerCase().includes(needle) ||
        (registrant.phone ?? '').includes(needle),
    );
  }, [parcel?.registrants, query]);

  if (!parcel) return null;

  const count = registrants.length;
  const searchable = count > SEARCH_THRESHOLD;

  return (
    <section
      aria-label={locale === 'en' ? `Registrants on Parcel ${parcel.propertyNumber}` : `المسجّلون على العقار ${parcel.propertyNumber}`}
      className={cn(
        'absolute z-30 flex flex-col overflow-hidden bg-card shadow-2xl duration-300 animate-in',
        'inset-x-0 bottom-0 max-h-[68dvh] rounded-t-2xl border-t slide-in-from-bottom',
        'sm:inset-y-0 sm:inset-x-auto sm:end-0 sm:max-h-none sm:w-[22rem] sm:rounded-none sm:border-s sm:border-t-0 sm:slide-in-from-bottom-0 sm:slide-in-from-right',
      )}
    >
      <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" />

      <header className="flex shrink-0 items-start gap-3 p-4 pb-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <MapPin className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="truncate text-base font-bold leading-tight outline-none"
          >
            {locale === 'en' ? 'Parcel ' : 'العقار '}
            <span dir="ltr">{parcel.propertyNumber}</span>
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5 shrink-0" aria-hidden />
            {count === 1
              ? (locale === 'en' ? '1 registered citizen' : 'مواطن واحد مسجّل')
              : (locale === 'en' ? `${count} registered citizens` : `${count} مواطنين مسجّلين`)}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={locale === 'en' ? 'Close' : 'إغلاق'}
          className="-me-1 shrink-0"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </header>

      {searchable ? (
        <div className="shrink-0 px-4 pb-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={locale === 'en' ? 'Search by name or phone…' : 'ابحث بالاسم أو الهاتف…'}
              aria-label={locale === 'en' ? 'Search occupants on this parcel' : 'ابحث في المسجّلين على هذا العقار'}
              className="h-10 ps-9"
            />
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {locale === 'en' ? 'No matching results.' : 'لا نتائج مطابقة لبحثك.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((registrant) => (
              <li key={registrant.registrationId}>
                <div className="group relative flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-accent focus-within:bg-accent">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
                  >
                    <User className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <Link
                      href={citizenHref(registrant.citizenId)}
                      className="block truncate font-semibold outline-none after:absolute after:inset-0 focus-visible:underline"
                    >
                      {registrant.fullName}
                    </Link>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="soft-muted" className="font-normal">
                        {labels.occupancyType[registrant.occupancyType as never] ??
                          registrant.occupancyType}
                      </Badge>
                      <Badge variant="soft-muted" className="font-normal">
                        {labels.propertyType[registrant.propertyType as never] ??
                          registrant.propertyType}
                      </Badge>
                      {registrant.unitCount > 0 ? (
                        <Badge variant="soft-muted" className="font-normal">
                          {registrant.unitCount} {locale === 'en' ? 'units' : 'وحدة'}
                        </Badge>
                      ) : null}
                    </div>

                    {registrant.buildingName ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {registrant.buildingName}
                      </p>
                    ) : null}

                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {registrant.phone ? (
                        <a
                          href={`tel:${registrant.phone}`}
                          dir="ltr"
                          className="relative z-10 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          <Phone className="size-3 shrink-0" aria-hidden />
                          {registrant.phone}
                        </a>
                      ) : null}
                      <span>
                        {locale === 'en' ? 'Registered ' : 'سُجّل '}
                        {formatDate(registrant.registeredAt)}
                      </span>
                    </p>
                  </div>

                  <ChevronLeft
                    aria-hidden
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
