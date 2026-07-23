import { notFound } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface TenantConfig {
  slug: string;
  name: string;
  nameAr: string;
  logoUrl?: string;
  primaryColor?: string;
  contactPhone?: string;
}

async function getTenant(slug: string): Promise<TenantConfig | null> {
  try {
    const response = await fetch(`${API_URL}/t/${slug}/config`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    return response.json();
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

  return (
    <html lang={locale} dir={isRtl ? 'rtl' : 'ltr'}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Kufi+Arabic:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={
          config.primaryColor
            ? ({ '--cedar': config.primaryColor } as React.CSSProperties)
            : undefined
        }
      >
        <header className="border-b-2 border-ink/10 bg-card">
          <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-5">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt="" className="h-14 w-14 object-contain" />
            ) : (
              <div
                aria-hidden
                className="stamp flex h-14 w-14 items-center justify-center font-display text-sm"
              >
                {config.nameAr.slice(0, 2)}
              </div>
            )}
            <div>
              <p className="font-display text-xl font-bold">{config.nameAr}</p>
              <p className="text-sm text-muted">تسجيل العقارات والوحدات السكنية</p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-5 py-8">{children}</main>

        <footer className="mt-16 border-t border-rule py-6 text-center text-sm text-muted">
          {config.contactPhone ? (
            <p>
              للمساعدة اتصل بالبلدية:{' '}
              <a className="font-medium text-cedar underline" href={`tel:${config.contactPhone}`}>
                {config.contactPhone}
              </a>
            </p>
          ) : null}
        </footer>
      </body>
    </html>
  );
}
