'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, MapPin, Phone, Search, User, Users, X } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import type { RegisteredParcel } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Past this many people, finding one by eye stops working. */
const SEARCH_THRESHOLD = 6;

/**
 * Everyone registered on one parcel.
 *
 * **A bottom sheet on a phone, a side panel from `sm` up.** That split is the
 * point of this component. As one panel it was `w-full max-w-sm`, which on a
 * 390px screen is the entire map — a clerk who tapped a marker to ask "who is
 * here" lost the *here* completely, and the only way back was to close the
 * thing they had just opened. A sheet rising from the bottom leaves the marker
 * and its surroundings visible above it, which is the arrangement every map
 * application settled on for the same reason.
 *
 * An inline panel inside the map container rather than a page-level modal:
 * this describes the marker that opened it, so the map has to stay usable
 * behind it — staff compare neighbouring parcels constantly, and a scrim plus
 * a body-scroll lock makes that a close-and-reopen loop. It was a
 * `role="dialog" aria-modal="true"` sheet with no focus trap and no focus
 * restore, which is the worst of both: assistive tech hid the rest of the page
 * while the keyboard could still walk out of the panel.
 *
 * On `sm` and up it is pinned physically right in both text directions — the
 * map's own nav and scale controls sit on the left (see `fullscreen-map.tsx`)
 * to leave that edge clear.
 *
 * A parcel with several people on it is the expected case, not an edge one: an
 * apartment building is one cadastral number, and the buildings here run to
 * dozens of units.
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
  const [query, setQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  /*
   * A new parcel is a new list: the previous filter would otherwise carry over
   * and show "no results" for a parcel whose occupants are all perfectly
   * present. Focus moves to the heading for the same reason — a screen reader
   * user who activated a marker should hear which parcel answered.
   */
  useEffect(() => {
    if (!parcel) return;
    setQuery('');
    headingRef.current?.focus();
  }, [parcel?.propertyNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const registrants = parcel?.registrants ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return registrants;
    return registrants.filter(
      (registrant) =>
        registrant.fullName.toLowerCase().includes(needle) ||
        (registrant.phone ?? '').includes(needle),
    );
  }, [registrants, query]);

  if (!parcel) return null;

  const count = registrants.length;
  const searchable = count > SEARCH_THRESHOLD;

  return (
    <section
      aria-label={`المسجّلون على العقار ${parcel.propertyNumber}`}
      className={cn(
        'absolute z-30 flex flex-col overflow-hidden bg-card shadow-2xl duration-300 animate-in',
        // Phone: a sheet off the bottom edge, capped so the map keeps a third
        // of the screen. `dvh` rather than `vh` so a mobile browser's
        // collapsing address bar does not push the sheet's foot out of reach.
        'inset-x-0 bottom-0 max-h-[68dvh] rounded-t-2xl border-t slide-in-from-bottom',
        // `sm` and up: the full-height rail it always was.
        'sm:inset-y-0 sm:inset-x-auto sm:end-0 sm:max-h-none sm:w-[22rem] sm:rounded-none sm:border-s sm:border-t-0 sm:slide-in-from-bottom-0 sm:slide-in-from-right',
      )}
    >
      {/*
        The grab bar is decoration, not a control — the sheet does not drag.
        It is here because a rounded top edge with nothing on it reads as a
        rendering artefact, and this shape is what tells a phone user the panel
        is a sheet rather than a page that failed to fill the screen.
      */}
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
            العقار <span dir="ltr">{parcel.propertyNumber}</span>
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5 shrink-0" aria-hidden />
            {count === 1 ? 'مواطن واحد مسجّل' : `${count} مواطنين مسجّلين`}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="إغلاق"
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
              placeholder="ابحث بالاسم أو الهاتف…"
              aria-label="ابحث في المسجّلين على هذا العقار"
              className="h-10 ps-9"
            />
          </div>
        </div>
      ) : null}

      {/* Only the list scrolls, so the parcel number and the count stay put
          however many people are on it. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            لا نتائج مطابقة لبحثك.
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((registrant) => (
              <li key={registrant.registrationId}>
                {/*
                  One tappable row per person, replacing a card that carried a
                  two-row definition list and a full-width button each. Four
                  neighbours used to be a scroll; an apartment building was a
                  long one.

                  `relative` + the stretched link below: the whole row opens the
                  profile, while the phone number stays its own tap target. A
                  nested <a> would be invalid HTML and, on a phone, an
                  unhittable 3mm strip inside a much larger link.
                */}
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
                        {ar.occupancyType[registrant.occupancyType as never] ??
                          registrant.occupancyType}
                      </Badge>
                      <Badge variant="soft-muted" className="font-normal">
                        {ar.propertyType[registrant.propertyType as never] ??
                          registrant.propertyType}
                      </Badge>
                      {registrant.unitCount > 0 ? (
                        <Badge variant="soft-muted" className="font-normal">
                          {registrant.unitCount} وحدة
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
                        // `relative z-10` lifts it out of the stretched link's
                        // reach so tapping the number dials instead of opening
                        // the profile.
                        <a
                          href={`tel:${registrant.phone}`}
                          dir="ltr"
                          className="relative z-10 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          <Phone className="size-3 shrink-0" aria-hidden />
                          {registrant.phone}
                        </a>
                      ) : null}
                      <span>سُجّل {formatDate(registrant.registeredAt)}</span>
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
