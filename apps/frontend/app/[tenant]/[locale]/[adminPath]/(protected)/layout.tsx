import { AdminShell } from '@/components/admin/admin-shell';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * The municipality's display name, for the header breadcrumb and the drawer.
 *
 * Fetched here rather than read from the session because it is public, cached
 * config — the same endpoint `TenantLayout` already calls, so Next dedupes the
 * two into one request — and because the header must be able to say which
 * municipality this is before a session exists at all.
 */
async function getTenantName(slug: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${API_URL}/t/${slug}/tenant/config`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return undefined;
    const config = (await response.json()) as { name?: string; nameAr?: string };
    // Arabic first: this portal is Arabic-first, and `name` is the Latin
    // transliteration a municipality fills in second, if at all.
    return config.nameAr ?? config.name;
  } catch {
    // The breadcrumb falls back to «البلدية». A failed lookup for a decorative
    // string must not take down every staff screen under it.
    return undefined;
  }
}

/**
 * Wraps every staff screen except login in the admin chrome.
 *
 * A route group (`(protected)`) rather than a real segment — it adds nothing
 * to the URL, so `/{tenant}/{locale}/{adminPath}/dashboard` is unchanged, but
 * it lets `login/page.tsx` sit outside this layout and render full-screen with
 * no navigation at all, matching a page whose whole point is to say nothing
 * about the portal to anyone without credentials.
 *
 * Auth itself is still checked per-page (each screen redirects to `/login`
 * when `loadSession` comes back empty) — this layout owns the chrome around an
 * authenticated page, not the gate itself.
 *
 * Still a server component: the shell beneath it is the client boundary, so
 * the route params and the tenant name are resolved here and passed down as
 * props rather than re-fetched in the browser.
 */
export default async function ProtectedAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = await params;
  const tenantName = await getTenantName(tenant);

  return (
    // One provider for every staff screen — Radix requires an ancestor
    // provider, and it is also what keeps the hint delay consistent rather
    // than per-table. 200ms: long enough not to fire while the cursor crosses
    // a row of icons, short enough to feel immediate on the one being aimed at.
    <TooltipProvider delayDuration={200}>
      {/* Outside the shell rather than inside it: a toast raised by a page
          must outlive that page's own unmount, so the viewport holding it
          cannot be a descendant of the route being replaced. */}
      <ToastProvider>
        <AdminShell
          tenant={tenant}
          locale={locale}
          adminPath={adminPath}
          tenantName={tenantName}
        >
          {children}
        </AdminShell>
      </ToastProvider>
    </TooltipProvider>
  );
}
