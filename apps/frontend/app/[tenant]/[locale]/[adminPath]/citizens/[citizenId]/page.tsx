'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, MapPin, Phone } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import { ApiRequestError, getCitizenProfile } from '@/lib/api-client';
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

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }

    getCitizenProfile(tenant, session.accessToken, citizenId)
      .then(setCitizen)
      .catch((caught: unknown) => {
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
