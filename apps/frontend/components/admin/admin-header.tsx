'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  ChevronLeft,
  Command,
  Globe,
  Languages,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Shield,
  Sparkles,
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
import { cn } from '@/lib/utils';

const THEME_OPTIONS = [
  { value: 'light', label: 'فاتح', icon: Sun },
  { value: 'dark', label: 'داكن', icon: Moon },
  { value: 'system', label: 'النظام', icon: Monitor },
] as const;

/**
 * Premium Admin Navbar / Header.
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

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onDetailRoute = Boolean(active && pathname !== `${base}${active.path}`);

  const leafLabel = ((): string => {
    const last = (pathname ?? '').split('/').filter(Boolean).pop();
    if (last === 'new') return 'إضافة جديد';
    if (last === 'edit') return 'تعديل';
    return 'التفاصيل';
  })();

  function switchLanguage(): void {
    const other = locale === 'ar' ? 'en' : 'ar';
    router.push((pathname ?? base).replace(`/${tenant}/${locale}/`, `/${tenant}/${other}/`));
  }

  function signOut(): void {
    clearSession(tenant);
    router.replace(`${base}/login`);
  }

  const displayName = session?.user.name ?? '';
  const userInitials = displayName
    ? displayName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
    : 'م';

  const roleLabel = role ? (ar.staffRole?.[role as never] ?? role) : 'موظف';

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/85 px-4 sm:px-6 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 shadow-xs transition-all">
      {/* Left side: Mobile menu & Breadcrumbs */}
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-xl lg:hidden hover:bg-muted"
          onClick={onOpenDrawer}
          aria-label="فتح القائمة"
        >
          <Menu className="size-5" />
        </Button>

        {/* Modern Breadcrumb */}
        <nav aria-label="مسار التنقل" className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            href={`${base}/dashboard`}
            className="group inline-flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border/50 transition-all hover:bg-muted hover:text-foreground"
          >
            <Building2 className="size-3.5 text-primary transition-transform group-hover:scale-110" />
            <span className="truncate">{tenantName ?? 'البلدية'}</span>
          </Link>

          {active ? (
            <>
              <ChevronLeft
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/40 ltr:rotate-180"
              />
              {onDetailRoute ? (
                <>
                  <Link
                    href={`${base}${active.path}`}
                    className="truncate text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {active.label}
                  </Link>
                  <ChevronLeft
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground/40 ltr:rotate-180"
                  />
                  <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary ring-1 ring-primary/20">
                    {leafLabel}
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary ring-1 ring-primary/20">
                  <span className="size-1.5 rounded-full bg-primary" />
                  <span className="truncate">{active.label}</span>
                </span>
              )}
            </>
          ) : null}
        </nav>
      </div>

      {/* Right side: Global Search & Quick Actions */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Command Search Trigger */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="بحث شامل"
          className="group relative hidden h-9.5 w-60 items-center gap-2.5 rounded-xl border border-border/70 bg-muted/40 px-3.5 text-xs text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:bg-muted/80 hover:text-foreground sm:flex xl:w-72 shadow-2xs"
        >
          <Search className="size-4 shrink-0 transition-colors group-hover:text-primary" />
          <span className="truncate">بحث شامل في السجلات…</span>
          <kbd className="ms-auto inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background/80 px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground shadow-2xs">
            <Command className="size-3" /> K
          </kbd>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-xl sm:hidden hover:bg-muted"
          onClick={onOpenSearch}
          aria-label="بحث شامل"
        >
          <Search className="size-4.5" />
        </Button>

        {/* Notifications Bell */}
        <NotificationsBell tenant={tenant} token={session?.accessToken} role={role} base={base} />

        {/* Quick Language Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={switchLanguage}
          title={locale === 'ar' ? 'Switch to English' : 'التحويل للعربية'}
          className="size-9 shrink-0 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Globe className="size-4.5" />
        </Button>

        {/* Quick Theme Toggle */}
        {mounted ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="تبديل المظهر"
            className="size-9 shrink-0 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {theme === 'dark' ? (
              <Sun className="size-4.5 text-amber-400 transition-transform duration-200 hover:rotate-45" />
            ) : (
              <Moon className="size-4.5 text-indigo-500 transition-transform duration-200 hover:-rotate-12" />
            )}
          </Button>
        ) : null}

        <div className="mx-1 h-5 w-px bg-border/60" />

        {/* User Profile Pill & Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="قائمة الحساب"
              className="group flex items-center gap-2.5 rounded-xl border border-border/60 bg-card p-1 ps-1.5 pe-2.5 text-start transition-all duration-200 hover:border-primary/40 hover:bg-accent/40 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-primary/80 font-bold text-xs text-primary-foreground shadow-xs shadow-primary/20">
                {userInitials}
                <span className="absolute -bottom-0.5 -end-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
              </div>
              <div className="hidden min-w-0 text-start sm:block">
                <p className="max-w-[130px] truncate text-xs font-semibold text-foreground">
                  {displayName || 'المستخدم'}
                </p>
                <p className="max-w-[130px] truncate text-[10px] text-muted-foreground font-medium">
                  {roleLabel}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-2 rounded-2xl shadow-xl border-border/70 backdrop-blur-xl">
            <DropdownMenuLabel className="p-2 space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-primary/80 font-bold text-sm text-primary-foreground">
                  {userInitials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{displayName || 'مستخدم'}</p>
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {roleLabel}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-1" />

            <DropdownMenuLabel className="px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
              المظهر
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mounted ? (theme ?? 'system') : undefined}
              onValueChange={setTheme}
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <DropdownMenuRadioItem key={option.value} value={option.value} className="rounded-lg text-xs py-2">
                    <Icon className="size-4" aria-hidden />
                    <span>{option.label}</span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem onSelect={switchLanguage} className="rounded-lg text-xs py-2 cursor-pointer">
              <Languages className="size-4" aria-hidden />
              <span>{locale === 'ar' ? 'English Language' : 'اللغة العربية'}</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem destructive onSelect={signOut} className="rounded-lg text-xs py-2 cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive">
              <LogOut className="size-4" aria-hidden />
              <span className="font-semibold">تسجيل الخروج</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
