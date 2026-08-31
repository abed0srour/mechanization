'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { defaultPathFor } from '@/components/admin/nav';
import { loadSession } from '@/lib/session';
import { LoadingState } from '@/components/ui/states';

/**
 * The admin base path itself — `/{tenant}/{locale}/{adminPath}`.
 *
 * There was no page here, so the one URL a staff member is actually given (the
 * admin link `tenant:provision` prints) rendered Next's 404 inside the admin
 * chrome. Everyone learned to type `/dashboard` on the end.
 *
 * It resolves rather than redirects blindly: `/dashboard` is restricted to
 * SUPER_ADMIN, AUDITOR and FIELD_INSPECTOR, so sending every role there would
 * bounce a COLLECTOR straight back out again. `defaultPathFor` reads the same
 * nav the sidebar does and returns the first section this role can actually
 * open.
 *
 * Sitting inside `(protected)` means `StaffRouteGuard` has already handled the
 * signed-out case by the time this renders — it redirects to `/login` before
 * this component is reached.
 */
export default function AdminIndexPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  useEffect(() => {
    const session = loadSession(tenant);
    // The guard above redirects a missing session; this is the ordering
    // fallback for the render that happens before it does.
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    // `replace`: this URL is a signpost, not a destination. Leaving it in
    // history means Back lands on a page that immediately forwards again.
    router.replace(`${base}${defaultPathFor(session.user.role)}`);
  }, [tenant, base, router]);

  return <LoadingState fullHeight label="جارٍ فتح لوحة الإدارة…" />;
}
