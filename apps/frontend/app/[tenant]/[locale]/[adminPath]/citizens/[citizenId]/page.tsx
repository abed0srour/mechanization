'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ExternalLink, FileText, Loader2, MapPin, Phone } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import { ApiRequestError, getCitizenProfile, getDocumentViewUrl, logApiError } from '@/lib/api-client';
import type { CitizenProfile } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge, STATUS_BADGE_VARIANT } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`${base}/dashboard`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            رجوع إلى اللوحة
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{citizen.fullName}</h1>
          <p className="text-muted-foreground">
            {citizen.registrations.length} طلب · {propertyCount} عقار
          </p>
        </div>

        <Link href={`${base}/map`} className={buttonVariants({ variant: 'outline' })}>
          <MapPin className="size-4" aria-hidden />
          عرض على الخريطة
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">البيانات الشخصية</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Row label="الرقم المرجعي" value={citizen.referenceNumber} ltr />
            <Row
              label="الهاتف"
              value={
                citizen.phone ? (
                  <a
                    href={`tel:${citizen.phone}`}
                    dir="ltr"
                    className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                  >
                    <Phone className="size-3.5" aria-hidden />
                    {citizen.phone}
                  </a>
                ) : null
              }
            />
            <Row label="واتساب" value={citizen.whatsapp} ltr />
            <Row label="الجنس" value={ar.gender[citizen.gender as never]} />
            <Row
              label="صفة الإقامة"
              value={ar.residentStatus[citizen.residentStatus as never]}
            />
            <Row label="الجنسية" value={citizen.nationality} />
            <Row
              label="نوع وثيقة الإثبات"
              value={ar.identityDocType[citizen.identityDocType as never]}
            />
            <Row label="رقم الوثيقة" value={citizen.identityDocNumber} ltr />
            {citizen.isLebanese ? (
              <Row label="رقم السجل" value={citizen.civilRecordNumber} ltr />
            ) : (
              <Row label="رقم الإقامة" value={citizen.residencyNumber} ltr />
            )}
            <Row label="عدد أفراد الأسرة" value={citizen.familySize?.toString()} />
            <Row
              label="الحالة الاجتماعية"
              value={
                citizen.maritalStatus
                  ? (ar.maritalStatus?.[citizen.maritalStatus as never] ?? citizen.maritalStatus)
                  : undefined
              }
            />
            <Row
              label="تاريخ أول تسجيل"
              value={new Date(citizen.registeredAt).toLocaleDateString('ar-LB')}
            />
          </dl>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">الطلبات والعقارات</h2>

        {citizen.registrations.map((registration) => (
          <Card key={registration.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
              <div>
                <CardTitle className="text-base" dir="ltr">
                  {registration.referenceNumber}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {new Date(registration.submittedAt).toLocaleDateString('ar-LB')}
                </p>
              </div>
              <Badge variant={STATUS_BADGE_VARIANT[registration.status] ?? 'secondary'}>
                {ar.reportStatus[registration.status as never] ?? registration.status}
              </Badge>
            </CardHeader>

            <CardContent className="space-y-3 pt-5">
              {registration.properties.map((property) => (
                <div
                  key={property.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      العقار رقم <span dir="ltr">{property.propertyNumber}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {ar.propertyType[property.propertyType as never] ?? property.propertyType}
                      {' · '}
                      {ar.occupancyType[property.occupancyType as never] ??
                        property.occupancyType}
                      {property.neighborhood ? ` · ${property.neighborhood}` : ''}
                      {property.buildingName ? ` · ${property.buildingName}` : ''}
                      {property.unitCount > 0 ? ` · ${property.unitCount} وحدة` : ''}
                      {property.unitArea ? ` · ${property.unitArea} م²` : ''}
                    </p>
                  </div>

                  {property.latitude != null ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5" aria-hidden />
                      محدّد على الخريطة
                    </span>
                  ) : null}
                </div>
              ))}

              {registration.properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد عقارات في هذا الطلب.</p>
              ) : null}

              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">المرفقات</p>
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
                          className="flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-start hover:bg-muted/60 disabled:opacity-60"
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
  );
}

function Row({
  label,
  value,
  ltr,
}: {
  label: string;
  value?: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b pb-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium" dir={ltr ? 'ltr' : undefined}>
        {value || '—'}
      </dd>
    </div>
  );
}
