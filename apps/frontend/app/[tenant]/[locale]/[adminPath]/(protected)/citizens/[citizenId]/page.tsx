'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  Calendar,
  ExternalLink,
  FileDigit,
  FileText,
  Flag,
  Hash,
  Heart,
  Home,
  IdCard,
  Key,
  Layers,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Ruler,
  Tent,
  Trees,
  User,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { ar, REJECTABLE_FIELDS, type RejectableField } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  changeRegistrationStatus,
  getCitizenProfile,
  getDocumentViewUrl,
  logApiError,
} from '@/lib/api-client';
import type { CitizenProfile, CitizenProfileProperty } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { findLocatedProperty, mapHref } from '@/lib/map-link';
import { acceptStatusFor, isReviewable } from '@/lib/registration-status';
import {
  FieldFlag,
  FieldReviewProvider,
  flaggedClass,
  useFieldReview,
} from '@/components/admin/field-review';
import { ReviewBar } from '@/components/admin/review-bar';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** One glyph per property branch, so a card's kind is readable before its text. */
const PROPERTY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  BUILDING: Building2,
  HOUSE: Home,
  LAND: Trees,
  TENT: Tent,
};

interface FactItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: React.ReactNode;
  /** Latin-script content (numbers, phones) that must not mirror in RTL. */
  ltr?: boolean;
  /** Makes this value flaggable during a rejection. Omitted for fields the
   *  applicant cannot correct — a reference number, a system timestamp. */
  rejectKey?: RejectableField;
}

/**
 * Drops the facts this citizen has no value for.
 *
 * Filtering the *list* rather than having each field render itself as null is
 * what keeps the grids aligned: a self-nulling field still occupies no cell,
 * so the ones after it slide into different columns for every citizen, and no
 * two profiles line up the same way. Filtering first means the grid only ever
 * receives cells it will actually fill.
 */
function present(facts: FactItem[]): FactItem[] {
  return facts.filter((fact) => fact.value != null && fact.value !== '');
}

/**
 * One citizen and everything they have filed.
 *
 * The route is tenant- and admin-path-scoped (`/{tenant}/{locale}/{adminPath}/
 * citizens/{id}`) rather than a bare `/citizens/{id}`. Two reasons, both
 * structural: a citizen id alone does not say which municipality's schema to
 * read — the tenant boundary in this system is the database connection, not a
 * WHERE clause — and this page renders identity-document numbers and residency
 * status, which belong behind the same obscure staff path and role guard as
 * the rest of the portal.
 */
export default function CitizenProfilePage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string; citizenId: string }>;
}) {
  const { tenant, locale, adminPath, citizenId } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [citizen, setCitizen] = useState<CitizenProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  /** Registration whose rejection is being composed, if any. */
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<RejectableField>>(new Set());
  const [note, setNote] = useState('');
  /** Default: the citizen fixes the flagged fields online themselves. */
  const [allowCorrection, setAllowCorrection] = useState(true);
  const [revisitAt, setRevisitAt] = useState('');
  const [deciding, setDeciding] = useState(false);

  const toggleFlag = useCallback((field: RejectableField) => {
    setFlagged((previous) => {
      const next = new Set(previous);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  const resetReview = useCallback(() => {
    setRejectingId(null);
    setFlagged(new Set());
    setNote('');
    setAllowCorrection(true);
    setRevisitAt('');
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    setCitizen(await getCitizenProfile(tenant, token, citizenId));
  }, [tenant, token, citizenId]);

  /** One path for both decisions — they differ only in payload. */
  const decide = useCallback(
    async (registrationId: string, status: string) => {
      if (!token) return;
      setDeciding(true);
      try {
        await changeRegistrationStatus(tenant, token, registrationId, {
          status,
          ...(status === 'REJECTED'
            ? {
                reason: note.trim(),
                rejectedFields: [...flagged],
                allowCitizenCorrection: allowCorrection,
                // `datetime-local` has no zone; the browser's own offset is
                // the right one to assume for a visit to the town hall.
                ...(!allowCorrection && revisitAt
                  ? { revisitAt: new Date(revisitAt).toISOString() }
                  : {}),
              }
            : {}),
        });
        resetReview();
        await reload();
      } catch (caught) {
        logApiError(caught);
        // Left open on failure so a note that was just written is not lost.
        setError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر تحديث حالة الطلب.',
        );
      } finally {
        setDeciding(false);
      }
    },
    [tenant, token, note, flagged, resetReview, reload],
  );

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);

    getCitizenProfile(tenant, session.accessToken, citizenId)
      .then(setCitizen)
      .catch((caught: unknown) => {
        logApiError(caught);
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`${base}/login`);
          return;
        }
        setError(
          caught instanceof ApiRequestError && caught.status === 404
            ? 'لا يوجد مواطن بهذا المعرّف.'
            : 'تعذّر تحميل ملف المواطن.',
        );
      });
  }, [tenant, base, citizenId, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive">
          {error}
        </p>
        <Link href={`${base}/dashboard`} className={buttonVariants({ variant: 'outline' })}>
          رجوع إلى اللوحة
        </Link>
      </div>
    );
  }

  if (!citizen) {
    return (
      <p className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        جارٍ التحميل…
      </p>
    );
  }

  const propertyCount = citizen.registrations.reduce(
    (total, registration) => total + registration.properties.length,
    0,
  );

  // The property the top "عرض على الخريطة" button points at — the first one
  // with coordinates, across every registration in submission order. A
  // citizen with several properties still gets one obvious map action; the
  // rest get their own link inline where they're listed below.
  const locatedProperty = findLocatedProperty(
    citizen.registrations.flatMap((registration) => registration.properties),
  );

  const openDocument = async (documentId: string) => {
    if (!token) return;
    setOpeningDocId(documentId);
    try {
      const { url } = await getDocumentViewUrl(tenant, token, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      alert('تعذّر فتح الملف.');
    } finally {
      setOpeningDocId(null);
    }
  };

  return (
    <FieldReviewProvider
      value={{ active: rejectingId !== null, flagged, toggle: toggleFlag }}
    >
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Its own row above the header. Inside it, the avatar aligned to this
          link rather than to the name it belongs to, which is what left the
          circle floating above the heading. */}
      <Link
        href={`${base}/dashboard`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        رجوع إلى اللوحة
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div className="flex min-w-0 items-center gap-4">
          {/* A generic person glyph rather than the name's first letter: an
              initial reads as data the municipality holds about someone when
              it is really just decoration, and "ف" identifies nobody. */}
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20"
          >
            <User className="size-7" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h1 className="truncate text-3xl font-bold tracking-tight">{citizen.fullName}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <FileText className="size-3.5" aria-hidden />
                {citizen.registrations.length} طلب
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden />
                {propertyCount} عقار
              </span>
              {citizen.gender ? (
                <Badge variant="outline">{ar.gender[citizen.gender as never]}</Badge>
              ) : null}
              {citizen.residentStatus ? (
                <Badge variant="outline">
                  {ar.residentStatus[citizen.residentStatus as never]}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <Link
          href={locatedProperty ? mapHref(base, locatedProperty) : `${base}/map`}
          className={buttonVariants({ variant: 'outline' })}
          title={locatedProperty ? undefined : 'لم يتم تحديد موقع أي عقار لهذا المواطن بعد'}
        >
          <MapPin className="size-4" aria-hidden />
          عرض على الخريطة
        </Link>
      </div>

      {/*
        Four labelled groups rather than one twelve-field grid. The fields
        answer different questions — who they are, how to reach them, who is
        with them, what the municipality filed — and a reviewer is normally
        after exactly one of those, which a flat list makes them scan for.
      */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <IdCard className="size-5 text-primary" aria-hidden />
            البيانات الشخصية
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {/* Six fields — fills a three-column grid exactly, two rows deep. */}
          <FactSection
            title="الهوية"
            facts={[
              {
                icon: User,
                label: 'الاسم',
                value: citizen.fullName,
                rejectKey: 'personal.name',
              },
              {
                icon: User,
                label: 'الجنس',
                value: ar.gender[citizen.gender as never],
                rejectKey: 'personal.gender',
              },
              {
                icon: Flag,
                label: 'الجنسية',
                value: citizen.nationality,
                rejectKey: 'personal.nationality',
              },
              {
                icon: Home,
                label: 'صفة الإقامة',
                value: ar.residentStatus[citizen.residentStatus as never],
                rejectKey: 'personal.residentStatus',
              },
              {
                icon: IdCard,
                label: 'نوع وثيقة الإثبات',
                value: ar.identityDocType[citizen.identityDocType as never],
                rejectKey: 'personal.identityDocType',
              },
              {
                icon: FileDigit,
                label: 'رقم الوثيقة',
                value: citizen.identityDocNumber,
                ltr: true,
                rejectKey: 'personal.identityDocNumber',
              },
              citizen.isLebanese
                ? {
                    icon: FileDigit,
                    label: 'رقم السجل',
                    value: citizen.civilRecordNumber,
                    ltr: true,
                    rejectKey: 'personal.civilRecordNumber' as const,
                  }
                : {
                    icon: FileDigit,
                    label: 'رقم الإقامة',
                    value: citizen.residencyNumber,
                    ltr: true,
                    rejectKey: 'personal.residencyNumber' as const,
                  },
            ]}
          />

          {/*
            The remaining three groups hold two fields each. Stacked full-width
            like الهوية above, every one of them would span the card with an
            empty third alongside it — three sparse bands in a row. Sitting
            them side by side, each as a narrow column of two, fills the same
            width once instead of three times.
          */}
          <div className="grid gap-x-6 gap-y-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
            <FactSection
              stack
              title="التواصل"
              facts={[
                {
                  icon: Phone,
                  label: 'الهاتف',
                  value: citizen.phone ? <PhoneLink phone={citizen.phone} /> : null,
                  rejectKey: 'contact.phone',
                },
                {
                  icon: MessageCircle,
                  label: 'واتساب',
                  value: citizen.whatsapp ? <PhoneLink phone={citizen.whatsapp} /> : null,
                  rejectKey: 'contact.whatsapp',
                },
              ]}
            />

            <FactSection
              stack
              title="الأسرة"
              facts={[
                {
                  icon: Heart,
                  label: 'الحالة الاجتماعية',
                  value: citizen.maritalStatus
                    ? (ar.maritalStatus?.[citizen.maritalStatus as never] ?? citizen.maritalStatus)
                    : undefined,
                  rejectKey: 'contact.maritalStatus',
                },
                {
                  icon: Users,
                  label: 'عدد أفراد الأسرة',
                  value: citizen.familySize?.toString(),
                  rejectKey: 'contact.familySize',
                },
              ]}
            />

            <FactSection
              stack
              title="بيانات التسجيل"
              facts={[
                { icon: Hash, label: 'الرقم المرجعي', value: citizen.referenceNumber, ltr: true },
                {
                  icon: Calendar,
                  label: 'تاريخ أول تسجيل',
                  value: new Date(citizen.registeredAt).toLocaleDateString('ar-LB'),
                },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FileText className="size-5 text-primary" aria-hidden />
          الطلبات والعقارات
        </h2>

        {citizen.registrations.map((registration) => (
          <Card key={registration.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
              <div>
                <CardTitle className="font-mono text-base">
                  {/* Inline `<bdi>` for the same reason as `Fact` below. */}
                  <bdi dir="ltr">{registration.referenceNumber}</bdi>
                </CardTitle>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Calendar className="size-3.5" aria-hidden />
                  {new Date(registration.submittedAt).toLocaleDateString('ar-LB')}
                </p>
              </div>
              <StatusBadge
                status={registration.status}
                label={ar.reportStatus[registration.status as never] ?? registration.status}
              />
            </CardHeader>

            <CardContent className="space-y-4 pt-6">
              {registration.properties.map((property) => (
                <PropertyCard key={property.id} property={property} base={base} />
              ))}

              {registration.properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد عقارات في هذا الطلب.</p>
              ) : null}

              <div className="space-y-2 border-t pt-4">
                <SubHeading icon={FileText}>
                  المرفقات {registration.documents.length > 0 ? `(${registration.documents.length})` : ''}
                  <FieldFlag field="documents.other" />
                </SubHeading>
                {registration.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد مرفقات لهذا الطلب.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {registration.documents.map((document) => (
                      <li key={document.id}>
                        <button
                          type="button"
                          onClick={() => openDocument(document.id)}
                          disabled={openingDocId === document.id}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-start transition-colors hover:bg-muted/60 disabled:opacity-60"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate text-sm font-medium">
                              {ar.documentType?.[document.type as never] ?? document.type}
                            </span>
                          </span>
                          {openingDocId === document.id ? (
                            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                          ) : (
                            <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/*
                The decision, at the bottom of the thing being decided. Only
                shown while the claim is still open — an approved or already
                refused one has no move left, and the aggregate would refuse
                the transition anyway.
              */}
              {isReviewable(registration.status) ? (
                <div className="border-t pt-4">
                  <ReviewBar
                    acceptLabel={
                      ar.reportStatus[acceptStatusFor(registration.status) as never] ?? undefined
                    }
                    rejecting={rejectingId === registration.id}
                    flagged={[...flagged]}
                    note={note}
                    allowCitizenCorrection={allowCorrection}
                    revisitAt={revisitAt}
                    submitting={deciding}
                    onNoteChange={setNote}
                    onAllowCitizenCorrectionChange={setAllowCorrection}
                    onRevisitAtChange={setRevisitAt}
                    onStartRejecting={() => setRejectingId(registration.id)}
                    onCancelRejecting={resetReview}
                    onAccept={() => {
                      const next = acceptStatusFor(registration.status);
                      if (next) void decide(registration.id, next);
                    }}
                    onConfirmReject={() => void decide(registration.id, 'REJECTED')}
                    onUnflag={toggleFlag}
                  />
                </div>
              ) : null}

              {/* What was said last time, for a claim already refused. */}
              {registration.status === 'REJECTED' && registration.rejectionReason ? (
                <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                  <SubHeading icon={XCircle}>سبب الرفض</SubHeading>
                  <p className="text-sm">{registration.rejectionReason}</p>
                  {registration.rejectedFields.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {registration.rejectedFields.map((field) => (
                        <li key={field}>
                          <Badge variant="destructive">
                            {REJECTABLE_FIELDS[field as RejectableField] ?? field}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}

        {citizen.registrations.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-muted-foreground">
            لا توجد طلبات مسجّلة لهذا المواطن.
          </p>
        ) : null}
      </section>
    </div>
    </FieldReviewProvider>
  );
}

/**
 * One property card, rendering whichever of the wizard's four branches this
 * property came from. Every field is conditional because the branches share
 * only الحي and رقم العقار — a plot has a land type and no floor, a tent has
 * a written location and neither.
 *
 * Sections are separated by rules (`divide-y`) rather than by nesting another
 * bordered box inside this one: at three levels deep (registration → property
 * → landlord) the boxes-in-boxes read as clutter well before they read as
 * structure.
 */
function PropertyCard({
  property,
  base,
}: {
  property: CitizenProfileProperty;
  base: string;
}) {
  const Icon = PROPERTY_ICON[property.propertyType] ?? Building2;
  const isTenant = property.occupancyType === 'TENANT';

  const details = present([
    {
      icon: Hash,
      label: 'رقم العقار',
      value: property.propertyNumber,
      ltr: true,
      rejectKey: 'property.propertyNumber',
    },
    {
      icon: MapPin,
      label: 'الحي',
      value: property.neighborhood,
      rejectKey: 'property.neighborhood',
    },
    {
      icon: Building2,
      label: 'اسم المبنى',
      value: property.buildingName,
      rejectKey: 'property.buildingName',
    },
    {
      icon: Trees,
      label: 'نوع الأرض',
      value: property.landType
        ? (ar.landType[property.landType as never] ?? property.landType)
        : null,
      rejectKey: 'property.propertyType',
    },
    {
      icon: Home,
      label: 'نوع الوحدة',
      value: property.unitType
        ? (ar.unitType[property.unitType as never] ?? property.unitType)
        : null,
      rejectKey: 'property.propertyType',
    },
    { icon: Layers, label: 'الطابق', value: property.floor, rejectKey: 'property.units' },
    { icon: MapPin, label: 'الجهة', value: property.side, rejectKey: 'property.units' },
    {
      icon: Ruler,
      label: 'المساحة',
      value: property.unitArea != null ? `${property.unitArea} م²` : null,
      rejectKey: 'property.unitArea',
    },
    {
      icon: Tent,
      label: 'موقع الخيمة',
      value: property.tentLocation,
      rejectKey: 'property.location',
    },
    {
      icon: Key,
      label: 'الحقوق المشتركة',
      value: property.sharedRights.length > 0 ? property.sharedRights.join('، ') : null,
      rejectKey: 'property.units',
    },
  ]);

  const landlord = present([
    {
      icon: User,
      label: 'اسم المالك',
      value: property.landlordName,
      rejectKey: 'property.landlord',
    },
    {
      icon: Phone,
      label: 'هاتف المالك',
      value: property.landlordPhone ? <PhoneLink phone={property.landlordPhone} /> : null,
      rejectKey: 'property.landlord',
    },
  ]);

  return (
    <div className="divide-y rounded-lg border bg-muted/20">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="font-semibold">
              العقار رقم{' '}
              <span dir="ltr" className="font-mono">
                {property.propertyNumber}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">
                {ar.propertyType[property.propertyType as never] ?? property.propertyType}
              </Badge>
              <FieldFlag field="property.propertyType" />
              <Badge variant={isTenant ? 'warning' : 'outline'}>
                {ar.occupancyType[property.occupancyType as never] ?? property.occupancyType}
              </Badge>
              <FieldFlag field="property.occupancyType" />
            </div>
          </div>
        </div>

        {property.latitude != null ? (
          <Link
            href={mapHref(base, property)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <MapPin className="size-3.5" aria-hidden />
            عرض على الخريطة
          </Link>
        ) : null}
      </div>

      {details.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((fact) => (
            <Fact key={fact.label} {...fact} />
          ))}
        </dl>
      ) : null}

      {/* A tenant's claim is only reviewable alongside who they rent from —
          the wizard requires both fields, and staff previously saw neither. */}
      {isTenant && landlord.length > 0 ? (
        <div className="space-y-3 p-4">
          <SubHeading icon={UserCheck}>المالك</SubHeading>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {landlord.map((fact) => (
              <Fact key={fact.label} {...fact} />
            ))}
          </dl>
        </div>
      ) : null}

      {/* Owning a whole building is one عقار with many units. The count alone
          said nothing about which floors were claimed. */}
      {property.units.length > 0 ? (
        <div className="space-y-3 p-4">
          <SubHeading icon={Layers}>
            الوحدات ({property.units.length})
            <FieldFlag field="property.units" />
          </SubHeading>
          <ul className="divide-y rounded-lg border bg-background">
            {property.units.map((unit) => (
              <li key={unit.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <Badge variant="secondary" className="shrink-0">
                  {ar.unitType[unit.unitType as never] ?? unit.unitType}
                </Badge>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Layers className="size-3.5 shrink-0" aria-hidden />
                  الطابق {unit.floor}
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Ruler className="size-3.5 shrink-0" aria-hidden />
                  {unit.unitArea} م²
                </span>
                {unit.side ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" aria-hidden />
                    {unit.side}
                  </span>
                ) : null}
                {unit.sharedRights.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Key className="size-3.5 shrink-0" aria-hidden />
                    {unit.sharedRights.join('، ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A labelled block of facts, absent entirely when the citizen has none of them.
 *
 * `stack` is for the narrow groups that sit side by side as columns: they
 * supply their own spacing from the parent grid, so this adds neither padding
 * nor a second grid inside a grid cell one column wide.
 */
function FactSection({
  title,
  facts,
  stack = false,
}: {
  title: string;
  facts: FactItem[];
  stack?: boolean;
}) {
  const shown = present(facts);
  if (shown.length === 0) return null;
  return (
    <div className={stack ? 'space-y-3' : 'space-y-3 p-6'}>
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      <dl className={stack ? 'space-y-4' : 'grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3'}>
        {shown.map((fact) => (
          <Fact key={fact.label} {...fact} />
        ))}
      </dl>
    </div>
  );
}

/** Small icon + label heading used inside a property or attachment block. */
function SubHeading({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </p>
  );
}

/** Click-to-call, kept LTR so the number is not mirrored in an RTL page. */
function PhoneLink({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone}`} dir="ltr" className="font-medium text-primary hover:underline">
      {phone}
    </a>
  );
}

/** One labelled value: caption above, value below, so long Arabic labels and
 *  Latin numbers never have to share a baseline. */
function Fact({ icon: Icon, label, value, ltr, rejectKey }: FactItem) {
  const review = useFieldReview();
  return (
    <div className={cn('min-w-0', flaggedClass(review, rejectKey))}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
        {rejectKey ? <FieldFlag field={rejectKey} /> : null}
      </dt>
      <dd className="mt-1 break-words font-medium">
        {/*
          `dir` belongs on an inline `<bdi>`, never on the block `<dd>`. A
          block element carrying dir="ltr" also flips its text-align to left,
          so a document number sat at the far edge of its cell while the
          Arabic caption above stayed at the right — the two looked like they
          belonged to different fields. `<bdi>` isolates the digits so they
          still read left-to-right, while the line itself keeps the page's RTL
          alignment and stays under its own label.
        */}
        {ltr ? <bdi dir="ltr">{value}</bdi> : value}
      </dd>
    </div>
  );
}
