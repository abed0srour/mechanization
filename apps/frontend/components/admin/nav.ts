import {
  ArrowLeftRight,
  LayoutDashboard,
  Layers,
  Map as MapIcon,
  Palette,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * The admin section list, and the rules for reading it.
 *
 * Lifted out of `AdminSidebar` because it is no longer only the sidebar's
 * business: the header derives the breadcrumb and the page title from the same
 * list, the mobile drawer renders the same rows, and the command palette
 * searches them. Three copies of "which section is this route in" is three
 * chances for the highlighted row and the breadcrumb to disagree.
 */

export interface NavItem {
  /** Appended to the tenant's admin base path. */
  path: string;
  label: string;
  icon: LucideIcon;
  /** Omitted = every staff role can see it. */
  roles?: string[];
  /** Extra words the command palette matches on, beyond the label. */
  keywords?: string[];
}

export interface NavGroup {
  /** Shown as a small caps heading; hidden when the rail is folded. */
  label: string;
  /** Omitted = every staff role can see it. */
  roles?: string[];
  items: NavItem[];
}

/**
 * Three groups, in the order a clerk's day runs: the register and the money it
 * generates, then the land those records describe, then the portal's own
 * administration.
 *
 * A flat list of ten was past scannable — «القطاعات» and «الموظفون» read as
 * equally likely neighbours of «المواطنون» when they belong to different jobs
 * entirely.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'السجل',
    items: [
      // The register's overview, so the register's roles — see DashboardController.
      {
        path: '/dashboard',
        label: 'لوحة التحكم',
        icon: LayoutDashboard,
        roles: ['SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR'],
        keywords: ['مؤشرات', 'تحليلات', 'إحصاءات'],
      },
      // Directly under the dashboard: the dashboard reports on the register,
      // and this is the register itself — one row per person.
      {
        path: '/citizens',
        label: 'المواطنون',
        icon: Users,
        keywords: ['سجل', 'مواطن', 'عقار', 'استيراد'],
      },
      // Next to the registry rather than under settings: a fee is issued
      // against the citizens in it, not configured in isolation.
      {
        path: '/fees',
        label: 'الرسوم والمدفوعات',
        icon: Receipt,
        keywords: ['رسم', 'مطالبة', 'فاتورة', 'دفع'],
      },
      // Read-only: the ledger above answers "who owes what", this answers
      // "what has been paid". An auditor lives here.
      {
        path: '/payments',
        label: 'سجل العمليات',
        icon: ArrowLeftRight,
        roles: ['SUPER_ADMIN', 'AUDITOR', 'COLLECTOR', 'ACCOUNTANT'],
        keywords: ['قبض', 'إيصال', 'محصّل', 'نقد'],
      },
    ],
  },
  {
    label: 'الأرض',
    items: [
      {
        path: '/map',
        label: 'الخريطة',
        icon: MapIcon,
        roles: ['SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR'],
        keywords: ['عقارات', 'مواقع', 'مسح'],
      },
      {
        path: '/zones',
        label: 'القطاعات',
        icon: Layers,
        roles: ['SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR', 'ACCOUNTANT', 'ADMINISTRATIVE_OFFICER'],
        keywords: ['قطاع', 'منطقة', 'حدود'],
      },
    ],
  },
  {
    label: 'النظام',
    roles: ['SUPER_ADMIN'],
    items: [
      {
        path: '/appearance',
        label: 'المظهر',
        icon: Palette,
        roles: ['SUPER_ADMIN'],
        keywords: ['ألوان', 'سمة', 'داكن'],
      },
      {
        path: '/audit',
        label: 'سجل النشاطات',
        icon: ShieldCheck,
        roles: ['SUPER_ADMIN'],
        keywords: ['تدقيق', 'تاريخ', 'تغييرات'],
      },
      {
        path: '/settings',
        label: 'إعدادات البلدية',
        icon: Settings,
        roles: ['SUPER_ADMIN'],
        keywords: ['ويش', 'واتساب', 'عنوان', 'دوام'],
      },
      {
        path: '/staff',
        label: 'الموظفون',
        icon: UsersRound,
        roles: ['SUPER_ADMIN'],
        keywords: ['موظف', 'صلاحيات', 'حساب'],
      },
    ],
  },
];

/** The groups this role may see, with empty groups dropped entirely. */
export function visibleGroups(role: string | undefined): NavGroup[] {
  return NAV_GROUPS
    .filter((group) => !group.roles || (role && group.roles.includes(role)))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || (role && item.roles.includes(role))),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Which nav row a pathname belongs to — **longest match wins**.
 *
 * A plain `startsWith` lights up two rows wherever one route is a prefix of
 * another, and `/citizens` became such a prefix the moment `/citizens/:id`
 * existed. Matching on the longest candidate keeps a detail page attributed to
 * its own section rather than to whichever prefix was declared first.
 *
 * Takes the full pathname and the tenant's admin base so callers do not each
 * rebuild `/{tenant}/{locale}/{adminPath}` and get the trailing slash wrong.
 */
export function activeNavItem(
  pathname: string | null,
  base: string,
  role: string | undefined,
): NavItem | undefined {
  if (!pathname) return undefined;
  const candidates = visibleGroups(role)
    .flatMap((group) => group.items)
    .filter((item) => {
      const href = `${base}${item.path}`;
      return pathname === href || pathname.startsWith(`${href}/`);
    })
    .sort((a, b) => b.path.length - a.path.length);
  return candidates[0];
}
