'use client';

import { use, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  changeRegistrationStatus,
  getDashboardCounters,
  getSpatialData,
  listForReview,
} from '@/lib/api-client';
import type {
  DashboardCounters,
  RegistrationListItem,
  SpatialFeature,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge, STATUS_BADGE_VARIANT } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * MapLibre and a megabyte of cadastre GeoJSON load only for staff who reach the
 * dashboard — never on the citizen wizard, which is the bundle that matters.
 */
const PropertyMapPanel = dynamic(
  () => import('@/components/admin/property-map-panel').then((m) => m.PropertyMapPanel),
  {
    ssr: false,
    loading: () => <p className="text-muted-foreground">جارٍ تحميل الخريطة…</p>,
  },
);

const STATUSES = ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED'] as const;

/**
 * "No filter" needs a value of its own: a Radix SelectItem cannot carry an empty
 * string, which is what the list endpoint wants for "every status".
 */
const ALL_STATUSES = 'ALL';

export default function StaffDashboard({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [counters, setCounters] = useState<DashboardCounters | null>(null);
  const [items, setItems] = useState<RegistrationListItem[]>([]);
  const [features, setFeatures] = useState<SpatialFeature[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`/${tenant}/${locale}/${adminPath}/login`);
      return;
    }
    setToken(session.accessToken);
    setRole(session.user.role);
  }, [tenant, locale, adminPath, router]);

  const signOut = useCallback(() => {
    clearSession(tenant);
    router.replace(`/${tenant}/${locale}/${adminPath}/login`);
  }, [tenant, locale, adminPath, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [countersResult, listResult, mapResult] = await Promise.all([
        getDashboardCounters(tenant, token),
        listForReview(tenant, token, { status: filter || undefined }),
        getSpatialData(tenant, token),
      ]);
      setCounters(countersResult);
      setItems(listResult.items);
      setFeatures(mapResult.features);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        signOut();
        return;
      }
      setError('تعذّر تحميل البيانات.');
    }
  }, [tenant, token, filter, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(id: string, status: string) {
    if (!token) return;

    // Rejection must carry a reason — the domain refuses one without it, so
    // asking here avoids a round-trip that can only fail.
    const reason =
      status === 'REJECTED' ? (prompt('سبب الرفض (إلزامي):') ?? '').trim() : undefined;
    if (status === 'REJECTED' && !reason) return;

    try {
      await changeRegistrationStatus(tenant, token, id, { status, reason });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر تغيير الحالة.');
    }
  }

  if (!token) return null;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">لوحة البلدية</h1>
          <p className="text-muted-foreground">{role ? `الصلاحية: ${role}` : null}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Export is SUPER_ADMIN/AUDITOR only server-side; hidden here too so
              the button is not offered to someone it will refuse. */}
          {role === 'SUPER_ADMIN' || role === 'AUDITOR' ? (
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/t/${tenant}/dashboard/export.csv${filter ? `?status=${filter}` : ''}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              تصدير CSV
            </a>
          ) : null}
          <Button variant="ghost" onClick={signOut}>
            خروج
          </Button>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      {counters ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Counter label="إجمالي الطلبات" value={counters.total} />
          <Counter label="آخر ٧ أيام" value={counters.submittedLast7Days} />
          <Counter label="قيد المراجعة" value={counters.byStatus.UNDER_REVIEW ?? 0} />
          <Counter label="مقبولة" value={counters.byStatus.APPROVED ?? 0} />
        </section>
      ) : null}

      <PropertyMapPanel tenant={tenant} features={features} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">الطلبات</h2>
          <Select
            value={filter || ALL_STATUSES}
            onValueChange={(next) => setFilter(next === ALL_STATUSES ? '' : next)}
          >
            <SelectTrigger className="w-[180px]" aria-label="تصفية حسب الحالة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>كل الحالات</SelectItem>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {ar.reportStatus[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead scope="col">الرقم المرجعي</TableHead>
                <TableHead scope="col">مقدّم الطلب</TableHead>
                <TableHead scope="col">العقارات</TableHead>
                <TableHead scope="col">الحالة</TableHead>
                <TableHead scope="col">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium" dir="ltr">
                    {item.referenceNumber}
                  </TableCell>
                  <TableCell>{item.citizenName}</TableCell>
                  <TableCell>{item.propertyCount}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[item.status] ?? 'secondary'}>
                      {ar.reportStatus[item.status as never] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {nextStatusesFor(item.status).map((next) => (
                        <Button
                          key={next}
                          variant="outline"
                          size="sm"
                          onClick={() => transition(item.id, next)}
                        >
                          {ar.reportStatus[next as never] ?? next}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {items.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">لا توجد طلبات.</p>
          ) : null}
        </Card>
      </section>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Mirrors the aggregate's ALLOWED_TRANSITIONS. Duplicated here only to avoid
 * offering a button the server will refuse — the server remains the authority,
 * and a mismatch shows up as a rejected click rather than a bad write.
 */
function nextStatusesFor(status: string): string[] {
  switch (status) {
    case 'PENDING':
      return ['UNDER_REVIEW', 'REJECTED'];
    case 'UNDER_REVIEW':
      return ['VERIFIED', 'REJECTED'];
    case 'VERIFIED':
      return ['APPROVED', 'REJECTED'];
    default:
      return [];
  }
}
