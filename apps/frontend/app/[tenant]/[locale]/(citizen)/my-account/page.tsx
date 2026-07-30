'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import {
  ar,
  REJECTABLE_FIELDS,
  type RejectableField,
} from '@mechanization/shared-schemas';
import { ApiRequestError, listMyRegistrations, logApiError } from '@/lib/api-client';
import type { RegistrationListItem } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CorrectionForm } from '@/components/citizen/correction-form';

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
  const [token, setToken] = useState<string | null>(null);
  /** Registration whose correction form is open, if any. */
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  /** Bumped after a correction so the list refetches its new status. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session) {
      router.replace(`/${tenant}/${locale}/login`);
      return;
    }

    setName(session.user.name);
    setToken(session.accessToken);

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
  }, [tenant, locale, router, reloadKey]);

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
                <StatusBadge
                  status={item.status}
                  label={ar.reportStatus[item.status as never] ?? item.status}
                />
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

              {item.status === 'REJECTED' ? (
                <RejectionNotice
                  reason={item.rejectionReason}
                  fields={item.rejectedFields}
                  canCorrect={item.citizenCanCorrect}
                  revisitAt={item.revisitAt}
                  onCorrect={() => setCorrectingId(item.id)}
                />
              ) : null}
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

      {token ? (
        <CorrectionForm
          tenant={tenant}
          token={token}
          registrationId={correctingId}
          open={correctingId !== null}
          onOpenChange={(next) => {
            if (!next) setCorrectingId(null);
          }}
          // The claim is back to قيد الانتظار — refetch so the card stops
          // showing a rejection the citizen has just answered.
          onCorrected={() => setReloadKey((key) => key + 1)}
        />
      ) : null}
    </div>
  );
}

/**
 * What the municipality said, and exactly what to fix.
 *
 * A refused claim previously showed the applicant a red "مرفوض" badge and
 * nothing else — the reason was stored, and never sent to the one person who
 * had to act on it. The flagged fields are listed by their Arabic captions
 * rather than the stored dot-paths, resolved through the same shared registry
 * the reviewer picked them from.
 */
function RejectionNotice({
  reason,
  fields,
  canCorrect,
  revisitAt,
  onCorrect,
}: {
  reason: string | null;
  fields: string[];
  canCorrect: boolean;
  revisitAt: string | null;
  onCorrect: () => void;
}) {
  // A key the registry does not know is skipped rather than shown raw: it can
  // only mean the vocabulary changed after this rejection was written, and
  // "property.legacyThing" means nothing to a citizen.
  const captions = fields
    .map((field) => REJECTABLE_FIELDS[field as RejectableField])
    .filter(Boolean);

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        يحتاج طلبك إلى تصحيح
      </p>

      {reason ? <p className="text-sm">{reason}</p> : null}

      {captions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">الحقول المطلوب تصحيحها:</p>
          <ul className="flex flex-wrap gap-1.5">
            {captions.map((caption) => (
              <li key={caption}>
                <Badge variant="destructive">{caption}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canCorrect ? (
        <Button size="sm" onClick={onCorrect}>
          تصحيح وإعادة التقديم
        </Button>
      ) : (
        /* The municipality asked for this one in person. Offering the online
           form anyway would send the citizen to a dead end — the server
           refuses the correction too, not just this page. */
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 shrink-0" aria-hidden />
            يرجى مراجعة البلدية لتصحيح البيانات
          </p>
          {revisitAt ? (
            <p className="text-sm">
              الموعد المحدّد:{' '}
              <span className="font-medium">
                {new Date(revisitAt).toLocaleString('ar-LB', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              يمكنك المراجعة خلال أوقات الدوام الرسمية مع رقمك المرجعي.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
