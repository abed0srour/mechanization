'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft,
  Languages,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  User,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { activeNavItem } from '@/components/admin/nav';
import { NotificationsBell } from '@/components/admin/notifications-bell';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ar } from '@mechanization/shared-schemas';
import type { Session } from '@/lib/api-client';
import { clearSession } from '@/lib/session';

const THEME_OPTIONS = [
  { value: 'light', label: 'فاتح', icon: Sun },
  { value: 'dark', label: 'داكن', icon: Moon },
  { value: 'system', label: 'النظام', icon: Monitor },
] as const;

/**
 * The bar across the top of every staff screen.
 *
 * There was no header at all before this: the sidebar carried navigation, the
 * theme toggle, the language switch and sign-out, and each page re-stated its
 * own name in its `PageHeader` with nothing above it. That left three problems
 * this fixes together — a phone had no way to reach navigation once the rail
 * was hidden, there was no persistent place for a search that spans sections,
 * and "which municipality am I signed into, as whom" was answerable only by
 * opening a page that happened to say so.
 *
 * Sticky rather than fixed: the sidebar is a flex sibling, so a fixed header
 * would need its inset-inline-start hard-coded to the rail's width and kept in
 * sync with the collapse toggle. Sticky inside the scrolling column costs none
 * of that and behaves correctly at every rail width.
 */
export function AdminHeader({
  tenant,
  locale,
  adminPath,
  tenantName,
  session,
  onOpenDrawer,
  onOpenSearch,
}: {
  tenant: string;
  locale: string;
  adminPath: string;
  tenantName: string | undefined;
  session: Session | null;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const base = `/${tenant}/${locale}/${adminPath}`;
  const role = session?.user.role;
  const active = activeNavItem(pathname, base, role);

  // Nothing theme-dependent renders until after hydration: the server cannot
  // know the stored choice, so marking the current radio item on the first
  // render is a guaranteed mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /** A detail route — `/citizens/:id` — sits one level under its section. */
  const onDetailRoute = Boolean(active && pathname !== `${base}${active.path}`);

  /*
   * What the last crumb says.
   *
   * It read «التفاصيل» for every sub-route, which is wrong on exactly the two
   * that are not details: `/citizens/new` is a blank form and
   * `/citizens/:id/edit` is that form filled in. A clerk halfway through
   * entering a resident was told they were looking at that resident's details,
   * which is the one thing the page is not.
   */
  const leafLabel = ((): string => {
    const last = (pathname ?? '').split('/').filter(Boolean).pop();
    if (last === 'new') return 'جديد';
    if (last === 'edit') return 'تعديل';
    return 'التفاصيل';
  })();

  function switchLanguage(): void {
    const other = locale === 'ar' ? 'en' : 'ar';
    // Swaps only the locale segment, so switching language keeps whatever page
    // (and sub-route, e.g. a citizen's id) is open rather than bouncing back
    // to the dashboard.
    router.push((pathname ?? base).replace(`/${tenant}/${locale}/`, `/${tenant}/${other}/`));
  }

  function signOut(): void {
    clearSession(tenant);
    router.replace(`${base}/login`);
  }

  const displayName = session?.user.name ?? '';

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 lg:hidden"
        onClick={onOpenDrawer}
        aria-label="فتح القائمة"
      >
        <Menu className="size-5" />
      </Button>

      {/* Breadcrumb. The municipality's own name is the root rather than a
          generic "الرئيسية": with one portal per tenant, the thing a clerk
          needs confirmed at a glance is *which* municipality's records are on
          screen — the answer to "am I about to edit the wrong town". */}
      <nav aria-label="مسار التنقل" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link
          href={`${base}/dashboard`}
          className="hidden shrink-0 truncate text-muted-foreground transition-colors hover:text-foreground sm:inline"
        >
          {tenantName ?? 'البلدية'}
        </Link>
        {active ? (
          <>
            <ChevronLeft
              aria-hidden
              className="hidden size-3.5 shrink-0 text-muted-foreground/60 ltr:rotate-180 sm:inline"
            />
            {onDetailRoute ? (
              <>
                <Link
                  href={`${base}${active.path}`}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {active.label}
                </Link>
                <ChevronLeft
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground/60 ltr:rotate-180"
                />
                <span className="truncate font-semibold text-foreground">{leafLabel}</span>
              </>
            ) : (
              <span className="truncate font-semibold text-foreground">{active.label}</span>
            )}
          </>
        ) : null}
      </nav>

      <div className="flex-1" />

      {/* Search collapses to its icon below `sm`. The full affordance — a box
          with a placeholder and the ⌘K hint — costs 200px that a 360px screen
          has to take from the breadcrumb. */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="بحث شامل"
        className="hidden h-9 w-56 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:flex xl:w-72"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">بحث…</span>
        <kbd className="ms-auto hidden shrink-0 rounded border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground lg:inline">
          Ctrl K
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 sm:hidden"
        onClick={onOpenSearch}
        aria-label="بحث شامل"
      >
        <Search className="size-5" />
      </Button>

      {/* Sits before the account menu rather than after it: this is work
          arriving, and the account menu is the one control on this bar
          that is never about the municipality's records. */}
      <NotificationsBell tenant={tenant} token={session?.accessToken} role={role} base={base} />

      {/* Language Switcher Button on Navbar */}
      <Button
        variant="ghost"
        size="sm"
        onClick={switchLanguage}
        className="h-9 shrink-0 gap-1.5 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
        title={locale === 'ar' ? 'التحويل إلى اللغة الإنجليزية' : 'Switch language to Arabic'}
        aria-label={locale === 'ar' ? 'English' : 'عربي'}
      >
        <Languages className="size-4 text-primary shrink-0 transition-transform group-hover:scale-110" aria-hidden />
        <span className="font-medium tracking-wide">
          {locale === 'ar' ? 'English' : 'عربي'}
        </span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="shrink-0 gap-2 px-2" aria-label="حسابي">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <User className="size-4" />
            </span>
            <span className="hidden max-w-[12rem] truncate text-sm md:inline">{displayName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block truncate text-sm font-semibold text-foreground">
              {displayName || 'مستخدم'}
            </span>
            {role ? (
              <span className="block text-xs font-normal">
                {ar.staffRole?.[role as never] ?? role}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuLabel>المظهر</DropdownMenuLabel>
          {/* A radio group rather than a toggle: there are three settings, and
              "follow the device" is not the opposite of anything. The segmented
              control this replaces showed its state without being opened, which
              was its whole argument — but it cost a permanent slot in a sidebar
              footer that no longer exists on a phone. */}
          <DropdownMenuRadioGroup
            value={mounted ? (theme ?? 'system') : undefined}
            onValueChange={setTheme}
          >
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <Icon className="size-4" aria-hidden />
                  <span>{option.label}</span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={switchLanguage}>
            <Languages aria-hidden />
            <span>{locale === 'ar' ? 'English' : 'عربي'}</span>
            {/* Said plainly rather than left to be discovered: the switch flips
                direction and date formatting, and does not yet translate copy. */}
            <span className="ms-auto text-[10px] text-muted-foreground">الاتجاه فقط</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={signOut}>
            <LogOut aria-hidden />
            <span>تسجيل الخروج</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

