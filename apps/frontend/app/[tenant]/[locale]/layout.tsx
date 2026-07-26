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

/**
 * The `<html>`/`<body>` shell for every route under this tenant — citizen
 * pages and the staff portal alike — plus the one thing both genuinely share:
 * language direction and the municipality's branding colour.
 *
 * Deliberately carries no header, container width or footer. Those used to
 * live here and applied to every route by construction, which put the staff
 * dashboard and the fullscreen map inside the citizen wizard's
 * `max-w-3xl` reading column — a limit chosen for a single-column form, wrong
 * for a data table and fatal for a full-viewport map. Citizen-facing chrome
 * now lives in `(citizen)/layout.tsx`, scoped to the routes that are actually
 * citizen-facing; `[adminPath]/**` pages own their own full-width shell.
 */
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
  // tenant, so a wrong slug means the visitor — citizen or staff — is in the
  // wrong place entirely.
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
          config.branding.primaryColor
            ? ({
                '--primary': config.branding.primaryColor,
                '--ring': config.branding.primaryColor,
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </body>
    </html>
  );
}
