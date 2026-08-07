'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Map as MapIcon,
  Layers,
  ShieldCheck,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Languages,
  Receipt,
  Settings,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { clearSession, loadSession } from '@/lib/session';
import { ThemeToggle } from '@/components/theme-toggle';
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Omitted = every staff role can see it. */
  roles?: string[];
}

const COLLAPSE_STORAGE_KEY = 'mechanization.sidebar.collapsed';

/**
 * Persistent admin navigation, replacing the row of cross-page links every
 * `[adminPath]` screen used to duplicate in its own header (each one
 * repeating "الخريطة" / "سجل النشاطات" / "رجوع إلى اللوحة" as its own button
 * row). One sidebar, one place that knows the section list and who can see
 * which — a page's header is left with only the actions specific to it.
 *
 * Two forms, one component. At `lg` and up it is a rail in the layout's flex
 * row, 256px wide or 72px folded. Below `lg` a 256px rail would eat two thirds
 * of a phone, so it becomes an off-canvas drawer over the page, opened from the
 * bar in `AdminShell` and closed by the scrim, the Escape key, or picking a
 * destination.
 */
export function AdminSidebar({
  tenant,
  locale,
  adminPath,
  mobileOpen,
  onMobileClose,
}: {
  tenant: string;
  locale: string;
  adminPath: string;
  /** Drawer state — meaningful below `lg` only; `AdminShell` owns it. */
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;
  const [role, setRole] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState(false);

  /**
   * Folding is a desktop affordance: the drawer is already a deliberate,
   * dismissable thing, and a 72px icon rail floating over a phone answers a
   * question nobody asked. Below `lg` the stored preference is ignored rather
   * than cleared, so it is still there when the same person opens a laptop.
   */
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const folded = collapsed && isDesktop;

  // Re-read on every route change rather than once: signing out and back in
  // as a different role (or a session expiring) should update which links
  // show without requiring a full page reload.
  useEffect(() => {
    setRole(loadSession(tenant)?.user.role);
  }, [tenant, pathname]);

  // Read on mount only. The rail's stored width cannot be known while
  // rendering on the server, so it starts expanded and corrects itself here;
  // the theme is no longer part of this — `ThemeToggle` owns its own state
  // through the provider.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true');
    } catch {
      /* default: expanded */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        /* the toggle still works for this page load */
      }
      return next;
    });
  }

  // Escape closes the drawer, matching every other overlay in the app. Bound
  // only while it is open so the key stays free for the page underneath.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onMobileClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onMobileClose]);

  function switchLanguage() {
    const otherLocale = locale === 'ar' ? 'en' : 'ar';
    // Swaps only the locale segment, so switching language keeps whatever
    // page (and sub-route, e.g. a citizen's id) is currently open instead of
    // bouncing back to the dashboard.
    router.push(pathname.replace(`/${tenant}/${locale}/`, `/${tenant}/${otherLocale}/`));
  }

  function signOut() {
    clearSession(tenant);
    router.replace(`${base}/login`);
  }

  const items: NavItem[] = [
    { href: `${base}/dashboard`, label: 'لوحة التحكم', icon: LayoutDashboard },
    // Directly under the dashboard: the dashboard is the review queue — one
    // row per طلب, ordered by what needs deciding — and this is the register
    // it decides about, one row per person. Since the public wizard was
    // removed, it is also where a citizen is created at all.
    { href: `${base}/citizens`, label: 'المواطنون', icon: Users },
    { href: `${base}/map`, label: 'الخريطة', icon: MapIcon },
    { href: `${base}/zones`, label: 'القطاعات', icon: Layers },
    // Next to the registry rather than under settings: a fee is issued
    // against the citizens on the dashboard, not configured in isolation.
    { href: `${base}/fees`, label: 'إدارة الرسوم والمدفوعات', icon: Receipt },
    {
      href: `${base}/audit`,
      label: 'سجل النشاطات',
      icon: ShieldCheck,
      roles: ['SUPER_ADMIN', 'AUDITOR'],
    },
    {
      href: `${base}/settings`,
      label: 'إعدادات البلدية',
      icon: Settings,
      // Every /fees/settings write is SUPER_ADMIN-guarded server-side; this
      // keeps a page that can only refuse an auditor out of their sidebar.
      roles: ['SUPER_ADMIN'],
    },
    {
      href: `${base}/staff`,
      label: 'الموظفون',
      icon: UsersRound,
      // Creating accounts is the privilege-escalation path in this system —
      // every /staff route is SUPER_ADMIN-guarded server-side, and this keeps
      // a page that can only refuse an auditor out of their sidebar.
      roles: ['SUPER_ADMIN'],
    },
  ];

  return (
    <>
      {/* Scrim, below `lg` only. Rendered from `mobileOpen` rather than kept in
          the tree at opacity 0 so it cannot swallow clicks on the desktop rail. */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 cursor-default bg-black/50 animate-in fade-in lg:hidden"
        />
      ) : null}

      <aside
        // `h-full` inside the shell's `h-[100dvh]` row rather than `h-screen`:
        // `vh` on a phone is the *large* viewport, so with the browser's own
        // toolbars showing, a `h-screen` rail put its sign-out button below the
        // fold with nothing to scroll.
        className={cn(
          'flex shrink-0 flex-col border-e bg-background',
          // Below `lg`: an overlay drawer pinned to the reading-start edge,
          // sliding out along whichever edge that resolves to.
          'fixed inset-y-0 start-0 z-50 w-64 max-w-[85vw] transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
          // At `lg`: back in the flow, no transform, width animates instead.
          'lg:static lg:z-auto lg:h-full lg:max-w-none lg:translate-x-0 lg:transition-[width] rtl:lg:translate-x-0',
          folded ? 'lg:w-[72px]' : 'lg:w-64',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2.5 border-b px-4 py-4',
            folded && 'lg:justify-center lg:px-2',
          )}
        >
          {!folded ? (
            <>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">لوحة البلدية</p>
                {role ? <p className="truncate text-xs text-muted-foreground">{role}</p> : null}
              </div>
            </>
          ) : null}

          {/* Two different jobs at two widths, so two controls rather than one
              that changes meaning: fold/unfold the rail on a desktop, dismiss
              the drawer on a phone. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={folded ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
            title={folded ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
            className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:flex"
          >
            {folded ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="إغلاق القائمة"
            className="flex size-touch shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items
            .filter((item) => !item.roles || (role && item.roles.includes(role)))
            .map((item) => {
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={folded ? item.label : undefined}
                  // Closing on the link rather than only on the route change:
                  // tapping the section you are already on changes no pathname,
                  // and leaving the drawer open there reads as a dead control.
                  onClick={onMobileClose}
                  className={cn(
                    // 44px tall on a phone, back to the tighter desktop rhythm
                    // once a pointer is doing the aiming.
                    'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors lg:py-2.5',
                    folded && 'lg:justify-center lg:px-0',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {!folded ? item.label : null}
                </Link>
              );
            })}
        </nav>

        <div className="space-y-1 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Full-width so the three segments line up with the nav rows above
              rather than floating in the middle of the footer. */}
          <ThemeToggle collapsed={folded} className={folded ? undefined : 'flex w-full'} />

          <button
            type="button"
            onClick={switchLanguage}
            title="لا يترجم النصوص بعد — يبدّل الاتجاه والتاريخ فقط"
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:py-2.5',
              folded && 'lg:justify-center lg:px-0',
            )}
          >
            <Languages className="size-5 shrink-0" />
            {!folded ? (locale === 'ar' ? 'English' : 'عربي') : null}
          </button>

          <button
            type="button"
            onClick={signOut}
            title="تسجيل الخروج"
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive lg:py-2.5',
              folded && 'lg:justify-center lg:px-0',
            )}
          >
            <LogOut className="size-5 shrink-0" />
            {!folded ? 'تسجيل الخروج' : null}
          </button>
        </div>
      </aside>
    </>
  );
}
