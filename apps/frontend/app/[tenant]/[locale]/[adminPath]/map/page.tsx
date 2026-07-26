'use client';

import { use, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, Map as MapIcon } from 'lucide-react';
import { ApiRequestError, getRegisteredParcels } from '@/lib/api-client';
import type { RegisteredParcel } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Button } from '@/components/ui/button';

/**
 * MapLibre plus a megabyte of cadastre GeoJSON, loaded only when a staff
 * member opens this route — never on the citizen wizard, which is the bundle
 * that actually matters.
 */
const FullscreenMap = dynamic(
  () => import('@/components/admin/fullscreen-map').then((m) => m.FullscreenMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        جاري تهيئة الخريطة…
      </div>
    ),
  },
);

/**
 * `flex h-screen flex-col`: a header in normal flow, the map filling exactly
 * the remainder via `flex-1`. Copied from the sibling Mechanization project's
 * `/map` route rather than reached for independently — its map is proven to
 * render, and the map that used to live here (`position: fixed` inside the
 * citizen layout's `max-w-3xl` column) did not. A flex column that reaches
 * the viewport edge directly has no equivalent failure mode: there is no
 * ancestor `transform`/`filter` that can silently turn `fixed` into
 * "relative to some div" instead of "relative to the viewport".
 */
export default function FullscreenMapPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [parcels, setParcels] = useState<RegisteredParcel[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
  }, [tenant, base, router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    getRegisteredParcels(tenant, token)
      .then((response) => {
        if (!cancelled) setParcels(response.parcels);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`${base}/login`);
          return;
        }
        setError('تعذّر تحميل بيانات الخريطة.');
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, token, base, router]);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-4 py-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <MapIcon className="size-5 text-primary" aria-hidden />
            الخريطة العقارية
          </h1>
          <p className="text-xs text-muted-foreground">
            نقاط تفاعلية فقط على العقارات التي لديها تسجيلات
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`${base}/dashboard`}>
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            رجوع إلى اللوحة
          </Link>
        </Button>
      </header>

      <div className="relative flex-1">
        {!token ? null : error ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4">
            <p role="alert" className="text-destructive">
              {error}
            </p>
            <Button variant="outline" onClick={() => router.push(`${base}/dashboard`)}>
              رجوع إلى اللوحة
            </Button>
          </div>
        ) : (
          <FullscreenMap
            tenant={tenant}
            parcels={parcels}
            citizenHref={(citizenId) => `${base}/citizens/${citizenId}`}
          />
        )}
      </div>
    </main>
  );
}
