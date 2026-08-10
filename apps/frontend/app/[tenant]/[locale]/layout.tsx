import { notFound } from 'next/navigation';
import type { PublicTenantConfig } from '@/lib/api-client';
import { ACCENT_INIT_SCRIPT } from '@/lib/accents';
import { AccentProvider } from '@/components/accent-provider';
import { ThemeProvider } from '@/components/theme-provider';

/**
 * Validates a municipality's brand colour before it reaches a `<style>` tag.
 *
 * The value arrives from the tenant config — a database row an administrator
 * edits — and is interpolated into a stylesheet. Interpolating it unchecked
 * would let `}` close the rule and anything after it be arbitrary CSS on every
 * page of that municipality's portal, which is a real injection even without
 * script: CSS can load remote URLs and read attribute values.
 *
 * Accepting only an HSL channel triple (`199 89% 30%`) is also what the rest of
 * the palette needs anyway, since every use site composes alpha into it as
 * `hsl(var(--primary) / …)` — a hex here would break `bg-primary/90` silently.
 */
function safeHslTriple(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/.test(trimmed)
    ? trimmed
    : null;
}

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
  const brandPrimary = safeHslTriple(config.branding.primaryColor);

  return (
    /*
      `suppressHydrationWarning` is required by `next-themes` and applies to
      this element's attributes only, not to the tree below it. The provider's
      pre-paint script writes `class="dark"` and `style="color-scheme:dark"`
      onto <html> before React hydrates, so the server's markup and the
      client's necessarily disagree here — and only here. Without it every
      staff member using dark mode gets a hydration warning on every load.
    */
    <html lang={locale} dir={isRtl ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Kufi+Arabic:wght@500;700&display=swap"
          rel="stylesheet"
        />
        {/*
          The hand-rolled light/dark pre-paint script that used to sit here is
          gone. `next-themes` injects an equivalent one of its own, and running
          both would mean two scripts racing to set the same class from the same
          storage key — with the loser's answer silently winning whenever the
          third setting («النظام») disagreed with the two the old script knew
          about. Its storage key survives as `ThemeProvider`'s `storageKey`.

          The accent script below is a different matter: it owns `data-accent`
          and its own key, touches nothing `next-themes` touches, and exists for
          the same reason — without it the portal paints in the default palette
          and snaps to the chosen one a frame later.
        */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />

        {/*
          The municipality's own brand colour, when it configured one.

          Written as a `:root` rule rather than an inline style on <body>, for
          two reasons. Custom properties resolve against the element they are
          declared on, and `--primary` is declared on `:root` — a
          `--brand-primary` sitting on <body> would simply never be seen by the
          `var()` that reads it. And keeping it off the inline style attribute
          leaves that attribute to `next-themes`, which writes `color-scheme`
          there.

          Precedence falls out of this: an explicit accent (`[data-accent]`,
          also on the root) overrides `--primary` outright, so a staff member's
          choice beats the municipality's default rather than being silently
          ignored.
        */}
        {brandPrimary ? (
          <style
            dangerouslySetInnerHTML={{ __html: `:root{--brand-primary:${brandPrimary}}` }}
          />
        ) : null}
      </head>
      <body className="min-h-screen bg-muted/30 font-sans antialiased">
        <ThemeProvider>
          <AccentProvider>{children}</AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
