'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Landmark, PanelLeftClose, PanelLeftOpen, ShieldCheck, Sparkles } from 'lucide-react';
import { activeNavItem, visibleGroups, type NavItem } from '@/components/admin/nav';
import { cn } from '@/lib/utils';

const COLLAPSE_STORAGE_KEY = 'mechanization.sidebar.collapsed';
const GROUPS_STORAGE_KEY = 'mechanization.sidebar.groups';

const NO_GROUPS_FOLDED: ReadonlySet<string> = new Set<string>();
let foldedGroups: ReadonlySet<string> = NO_GROUPS_FOLDED;
let readFromStorage = false;
const foldListeners = new Set<() => void>();

function subscribeFolds(listener: () => void): () => void {
  foldListeners.add(listener);
  return () => {
    foldListeners.delete(listener);
  };
}

function hydrateFolds(): void {
  if (readFromStorage) return;
  readFromStorage = true;
  try {
    const raw = localStorage.getItem(GROUPS_STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    foldedGroups = new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
    for (const listener of foldListeners) listener();
  } catch {
    /* default: every group open */
  }
}

function setGroupFolded(label: string, folded: boolean): void {
  if (foldedGroups.has(label) === folded) return;
  const next = new Set(foldedGroups);
  if (folded) next.add(label);
  else next.delete(label);
  foldedGroups = next;
  try {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* the fold still holds for this page load */
  }
  for (const listener of foldListeners) listener();
}

function useFoldedGroups(): ReadonlySet<string> {
  useEffect(hydrateFolds, []);
  return useSyncExternalStore(
    subscribeFolds,
    () => foldedGroups,
    () => NO_GROUPS_FOLDED,
  );
}

/**
 * Premium Admin Sidebar Rail.
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
        'hidden h-screen shrink-0 flex-col border-e border-border/70 bg-card/95 backdrop-blur-xl supports-[backdrop-filter]:bg-card/75 shadow-xs transition-[width] duration-300 ease-in-out lg:flex z-20',
        collapsed ? 'w-[76px]' : 'w-[264px]',
      )}
    >
      {/* Brand Header */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-4 transition-all',
          collapsed && 'justify-center px-2',
        )}
      >
        {!collapsed ? (
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden
              className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/20 ring-1 ring-white/20"
            >
              <Landmark className="size-4.5" />
              <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold tracking-tight text-foreground">بوابة الإدارة</p>
              <p className="truncate text-[11px] font-medium text-muted-foreground">نظام المكننة البلدي</p>
            </div>
          </div>
        ) : (
          <div
            aria-hidden
            className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/20"
          >
            <Landmark className="size-4.5" />
            <span className="absolute -bottom-0.5 -end-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-card" />
          </div>
        )}

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
          title={collapsed ? 'إظهار الشريط الجانبي' : 'طي الشريط الجانبي'}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-accent hover:text-foreground',
            collapsed && 'hidden',
          )}
        >
          <PanelLeftClose className="size-4.5" />
        </button>
      </div>

      {/* Navigation List */}
      <SidebarNav base={base} role={role} collapsed={collapsed} />

      {/* Footer info & collapse affordance */}
      <div className="mt-auto border-t border-border/60 p-3">
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="إظهار الشريط الجانبي"
            title="إظهار الشريط الجانبي"
            className="flex size-10 w-full items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
          >
            <PanelLeftOpen className="size-5" />
          </button>
        ) : (
          <div className="flex items-center justify-between rounded-xl bg-muted/40 p-2.5 ring-1 ring-border/40">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">النظام متصل</span>
            </div>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {role ?? 'STAFF'}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Grouped link list shared between desktop rail and mobile drawer.
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
  const folded = useFoldedGroups();

  const activeGroupLabel = groups.find((group) =>
    group.items.some((item) => item.path === active?.path),
  )?.label;
  useEffect(() => {
    if (activeGroupLabel) setGroupFolded(activeGroupLabel, false);
  }, [activeGroupLabel]);

  const renderItems = useCallback(
    (items: NavItem[]) => (
      <div className="space-y-1">
        {items.map((item) => {
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
                'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200',
                collapsed && 'justify-center px-0 py-2.5',
                isActive
                  ? 'bg-gradient-to-r from-primary/15 via-primary/10 to-primary/5 text-primary shadow-xs ring-1 ring-primary/25 font-semibold'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground hover:translate-x-0.5',
              )}
            >
              {/* Active pill bar */}
              {isActive && !collapsed ? (
                <span
                  aria-hidden
                  className="absolute start-0 top-2 bottom-2 w-1 rounded-e-full bg-primary"
                />
              ) : null}

              <div
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-xs shadow-primary/30'
                    : 'bg-muted/40 text-muted-foreground group-hover:bg-muted group-hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
              </div>

              {!collapsed ? (
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    ),
    [active?.path, base, collapsed, onNavigate],
  );

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto p-3 scrollbar-thin">
      {groups.map((group) => {
        if (collapsed) {
          return (
            <div key={group.label} className="space-y-1">
              <div aria-hidden className="mx-auto my-2.5 h-px w-6 bg-border/60 first:hidden" />
              {renderItems(group.items)}
            </div>
          );
        }

        const isFolded = folded.has(group.label);
        const holdsActive = group.items.some((item) => item.path === active?.path);

        return (
          <details
            key={group.label}
            open={!isFolded}
            onToggle={(event) => setGroupFolded(group.label, !event.currentTarget.open)}
            className="group/nav space-y-1.5"
          >
            <summary
              className={cn(
                'flex cursor-pointer list-none items-center justify-between rounded-lg px-2.5 py-1.5',
                'text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80',
                'transition-colors hover:bg-muted/50 hover:text-foreground',
                '[&::-webkit-details-marker]:hidden',
              )}
            >
              <div className="flex items-center gap-2">
                <span>{group.label}</span>
                {isFolded && holdsActive ? (
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
                ) : null}
              </div>
              <ChevronDown
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-open/nav:rotate-180 motion-reduce:transition-none"
              />
            </summary>

            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
                isFolded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="pt-1">{renderItems(group.items)}</div>
              </div>
            </div>
          </details>
        );
      })}
    </nav>
  );
}
