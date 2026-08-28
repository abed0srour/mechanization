'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Map as MapIcon, Upload } from 'lucide-react';
import {
  ApiRequestError,
  getRegisteredParcels,
  importCadastre,
  logApiError,
  type CadastreImportResult,
} from '@/lib/api-client';
import type { RegisteredParcel, Session } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Button } from '@/components/ui/button';

/**
 * Mapbox GL JS plus a megabyte of cadastre GeoJSON, loaded only when a staff
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
 * `flex h-full flex-col`: a header in normal flow, the map filling exactly
 * the remainder via `flex-1`. `h-full` rather than `h-screen` because this
 * page now renders inside the admin sidebar layout's own `h-screen` flex
 * row — sizing to the viewport a second time here would just add a nested
 * scrollbar instead of filling the space the layout already gave it.
 */
export default function FullscreenMapPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [session, setSession] = useState<Session | null>(null);
  const [parcels, setParcels] = useState<RegisteredParcel[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Arriving from a citizen's profile ("عرض على الخريطة") carries where to
   * point the map: `parcel` when the property is a registered one (the common
   * case — flies in and opens the same drawer a marker click would), `lat`/
   * `lng` as a fallback the map can still pin even if the property number
   * doesn't resolve to a registered parcel.
   *
   * `useSearchParams` rather than reading `window.location.search` once on
   * mount: this page is one route (`/map`), so going from one citizen's pin
   * straight to another's — or back to the plain map and in again — changes
   * only the query string, which does not always remount this component. A
   * mount-only read went stale exactly in that case; this hook re-renders
   * whenever the query string itself changes, mount or not.
   */
  const searchParams = useSearchParams();
  const focus = useMemo(() => {
    const parcelNumber = searchParams.get('parcel') ?? undefined;
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    if (!parcelNumber && !(lat && lng)) return null;
    return {
      parcelNumber,
      lat: lat ? Number(lat) : undefined,
      lng: lng ? Number(lng) : undefined,
    };
  }, [searchParams]);

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<CadastreImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const token = session?.accessToken ?? null;

  useEffect(() => {
    const existing = loadSession(tenant);
    if (!existing || existing.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setSession(existing);
  }, [tenant, base, router]);

  const handleCadastreUpload = async (file: File) => {
    if (!token) return;
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await importCadastre(tenant, token, file);
      setUploadResult(result);
      // Reloads the map's static GeoJSON layers with the freshly written file —
      // otherwise the upload would silently require a full page reload to show.
      setRefreshToken((n) => n + 1);
      getRegisteredParcels(tenant, token).then((response) => setParcels(response.parcels));
    } catch (caught) {
      logApiError(caught);
      setUploadError(
        caught instanceof ApiRequestError ? caught.payload.message : 'تعذّر رفع الملف.',
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    getRegisteredParcels(tenant, token)
      .then((response) => {
        if (!cancelled) setParcels(response.parcels);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        logApiError(caught);
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
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-4 py-3">

        {session?.user.role === 'SUPER_ADMIN' ? (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".geojson,application/geo+json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleCadastreUpload(file);
              }}
            />
            <Button
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-4" aria-hidden />
              )}
              رفع ملف GeoJSON
            </Button>
          </div>
        ) : null}
      </header>

      {uploadResult ? (
        <p className="border-b bg-primary/5 px-4 py-2 text-sm">
          تم استيراد {uploadResult.parcelsImported} عقار و {uploadResult.linesImported} خط حدودي
          {uploadResult.parcelsSkipped > 0 ? ` (تم تجاوز ${uploadResult.parcelsSkipped} عنصر غير صالح)` : ''}
        </p>
      ) : null}
      {uploadError ? (
        <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {uploadError}
        </p>
      ) : null}

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
            token={token}
            parcels={parcels}
            citizenHref={(citizenId) => `${base}/citizens/${citizenId}`}
            refreshToken={refreshToken}
            focusParcelNumber={focus?.parcelNumber}
            focusLat={focus?.lat}
            focusLng={focus?.lng}
          />
        )}
      </div>
    </div>
  );
}
