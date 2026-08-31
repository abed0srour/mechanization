'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Coins,
  DatabaseBackup,
  Hash,
  Map as MapIcon,
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
import { CadastreSection } from '@/components/admin/settings/cadastre-section';
import { SettingsTabs } from '@/components/admin/settings/settings-ui';
import { Skeleton } from '@/components/ui/skeleton';


type SectionId =
  | 'profile'
  | 'finance'
  | 'numbering'
  | 'cadastre'
  | 'security'
  | 'backup'
  | 'users';

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
  { id: 'cadastre', icon: MapIcon, label: (copy) => copy.nav.cadastre },
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

  if (!token) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-[28rem] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={SettingsIcon}
        title={copy.page.title}
        subtitle={copy.page.subtitle}
      />

      <div className="space-y-4">
        <SettingsTabs
          items={SECTIONS.map((section) => ({
            id: section.id,
            icon: section.icon,
            label: section.label(copy),
          }))}
          active={active}
          onSelect={setActive}
          label={copy.nav.label}
        />

        <div className="min-w-0">
          {active === 'profile' ? (
            <ProfileSection tenant={tenant} token={token} copy={copy} />
          ) : null}
          {active === 'finance' ? (
            <FinanceSection tenant={tenant} token={token} locale={locale} copy={copy} />
          ) : null}
          {active === 'numbering' ? (
            <NumberingSection tenant={tenant} token={token} copy={copy} />
          ) : null}
          {active === 'cadastre' ? (
            <CadastreSection tenant={tenant} token={token} copy={copy} />
          ) : null}
          {active === 'security' ? (
            <SecuritySection
              tenant={tenant}
              token={token}
              userId={userId}
              locale={locale}
              copy={copy}
              base={base}
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
