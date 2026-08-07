'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, ShieldCheck } from 'lucide-react';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

/**
 * The frame every staff screen renders inside: navigation beside the page on a
 * desktop, navigation *over* the page on a phone.
 *
 * It exists as a client component because the two halves share one piece of
 * state — whether the drawer is open — and the bar that opens it is not inside
 * the thing it opens. `children` is still server-rendered: passing an already
 * rendered tree through a client boundary does not make it a client component.
 *
 * `h-[100dvh]`, not `h-screen`. On a phone, `100vh` is the viewport with the
 * browser chrome *hidden*, so a `h-screen` shell is taller than what is
 * actually visible — the last row of any page sat permanently under the URL
 * bar, and because the shell also sets `overflow-hidden`, there was nothing to
 * scroll to reach it. `dvh` tracks the chrome as it collapses.
 */
export function AdminShell({
  tenant,
  locale,
  adminPath,
  children,
}: {
  tenant: string;
  locale: string;
  adminPath: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Navigating dismisses the drawer. Without this, following a link would leave
  // the new page underneath a menu the reader has to close by hand.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // The drawer scrolls its own nav; the page behind it must not scroll with it.
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <AdminSidebar
        tenant={tenant}
        locale={locale}
        adminPath={adminPath}
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Below `lg` only — above it the rail is already on screen and a second
          place to reach the same links would just be noise. Kept to one row of
          48px so it costs as little of a phone's height as a control that has
          to be permanently reachable can.
        */}
        <header className="flex h-touch shrink-0 items-center gap-2 border-b bg-background px-2 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="فتح القائمة"
            aria-expanded={navOpen}
            className="flex size-touch shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">لوحة البلدية</span>
          </span>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
