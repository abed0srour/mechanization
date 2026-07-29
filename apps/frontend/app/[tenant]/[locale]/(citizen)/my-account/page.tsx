'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ar } from '@mechanization/shared-schemas';
import { ApiRequestError, listMyRegistrations, logApiError } from '@/lib/api-client';
import type { RegistrationListItem } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge, STATUS_BADGE_VARIANT } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Citizen account view: every submission with its current status, and the رقم
 * مرجعي they can quote at the municipality counter.
 */
export default function MyAccount({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant, locale } = use(params);
  const router = useRouter();

  const [items, setItems] = useState<RegistrationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session) {
      router.replace(`/${tenant}/${locale}/login`);
      return;
    }

    setName(session.user.name);

    listMyRegistrations(tenant, session.accessToken)
      .then((response) => setItems(response.items))
      .catch((caught) => {
        logApiError(caught);
        // An expired token is the common case, not an error worth alarming
        // someone with — send them back to sign in.
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`/${tenant}/${locale}/login`);
          return;
        }
        setError('تعذّر تحميل طلباتك. حاول مرة أخرى.');
      });
  }, [tenant, locale, router]);

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">طلباتي</h1>
          {name ? <p className="text-muted-foreground">أهلاً {name}</p> : null}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            clearSession(tenant);
            router.push(`/${tenant}/${locale}`);
          }}
        >
          خروج
        </Button>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      {items === null && !error ? (
        <p className="text-muted-foreground">جارٍ التحميل…</p>
      ) : null}

      {items?.length === 0 ? (
        <Card>
          <CardContent className="space-y-5 p-6 text-center">
            <p className="text-lg">لا توجد طلبات مسجّلة بهذا الرقم بعد.</p>
            <Link
              href={`/${tenant}/${locale}/report`}
              className={buttonVariants({ size: 'lg' })}
            >
              تقديم طلب جديد
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        {items?.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">الرقم المرجعي</p>
                  <p className="text-xl font-bold" dir="ltr">
                    {item.referenceNumber}
                  </p>
                </div>
                <Badge variant={STATUS_BADGE_VARIANT[item.status] ?? 'secondary'}>
                  {ar.reportStatus[item.status as never] ?? item.status}
                </Badge>
              </div>

              <dl className="mt-4 space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">تاريخ التقديم</dt>
                  <dd>{new Date(item.submittedAt).toLocaleDateString('ar-LB')}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">عدد العقارات</dt>
                  <dd>{item.propertyCount}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {items && items.length > 0 ? (
        <Link
          href={`/${tenant}/${locale}/report`}
          className={buttonVariants({
            variant: 'outline',
            size: 'lg',
            className: 'w-full border-dashed border-primary text-primary hover:bg-primary/5',
          })}
        >
          + تقديم طلب آخر
        </Link>
      ) : null}
    </div>
  );
}
