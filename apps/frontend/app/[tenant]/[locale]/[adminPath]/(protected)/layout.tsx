import { AdminShell } from '@/components/admin/admin-shell';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Wraps every staff screen except login in the persistent sidebar. A route
 * group (`(protected)`) rather than a real segment — it adds nothing to the
 * URL, so `/{tenant}/{locale}/{adminPath}/dashboard` is unchanged, but it lets
 * `login/page.tsx` sit outside this layout and render full-screen with no
 * navigation at all, matching a page whose whole point is to say nothing
 * about the portal to anyone who doesn't already have credentials.
 *
 * Auth itself is still checked per-page (each screen already redirects to
 * `/login` when `loadSession` comes back empty) — this layout only owns the
 * chrome around an authenticated page, not the gate itself.
 */
export default async function ProtectedAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = await params;

  return (
    // One provider for every staff screen — Radix requires an ancestor
    // provider, and it is also what keeps the hint delay consistent rather
    // than per-table. 200ms: long enough not to fire while the cursor is
    // crossing a row of icons, short enough to feel immediate on the one
    // being aimed at.
    <TooltipProvider delayDuration={200}>
      {/* The sidebar-or-drawer decision, the bar that opens the drawer and the
          scroll container for the page all share one piece of state, so they
          share one client component. See admin-shell.tsx. */}
      <AdminShell tenant={tenant} locale={locale} adminPath={adminPath}>
        {children}
      </AdminShell>
    </TooltipProvider>
  );
}
