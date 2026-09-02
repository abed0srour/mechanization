'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { defaultPathFor } from '@/components/admin/nav';
import { loadSession } from '@/lib/session';
import { Skeleton } from '@/components/ui/skeleton';

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

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-[28rem] w-full rounded-xl" />
      </div>
    </div>
  );
}
