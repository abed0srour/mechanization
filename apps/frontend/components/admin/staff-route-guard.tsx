'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { canAccessPath, defaultPathFor } from '@/components/admin/nav';
import { loadSession } from '@/lib/session';
import { Skeleton } from '@/components/ui/skeleton';

export function StaffRouteGuard({
  tenant,
  base,
  children,
}: {
  tenant: string;
  /** `/{tenant}/{locale}/{adminPath}` — what every admin path hangs off. */
  base: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<'checking' | 'allowed'>('checking');

  useEffect(() => {
    const session = loadSession(tenant);

    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }

    if (!canAccessPath(pathname ?? base, base, session.user.role)) {
      /**
       * `replace`, not `push`: the screen they could not open should not sit
       * in history behind the one they landed on, or Back walks straight into
       * the same redirect again.
       */
      router.replace(`${base}${defaultPathFor(session.user.role)}`);
      return;
    }

    setState('allowed');
  }, [tenant, base, pathname, router]);

  if (state === 'checking') {
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

  return <>{children}</>;
}
