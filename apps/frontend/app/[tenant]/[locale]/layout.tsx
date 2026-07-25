import { notFound } from 'next/navigation';
import type { PublicTenantConfig } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * Server-side fetch so the municipality's name and branding are in the first
 * HTML response — a citizen on a slow connection should not watch an unbranded
 * shell resolve into a government form.
 */
async function getTenant(slug: string): Promise<PublicTenantConfig | null> {
  try {
    const response = await fetch(`${API_URL}/t/${slug}/tenant/config`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    return (await response.json()) as PublicTenantConfig;
  } catch {
    return null;
  }
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant, locale } = await params;
  const config = await getTenant(tenant);

  // An unknown municipality is a 404, not a generic error page: the slug is the
  // tenant, so a wrong slug means the citizen is in the wrong place entirely.
  if (!config) notFound();

  const isRtl = locale === 'ar';
  const { branding } = config;

  return (
    <html lang={locale} dir={isRtl ? 'rtl' : 'ltr'}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Kufi+Arabic:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-screen bg-muted/30 font-sans antialiased"
        /**
         * Per-tenant branding overrides the primary hue only, and only when the
         * municipality supplied one. The rest of the palette is fixed so a
         * configuration mistake cannot produce an unreadable form.
         *
         * The value must be an HSL channel triple (e.g. "199 89% 30%") because
         * every use site composes alpha into it as `hsl(var(--primary) / …)`.
         */
        style={
          branding.primaryColor
            ? ({ '--primary': branding.primaryColor, '--ring': branding.primaryColor } as React.CSSProperties)
            : undefined
        }
      >
        <header className="border-b bg-background">
          <div className="container flex items-center gap-4 py-4">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt="" className="h-12 w-12 object-contain" />
            ) : (
              <div
                aria-hidden
                className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground"
              >
                {config.nameAr.slice(0, 2)}
              </div>
            )}
            <div>
              <p className="text-lg font-bold leading-tight">{config.nameAr}</p>
              <p className="text-sm text-muted-foreground">تسجيل العقارات والوحدات السكنية</p>
            </div>
          </div>
        </header>

        <main className="container max-w-3xl py-8">{children}</main>

        <footer className="mt-16 border-t py-6 text-center text-sm text-muted-foreground">
          {config.supportPhone ? (
            <p>
              للمساعدة اتصل بالبلدية:{' '}
              <a
                className="font-medium text-primary hover:underline"
                href={`tel:${config.supportPhone}`}
              >
                {config.supportPhone}
              </a>
            </p>
          ) : null}
        </footer>
      </body>
    </html>
  );
}
