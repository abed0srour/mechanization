'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Coins,
  DatabaseBackup,
  Hash,
  Settings as SettingsIcon,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { loadSession } from '@/lib/session';
import { settingsCopy, type SettingsCopy } from '@/lib/settings-i18n';
import { PageHeader } from '@/components/ui/page-header';
import { ProfileSection } from '@/components/admin/settings/profile-section';
import { FinanceSection } from '@/components/admin/settings/finance-section';
import { NumberingSection } from '@/components/admin/settings/numbering-section';
import { SecuritySection } from '@/components/admin/settings/security-section';
import { BackupSection } from '@/components/admin/settings/backup-section';
import { UsersSection } from '@/components/admin/settings/users-section';
import { cn } from '@/lib/utils';

type SectionId = 'profile' | 'finance' | 'numbering' | 'security' | 'backup' | 'users';

interface SectionDef {
  id: SectionId;
  icon: LucideIcon;
  label: (copy: SettingsCopy) => string;
}

/**
 * The settings sections, in the order a municipality sets them up.
 *
 * Grows one entry per section as each is built. The list is the single source
 * for both the rail and the panel, so a section can never be reachable from one
 * and missing from the other.
 */
const SECTIONS: SectionDef[] = [
  { id: 'profile', icon: Building2, label: (copy) => copy.nav.profile },
  { id: 'finance', icon: Coins, label: (copy) => copy.nav.finance },
  { id: 'numbering', icon: Hash, label: (copy) => copy.nav.numbering },
  { id: 'security', icon: ShieldCheck, label: (copy) => copy.nav.security },
  { id: 'backup', icon: DatabaseBackup, label: (copy) => copy.nav.backup },
  { id: 'users', icon: UsersRound, label: (copy) => copy.nav.users },
];

/**
 * إعدادات البلدية — every configuration surface the municipality owns.
 *
 * This replaces a single flat form of five contact fields. Those fields are
 * still here, under the profile section, but they are now one section of six
 * rather than the whole of what a municipality can configure.
 *
 * **Bilingual, unlike the rest of the portal.** Every other admin screen is
 * Arabic-only, which is right for the clerks who live in them. Settings is
 * where a vendor or an auditor works, so it reads the `[locale]` segment the
 * route has always carried and the header has always switched. Direction comes
 * free — `TenantLayout` already sets `dir` on `<html>` — so the sections use
 * logical properties throughout and never ask which language they are in.
 *
 * SUPER_ADMIN only. The redirect is a courtesy: every write behind this page is
 * role-guarded server-side, and showing an auditor a form that can only refuse
 * them is worse than not showing it.
 */
export default function SettingsPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;
  const copy = settingsCopy(locale);

  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [active, setActive] = useState<SectionId>('profile');

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    if (session.user.role !== 'SUPER_ADMIN') {
      router.replace(`${base}/dashboard`);
      return;
    }
    setToken(session.accessToken);
    setUserId(session.user.id);
  }, [tenant, base, router]);

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <PageHeader
        icon={SettingsIcon}
        title={copy.page.title}
        subtitle={copy.page.subtitle}
      />

      {/*
        `items-start` on the row, and the rail sticks. Without the first, the
        rail stretches to the height of whichever section is open and its
        buttons float in a 2000px column; without the second, choosing a section
        from the bottom of a long page means scrolling back up to change it.
      */}
      <div className="mt-6 flex flex-col items-start gap-6 lg:mt-8 lg:flex-row lg:gap-8">
        {/*
          A rail on a wide screen, a scrolling strip on a narrow one. Six
          sections is past what fits as tabs on a phone, and a `<select>` there
          hides the list an administrator is still learning the shape of.
        */}
        <nav
          aria-label={copy.nav.label}
          className="w-full lg:sticky lg:top-6 lg:w-60 lg:shrink-0"
        >
          {/*
            Bled to the viewport edge below `lg` so the strip scrolls out of the
            page's own padding rather than clipping mid-word at the gutter —
            which reads as a cut-off label instead of as more content sideways.
          */}
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = active === section.id;
              return (
                <li key={section.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setActive(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {/*
                      Never wraps, at any width. In the rail a two-word label
                      like «النسخ الاحتياطي والاستعادة» would wrap to three
                      lines and make one row three times the height of its
                      neighbours; the rail is wide enough to hold the longest
                      of them on one line.
                    */}
                    <span className="truncate whitespace-nowrap">{section.label(copy)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="w-full min-w-0 flex-1">
          {active === 'profile' ? (
            <ProfileSection tenant={tenant} token={token} copy={copy} />
          ) : null}
          {active === 'finance' ? (
            <FinanceSection tenant={tenant} token={token} locale={locale} copy={copy} />
          ) : null}
          {active === 'numbering' ? <NumberingSection tenant={tenant} copy={copy} /> : null}
          {active === 'security' ? (
            <SecuritySection
              tenant={tenant}
              token={token}
              userId={userId}
              locale={locale}
              copy={copy}
            />
          ) : null}
          {active === 'backup' ? (
            <BackupSection tenant={tenant} token={token} locale={locale} copy={copy} />
          ) : null}
          {active === 'users' ? (
            <UsersSection tenant={tenant} token={token} copy={copy} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
