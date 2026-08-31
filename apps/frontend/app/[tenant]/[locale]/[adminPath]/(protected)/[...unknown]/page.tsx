'use client';

import { use } from 'react';
import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * An unknown URL *inside* the admin area.
 *
 * A catch-all rather than relying on the root `not-found.tsx`, because the two
 * are different situations. The root 404 is for someone who mistyped a
 * municipality; this is for a signed-in clerk who followed a stale link, and
 * they should land somewhere that still has the sidebar, still knows which
 * municipality they are in, and offers one click back to work.
 *
 * Next matches specific segments before a catch-all, so `/dashboard`,
 * `/citizens` and every other real route are unaffected — this only sees what
 * nothing else claimed.
 */
export default function AdminNotFound({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const base = `/${tenant}/${locale}/${adminPath}`;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
      >
        <FileQuestion className="size-7" />
      </span>

      <div className="space-y-2">
        <p className="font-mono text-sm tracking-[0.2em] text-muted-foreground">404</p>
        <h1 className="font-display text-xl font-bold tracking-tight">الصفحة غير موجودة</h1>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          هذا الرابط لا يقابل أي صفحة في لوحة الإدارة. قد يكون قديماً أو مكتوباً بشكل خاطئ.
        </p>
      </div>

      {/*
        Points at the admin base rather than at `/dashboard`: that page is
        restricted, and the index resolves each role to a section it may
        actually open.
      */}
      <Button asChild variant="outline">
        <Link href={base}>العودة إلى لوحة الإدارة</Link>
      </Button>
    </div>
  );
}
