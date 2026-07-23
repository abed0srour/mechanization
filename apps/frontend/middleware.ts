import { NextRequest, NextResponse } from 'next/server';

const LOCALES = ['ar', 'en'] as const;
const DEFAULT_LOCALE = 'ar';

/**
 * URL shape: /{municipality}/{locale}/...
 *
 * The municipality slug is the tenant. The staff portal lives on a per-tenant
 * unguessable segment, so the obvious /dashboard path is hard-404'd rather than
 * redirected — a redirect would confirm the portal exists.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    // No municipality in the URL: nothing sensible to show.
    return NextResponse.rewrite(new URL('/not-found', request.url));
  }

  const [tenant, maybeLocale] = segments;

  if (maybeLocale === 'dashboard' || maybeLocale === 'admin') {
    return new NextResponse('Not found', { status: 404 });
  }

  if (!maybeLocale || !LOCALES.includes(maybeLocale as (typeof LOCALES)[number])) {
    const url = request.nextUrl.clone();
    url.pathname = `/${tenant}/${DEFAULT_LOCALE}${maybeLocale ? `/${segments.slice(1).join('/')}` : ''}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
