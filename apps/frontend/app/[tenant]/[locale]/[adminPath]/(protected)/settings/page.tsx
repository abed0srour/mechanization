'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Coins, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { loadSession } from '@/lib/session';
import { settingsCopy, type SettingsCopy } from '@/lib/settings-i18n';
import { PageHeader } from '@/components/ui/page-header';
import { ProfileSection } from '@/components/admin/settings/profile-section';
import { FinanceSection } from '@/components/admin/settings/finance-section';
import { cn } from '@/lib/utils';

type SectionId = 'profile' | 'finance';

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
  }, [tenant, base, router]);

  if (!token) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={SettingsIcon}
        title={copy.page.title}
        subtitle={copy.page.subtitle}
      />

      <div className="flex flex-col gap-8 lg:flex-row">
        {/*
          A rail on a wide screen, a scrolling strip on a narrow one. Six
          sections is past what fits as tabs on a phone, and a `<select>` there
          hides the list an administrator is trying to learn the shape of.
        */}
        <nav
          aria-label={copy.nav.label}
          className="lg:w-56 lg:shrink-0"
        >
          <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = active === section.id;
              return (
                <li key={section.id} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => setActive(section.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="whitespace-nowrap lg:whitespace-normal lg:text-start">
                      {section.label(copy)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          {active === 'profile' ? (
            <ProfileSection tenant={tenant} token={token} copy={copy} />
          ) : null}
          {active === 'finance' ? (
            <FinanceSection tenant={tenant} token={token} locale={locale} copy={copy} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
