'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, UserPlus, UserRoundPen } from 'lucide-react';
import {
  ApiRequestError,
  createCitizen,
  getCitizenForm,
  getTenantConfig,
  logApiError,
  updateCitizen,
} from '@/lib/api-client';
import type { PublicTenantConfig } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/states';
import {
  CitizenForm,
  EMPTY_CITIZEN,
  toPayloadProperty,
  toPropertyDraft,
  text,
  type CitizenFormValues,
} from './citizen-form';

/**
 * Create or correct one citizen, on a page of its own.
 *
 * A page rather than a modal: this form is the wizard's three data steps at
 * full size, with a repeatable property card that carries its own repeatable
 * unit editor inside it. A household with a four-unit building is several
 * screens tall, and a dialog that scrolls internally would put the clerk's
 * «حفظ» and the field they are typing in two different scroll contexts.
 */
export function CitizenEditor({
  tenant,
  locale,
  adminPath,
  /** Absent = creating. */
  citizenId,
}: {
  tenant: string;
  locale: string;
  adminPath: string;
  citizenId?: string;
}) {
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;
  const editing = citizenId !== undefined;

  const [token, setToken] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicTenantConfig | null>(null);
  const [initial, setInitial] = useState<CitizenFormValues | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    // Read-only roles are bounced rather than shown a form every save would
    // refuse. The server is the enforcement; this keeps it out of their way.
    if (
      session.user.role !== 'SUPER_ADMIN' &&
      session.user.role !== 'FIELD_INSPECTOR' &&
      session.user.role !== 'ADMINISTRATIVE_OFFICER'
    ) {
      router.replace(`${base}/citizens`);
      return;
    }
    setToken(session.accessToken);
  }, [tenant, base, router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const load = async () => {
      try {
        // The tenant config decides which أنواع العقارات this municipality
        // accepts, so the form cannot offer one that would be refused on save.
        const [tenantConfig, form] = await Promise.all([
          getTenantConfig(tenant),
          citizenId ? getCitizenForm(tenant, token, citizenId) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        setConfig(tenantConfig);

        if (!form) {
          setInitial(EMPTY_CITIZEN);
          return;
        }

        setReference(form.referenceNumber);
        setInitial({
          personal: {
            ...form.personal,
            /**
             * `isLebanese` is nullable in the database — a citizen created
             * before the column existed, or by an import that skipped it —
             * and `PersonalStep` reads any non-`false` value as لبناني. Left
             * as null it renders the Lebanese branch, hides الجنسية, and then
             * fails the save on `isLebanese: null` with a message about a
             * question the form never asked. Resolving it here makes what is
             * displayed and what is sent the same answer.
             */
            isLebanese: form.personal.isLebanese !== false,
          },
          contact: {
            ...form.contact,
            // Every text input reads its value as a string; a numeric
            // familySize would render as an empty box and then fail
            // validation as "required" on a field that was never blank.
            familySize: text(form.contact.familySize) ?? '',
          },
          properties:
            form.properties.length > 0
              ? form.properties.map(toPropertyDraft)
              : EMPTY_CITIZEN.properties,
        });
      } catch (caught) {
        if (cancelled) return;
        logApiError(caught);
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`${base}/login`);
          return;
        }
        setLoadError(
          caught instanceof ApiRequestError && caught.status === 404
            ? (locale === 'en' ? 'No citizen found with this ID.' : 'لا يوجد مواطن بهذا المعرّف.')
            : (locale === 'en' ? 'Failed to load citizen data.' : 'تعذّر تحميل بيانات المواطن.'),
        );
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [tenant, token, citizenId, base, router, locale]);

  const submit = useCallback(
    async (values: CitizenFormValues) => {
      if (!token) return;
      setSubmitting(true);
      setError(null);

      const payload = {
        personal: values.personal,
        contact: values.contact,
        properties: values.properties.map(toPayloadProperty),
      };

      try {
        if (citizenId) {
          await updateCitizen(tenant, token, citizenId, payload);
          router.push(`${base}/citizens/${citizenId}`);
        } else {
          const created = await createCitizen(tenant, token, payload);
          router.push(`${base}/citizens/${created.citizenId}`);
        }
        router.refresh();
      } catch (caught) {
        logApiError(caught);
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`${base}/login`);
          return;
        }
        setError(
          caught instanceof ApiRequestError
            ? caught.message
            : (locale === 'en' ? 'Failed to save data. Please try again.' : 'تعذّر حفظ البيانات. حاول مرة أخرى.'),
        );
        setSubmitting(false);
      }
    },
    [tenant, token, citizenId, base, router, locale],
  );

  const cancelHref = useMemo(
    () => (citizenId ? `${base}/citizens/${citizenId}` : `${base}/citizens`),
    [base, citizenId],
  );

  if (!token) return null;

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {loadError}
        </p>
        <Link href={`${base}/citizens`} className={buttonVariants({ variant: 'outline' })}>
          {locale === 'en' ? 'Back to Citizens Registry' : 'رجوع إلى سجل المواطنين'}
        </Link>
      </div>
    );
  }

  if (!config || !initial) {
    return (
      <LoadingState fullHeight />
    );
  }

  const Icon = editing ? UserRoundPen : UserPlus;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={cancelHref}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        {editing
          ? (locale === 'en' ? 'Back to Citizen Profile' : 'رجوع إلى ملف المواطن')
          : (locale === 'en' ? 'Back to Citizens Registry' : 'رجوع إلى سجل المواطنين')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20"
          >
            <Icon className="size-7" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h1 className="truncate text-3xl font-bold tracking-tight">
              {editing
                ? (locale === 'en' ? 'Edit Citizen Information' : 'تعديل بيانات مواطن')
                : (locale === 'en' ? 'Register New Citizen' : 'تسجيل مواطن جديد')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {editing
                ? (locale === 'en'
                    ? "Edits apply to this citizen's latest application. Prior submissions are preserved in their history."
                    : 'التعديلات تُطبَّق على أحدث طلب لهذا المواطن. الطلبات السابقة تبقى كما هي في ملفه.')
                : (locale === 'en'
                    ? 'The application is registered with status "Pending" and appears in the verification queue.'
                    : 'يُسجَّل الطلب بحالة «قيد الانتظار» ويظهر في قائمة المراجعة كأي طلب آخر.')}
            </p>
          </div>
        </div>

        {reference ? (
          <Badge variant="outline" className="font-mono" dir="ltr">
            {reference}
          </Badge>
        ) : null}
      </div>

      <CitizenForm
        tenant={tenant}
        config={config}
        mode={editing ? 'edit' : 'create'}
        initial={initial}
        submitting={submitting}
        error={error}
        onSubmit={(values) => void submit(values)}
        onCancel={() => router.push(cancelHref)}
        locale={locale}
      />
    </div>
  );
}
