'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { canAccessPath, defaultPathFor } from '@/components/admin/nav';
import { loadSession } from '@/lib/session';
import { LoadingState } from '@/components/ui/states';

/**
 * The gate in front of every staff screen.
 *
 * Each page already loads the session for its own access token, and each one
 * redirected to `/login` when that came back empty — twelve copies of the same
 * three lines, which is twelve chances for a new page to forget them. Worse,
 * none of them checked *role*: a FIELD_INSPECTOR who typed `/settings`, or
 * followed a stale link to it, got the full settings screen and a wall of 403s
 * from every request it made, which reads as a broken portal rather than as a
 * page that was never theirs.
 *
 * Three rules, in one place:
 *
 *   1. No session, or a citizen's session → `/login`.
 *   2. A staff session on a screen this role may not open → that role's own
 *      landing page, which `defaultPathFor` derives from the nav.
 *   3. Otherwise, render.
 *
 * Nothing is rendered until rule 1 has been decided. That is deliberate: the
 * alternative flashes the admin chrome — sidebar, header, the municipality's
 * name — at someone with no session before the redirect lands.
 *
 * This is convenience and correctness, never the security boundary. The API
 * authorises every request on its own token; a client that skipped this guard
 * would still be refused by `RolesGuard`.
 */
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
    return <LoadingState fullHeight label="جارٍ التحقق من الجلسة…" />;
  }

  return <>{children}</>;
}
