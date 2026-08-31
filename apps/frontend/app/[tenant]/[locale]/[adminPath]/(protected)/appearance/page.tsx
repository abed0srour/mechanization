'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Check, Laptop, Moon, Palette, Sun } from 'lucide-react';
import { loadSession } from '@/lib/session';
import { type AccentId } from '@/lib/accents';
import { useAccent } from '@/components/accent-provider';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

/** The tick on a chosen card. */
function SelectedBadge() {
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

/**
 * A miniature of the portal in a given mode.
 *
 * Drawn from divs rather than a screenshot so it cannot fall out of date with
 * the palette it is advertising — and «حسب النظام» is split down the middle,
 * because being both is the whole point of that option.
 */
function ModePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  const pane = (dark: boolean, className?: string) => (
    <div
      className={cn(
        'flex flex-col gap-2 p-3',
        dark ? 'bg-[#0d0d0c]' : 'bg-[#faf9f6]',
        className,
      )}
    >
      <div className={cn('h-2 w-3/4 rounded-full', dark ? 'bg-white/25' : 'bg-black/15')} />
      <div className={cn('h-2 w-1/2 rounded-full', dark ? 'bg-white/15' : 'bg-black/10')} />
      <div className={cn('mt-1 h-8 rounded-md', dark ? 'bg-white/10' : 'bg-white')} />
    </div>
  );

  if (mode === 'system') {
    return (
      <div className="grid h-28 grid-cols-2 overflow-hidden rounded-lg border" dir="ltr">
        {pane(false)}
        {pane(true)}
      </div>
    );
  }
  return (
    <div className="h-28 overflow-hidden rounded-lg border">
      {pane(mode === 'dark', 'h-full')}
    </div>
  );
}

/** One selectable card — shared by both sections so selection reads identically. */
function OptionCard({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border bg-card p-3 text-start transition-colors',
        selected ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/20',
      )}
    >
      {children}
    </button>
  );
}

/**
 * المظهر — light/dark and the accent palette.
 *
 * Its own page rather than a corner of إعدادات البلدية, because the two answer
 * to different people: the municipality's Whish number is a fact about the
 * institution and is SUPER_ADMIN-only, while this is one staff member's
 * preference on one browser. Every role reaches it.
 */
export default function AppearancePage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const modes = [
    {
      id: 'light' as const,
      label: locale === 'en' ? 'Light' : 'فاتح',
      hint: locale === 'en' ? 'Light crisp background at all times' : 'خلفية كريمية فاتحة طوال الوقت',
      icon: Sun,
    },
    {
      id: 'dark' as const,
      label: locale === 'en' ? 'Dark' : 'داكن',
      hint: locale === 'en' ? 'Comfortable for eyes in low light' : 'مريح للعين في الإضاءة المنخفضة',
      icon: Moon,
    },
    {
      id: 'system' as const,
      label: locale === 'en' ? 'System' : 'حسب النظام',
      hint: locale === 'en' ? 'Automatically follows device settings' : 'يتبع إعداد الجهاز تلقائياً',
      icon: Laptop,
    },
  ];

  const accents = [
    {
      id: 'municipal',
      label: locale === 'en' ? 'Municipal Blue' : 'الأزرق البلدي',
      hint: locale === 'en' ? 'Default platform color' : 'اللون الافتراضي للمنصّة',
      swatch: ['#1a4f9c', '#2f6fd0'],
    },
    {
      id: 'emerald',
      label: locale === 'en' ? 'Olive Emerald' : 'الأخضر الزيتوني',
      hint: locale === 'en' ? 'Calm and comfortable for long reading' : 'هادئ ومناسب للقراءة الطويلة',
      swatch: ['#166a45', '#22a06b'],
    },
    {
      id: 'rose',
      label: locale === 'en' ? 'Rose Red' : 'الأحمر الوردي',
      hint: locale === 'en' ? 'Warm and distinct' : 'لون دافئ وواضح',
      swatch: ['#b31843', '#e23e6b'],
    },
    {
      id: 'violet',
      label: locale === 'en' ? 'Violet' : 'البنفسجي',
      hint: locale === 'en' ? 'High contrast in dark mode' : 'تباين عالٍ في الوضع الداكن',
      swatch: ['#5b32bd', '#8b5cf6'],
    },
    {
      id: 'sunset',
      label: locale === 'en' ? 'Sunset Orange' : 'البرتقالي',
      hint: locale === 'en' ? 'Warm coastal sunset tones' : 'مستوحى من غروب الساحل',
      swatch: ['#c2510c', '#f97316'],
    },
  ];

  const [token, setToken] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
  }, [tenant, base, router]);

  if (!token) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={Palette}
        title={locale === 'en' ? 'Appearance' : 'المظهر'}
        subtitle={
          locale === 'en'
            ? 'Choose theme mode and accent color — saved for this browser only'
            : 'اختر وضع الإضاءة ولون الواجهة — يُحفظ على هذا المتصفّح وحده'
        }
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{locale === 'en' ? 'Theme Mode' : 'وضع الإضاءة'}</h2>
          <p className="text-sm text-muted-foreground">
            {locale === 'en'
              ? '"System" matches your device setting and switches with it automatically.'
              : '«حسب النظام» يتبع إعداد جهازك ويتبدّل معه تلقائياً.'}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {modes.map(({ id, label, hint, icon: Icon }) => (
            <OptionCard
              key={id}
              selected={mounted && theme === id}
              onSelect={() => setTheme(id)}
            >
              <ModePreview mode={id} />
              <div className="mt-3 flex items-start gap-2 px-1 pb-1">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{label}</div>
                  <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
                </div>
                {mounted && theme === id ? <SelectedBadge /> : null}
              </div>
            </OptionCard>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{locale === 'en' ? 'Accent Color' : 'لون الواجهة'}</h2>
          <p className="text-sm text-muted-foreground">
            {locale === 'en'
              ? 'Applies instantly to buttons, links, and active elements. Does not alter municipality logo or status badges.'
              : 'يُطبَّق فوراً على الأزرار والروابط والعناصر النشطة. لا يغيّر شعار البلدية ولا ألوان الحالات (مسدَّد، متأخّر، قيد المراجعة).'}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accents.map(({ id, label, hint, swatch }) => (
            <OptionCard
              key={id}
              selected={accent === id}
              onSelect={() => setAccent(id as AccentId)}
            >
              <div className="flex items-center gap-3 p-1">
                <span className="relative flex h-7 w-11 shrink-0 items-center" aria-hidden>
                  <span
                    className="absolute start-0 size-7 rounded-full"
                    style={{ background: swatch[0] }}
                  />
                  <span
                    className="absolute start-4 size-7 rounded-full border-2 border-card"
                    style={{ background: swatch[1] }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{label}</div>
                  <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
                </div>
                {accent === id ? <SelectedBadge /> : null}
              </div>
            </OptionCard>
          ))}
        </div>
      </section>
    </div>
  );
}
