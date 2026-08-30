'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LanguageToggleProps {
  locale: string;
  className?: string;
  variant?: 'ghost' | 'outline' | 'default' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  showLabel?: boolean;
}

export function LanguageToggle({
  locale,
  className,
  variant = 'ghost',
  size = 'sm',
  showLabel = true,
}: LanguageToggleProps) {
  const pathname = usePathname();
  const router = useRouter();

  const isArabic = locale === 'ar';
  const targetLocale = isArabic ? 'en' : 'ar';
  const targetLabel = isArabic ? 'English' : 'عربي';
  const tooltip = isArabic ? 'التحويل إلى اللغة الإنجليزية' : 'Switch to Arabic';

  function handleToggle() {
    if (!pathname) return;
    // Regex matching /:tenant/:locale(/...)?
    const regex = new RegExp(`^/([^/]+)/(${locale})(/.*)?$`);
    if (regex.test(pathname)) {
      const nextPath = pathname.replace(regex, (_match, tenant, _oldLocale, rest = '') => `/${tenant}/${targetLocale}${rest}`);
      router.push(nextPath);
    } else {
      router.push(`/${targetLocale}`);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleToggle}
      className={cn(
        'h-9 shrink-0 gap-1.5 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors',
        className,
      )}
      title={tooltip}
      aria-label={tooltip}
    >
      <Languages className="size-4 text-primary shrink-0 transition-transform group-hover:scale-110" aria-hidden />
      {showLabel ? (
        <span className="font-medium tracking-wide">
          {targetLabel}
        </span>
      ) : null}
    </Button>
  );
}
