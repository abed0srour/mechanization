'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { activeNavItem, visibleGroups } from '@/components/admin/nav';
import { cn } from '@/lib/utils';

const COLLAPSE_STORAGE_KEY = 'mechanization.sidebar.collapsed';

/**
 * The navigation rail.
 *
 * It used to be the whole of the admin chrome — it also carried the theme
 * toggle, the language switch and sign-out in its footer, because there was no
 * header to put them in. There is one now (`AdminHeader`), and those three
 * belong to the person rather than to the section list, so they moved there
 * and this is navigation only.
 *
 * It also used to be a plain flex child that was always on screen at 256px,
 * with no breakpoint anywhere in it. On a 390px phone that left 134px for the
 * page — a table rendered into a gutter. Below `lg` this is no longer mounted
 * as a rail at all: `AdminShell` renders the same `SidebarNav` in a drawer.
 *
 * `lg` rather than the `md` a marketing site would use. The content beside it
 * is a wide RTL data table; at 768px a 256px rail leaves 512px, which is not
 * enough for one and turns every table into a horizontal scroll hunt. A tablet
 * gets the full width and reaches navigation through the drawer.
 */
export function AdminSidebar({
  tenant,
  locale,
  adminPath,
  role,
}: {
  tenant: string;
  locale: string;
  adminPath: string;
  role: string | undefined;
}) {
  const base = `/${tenant}/${locale}/${adminPath}`;
  const [collapsed, setCollapsed] = useState(false);

  // Read on mount only. The rail's stored width cannot be known while
  // rendering on the server, so it starts expanded and corrects itself here.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true');
    } catch {
      /* default: expanded */
    }
  }, []);

  function toggleCollapsed(): void {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        /* the toggle still works for this page load */
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        'hidden h-screen shrink-0 flex-col border-e bg-card transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      {/* h-14 matches the header beside it, so the rail's rule and the
          header's are one continuous line across the top of the app. */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center gap-2.5 border-b px-4',
          collapsed && 'justify-center px-2',
        )}
      >
        {!collapsed ? (
          <>
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <ShieldCheck className="size-[18px]" />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">لوحة البلدية</p>
          </>
        ) : null}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
          title={collapsed ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
        </button>
      </div>

      <SidebarNav base={base} role={role} collapsed={collapsed} />
    </aside>
  );
}

/**
 * The grouped link list itself, shared by the desktop rail and the mobile
 * drawer so the two can never drift.
 *
 * `onNavigate` is how the drawer closes on a tap: the rail passes nothing, the
 * drawer passes its close handler. Doing it here rather than with a
 * route-change effect inside the drawer means the panel starts closing on the
 * press instead of after the next page has resolved — on a slow connection,
 * the difference between a responsive tap and one that looks ignored.
 */
export function SidebarNav({
  base,
  role,
  collapsed = false,
  onNavigate,
}: {
  base: string;
  role: string | undefined;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = visibleGroups(role);
  const active = activeNavItem(pathname, base, role);

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {groups.map((group) => (
        <div key={group.label}>
          {/* Folded, a heading is a word floating in a 72px rail — the divider
              carries the grouping instead. */}
          {collapsed ? (
            <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-border first:hidden" />
          ) : (
            <div className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground">
              {group.label}
            </div>
          )}

          <div className="space-y-0.5">
            {group.items.map((item) => {
              const href = `${base}${item.path}`;
              const isActive = active?.path === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  href={href}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    // 44px tall below `lg` rather than the rail's 36: in the
                    // drawer these are thumb targets, not cursor targets.
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors lg:py-2',
                    collapsed && 'justify-center px-0',
                    // A tinted row rather than a solid primary bar: with ten of
                    // these stacked, a filled block is the loudest thing on the
                    // page and pulls the eye off the content it introduces.
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="size-[18px] shrink-0" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
