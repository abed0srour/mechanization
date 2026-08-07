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
} from 'lucide-react';
import { clearSession, loadSession } from '@/lib/session';
import { ThemeToggle } from '@/components/theme-toggle';
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
 */
export function AdminSidebar({
  tenant,
  locale,
  adminPath,
}: {
  tenant: string;
  locale: string;
  adminPath: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;
  const [role, setRole] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState(false);

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
    <aside
      className={cn(
        'flex h-screen shrink-0 flex-col border-e bg-background transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2.5 border-b px-4 py-4',
          collapsed && 'justify-center px-2',
        )}
      >
        {!collapsed ? (
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
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
          title={collapsed ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-5" />
          ) : (
            <PanelLeftClose className="size-5" />
          )}
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
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="size-5 shrink-0" />
                {!collapsed ? item.label : null}
              </Link>
            );
          })}
      </nav>

      <div className="space-y-1 border-t p-3">
        {/* Full-width so the three segments line up with the nav rows above
            rather than floating in the middle of the footer. */}
        <ThemeToggle collapsed={collapsed} className={collapsed ? undefined : 'flex w-full'} />

        <button
          type="button"
          onClick={switchLanguage}
          title="لا يترجم النصوص بعد — يبدّل الاتجاه والتاريخ فقط"
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          <Languages className="size-5 shrink-0" />
          {!collapsed ? (locale === 'ar' ? 'English' : 'عربي') : null}
        </button>

        <button
          type="button"
          onClick={signOut}
          title="تسجيل الخروج"
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOut className="size-5 shrink-0" />
          {!collapsed ? 'تسجيل الخروج' : null}
        </button>
      </div>
    </aside>
  );
}
