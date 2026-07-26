import { notFound } from 'next/navigation';
import type { PublicTenantConfig } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Same call the parent tenant layout makes; Next dedupes identical fetches within one request. */
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
 * The citizen wizard's chrome: municipality header, a `max-w-3xl` reading
 * column sized for a single-column form, and a support-phone footer.
 *
 * Scoped to this route group on purpose — `/report`, `/login`, `/my-account`
 * and the landing page all want a citizen reading someone their phone at
 * arm's length. The staff portal under `[adminPath]/**` sits outside this
 * group entirely and provides its own full-width shell.
 */
export default async function CitizenLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant } = await params;
  const config = await getTenant(tenant);
  if (!config) notFound();

  const { branding } = config;

  return (
    <>
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
    </>
  );
}
