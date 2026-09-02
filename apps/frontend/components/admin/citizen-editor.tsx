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
import type { PropertyDraft, UnitDraft } from '@/components/citizen/property-card';
import { LoadingState } from '@/components/ui/states';
import { flagsFromArray, flagsToArray } from '@/components/ui/field';
import { OfflineQueueNotice } from './offline-queue';
import { offlineStorageAvailable } from '@/lib/offline-db';
import { queueSubmission, useOfflineQueue, useOnlineStatus } from '@/lib/offline-sync';
import { useToast } from '@/components/ui/toast';
import {
  CitizenForm,
  EMPTY_CITIZEN,
  toPayloadProperty,
  type CitizenFormValues,
} from './citizen-form';

/** `null`/`undefined` → absent; a number → the string an `<input>` holds. */
function text(value: unknown): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : String(value);
}

/**
 * A stored property row as the form's draft shape.
 *
 * The inputs are all text, so every number crosses back as a string here and
 * returns coerced by `toPayloadProperty`. Nulls become `undefined` rather than
 * surviving as `null`: a controlled `<input value={null}>` is React's
 * uncontrolled-to-controlled warning, and `PROPERTY_FIELD_MAP` decides what
 * renders from presence, not from truthiness.
 */
function toDraft(property: Record<string, unknown>): PropertyDraft {
  const units = Array.isArray(property.units) ? property.units : [];

  return {
    id: text(property.id),
    occupancyType: property.occupancyType as PropertyDraft['occupancyType'],
    landlordName: text(property.landlordName),
    landlordPhone: text(property.landlordPhone),
    propertyType: property.propertyType as PropertyDraft['propertyType'],
    neighborhood: text(property.neighborhood),
    propertyNumber: text(property.propertyNumber),
    landType: property.landType as PropertyDraft['landType'],
    buildingName: text(property.buildingName),
    side: text(property.side),
    tentLocation: text(property.tentLocation),
    unitArea: text(property.unitArea),
    sharedRights: (property.sharedRights as string[] | null) ?? [],
    // Only a building carries units; leaving an empty array on the others
    // would make `PropertyCard` render a units editor the schema rejects.
    ...(units.length > 0
      ? {
          units: units.map(
            (unit): UnitDraft => ({
              unitType: (unit as Record<string, unknown>).unitType as UnitDraft['unitType'],
              floor: text((unit as Record<string, unknown>).floor),
              side: text((unit as Record<string, unknown>).side),
              unitArea: text((unit as Record<string, unknown>).unitArea),
              sharedRights:
                ((unit as Record<string, unknown>).sharedRights as string[] | null) ?? [],
            }),
          ),
        }
      : {}),
  };
}

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
  const toast = useToast();
  const base = `/${tenant}/${locale}/${adminPath}`;
  const editing = citizenId !== undefined;

  const online = useOnlineStatus();
  // Mounting this is also what starts the sync engine and drains any backlog,
  // so an officer who opens the entry form after regaining signal has their
  // queue delivered without having to go looking for a button.
  const queue = useOfflineQueue(tenant);

  /**
   * Offline entry is for *new* records only.
   *
   * A correction is a read-modify-write against a row this device may hold a
   * stale copy of — queued for hours and replayed later, it would silently
   * overwrite whatever a colleague changed in the meantime. Registering
   * someone new has no such conflict: the record does not exist yet, and the
   * `clientSubmissionId` covers the only race that remains. So an edit made
   * with no connection fails honestly and is retried by a person.
   */
  const canQueue = !editing && offlineStorageAvailable();
  const willQueue = canQueue && !online;

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
          // The record's existing «غير مؤكَّد» flags, so whoever opens it to
          // finish sees which blanks were deliberate and what was said about
          // each — and clears one simply by filling the field in.
          flags: flagsFromArray(form.flags ?? []),
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
            form.properties.length > 0 ? form.properties.map(toDraft) : EMPTY_CITIZEN.properties,
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
        flags: flagsToArray(values.flags),
      };

      /*
        No connection: the record is stored on this device and the officer
        moves on to the next household.

        The id is minted here, before anything is sent, and travels with every
        later retry as `clientSubmissionId` — which is what makes a lost
        response harmless. The form has already validated this payload against
        the very schema the server will use, so a record accepted here is one
        the server will accept too; that is the whole reason queueing is safe
        to do silently.
      */
      if (willQueue) {
        try {
          await queueSubmission({
            tenant,
            displayName:
              [values.personal.firstName, values.personal.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || (locale === 'en' ? 'Unnamed record' : 'سجل بلا اسم'),
            payload,
          });

          toast.success(
            locale === 'en'
              ? 'Saved on this device — it will sync automatically when you are back online.'
              : 'حُفظ على هذا الجهاز — سيُرسل تلقائياً عند عودة الاتصال.',
          );
          router.push(`${base}/citizens`);
          return;
        } catch (caught) {
          // IndexedDB refused — a private window, a full disk, the store held
          // open by another tab mid-upgrade. Said plainly, because the officer
          // is about to walk away from a record that was not stored.
          logApiError(caught);
          setError(
            locale === 'en'
              ? 'This device could not store the record. Do not close this page — try again once you have a connection.'
              : 'تعذّر حفظ السجل على هذا الجهاز. لا تُغلق الصفحة — أعد المحاولة عند توفّر الاتصال.',
          );
          setSubmitting(false);
          return;
        }
      }

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

        /*
          The request left and never arrived — `navigator.onLine` said yes, and
          it was wrong.

          It is wrong often: a captive portal, a dead uplink, a phone showing
          bars in a valley. That is precisely the moment this record is most
          likely to be lost, and the officer has already typed it, so it is
          queued rather than handed back as an error to retype. Only a
          brand-new registration takes this path, for the reason `canQueue`
          explains.
        */
        if (canQueue && caught instanceof ApiRequestError && caught.status === 0) {
          try {
            await queueSubmission({
                tenant,
              displayName:
                [values.personal.firstName, values.personal.lastName]
                  .filter(Boolean)
                  .join(' ')
                  .trim() || (locale === 'en' ? 'Unnamed record' : 'سجل بلا اسم'),
              payload,
            });

            toast.success(
              locale === 'en'
                ? 'Connection lost — saved on this device and queued for sync.'
                : 'انقطع الاتصال — حُفظ السجل على الجهاز وسيُرسل تلقائياً.',
            );
            router.push(`${base}/citizens`);
            return;
          } catch (queueFailure) {
            logApiError(queueFailure);
          }
        }

        setError(
          caught instanceof ApiRequestError
            ? caught.message
            : (locale === 'en' ? 'Failed to save data. Please try again.' : 'تعذّر حفظ البيانات. حاول مرة أخرى.'),
        );
        setSubmitting(false);
      }
    },
    [tenant, token, citizenId, base, router, locale, willQueue, canQueue, toast],
  );

  const cancelHref = useMemo(
    () => (citizenId ? `${base}/citizens/${citizenId}` : `${base}/citizens`),
    [base, citizenId],
  );

  if (!token) return null;

  if (loadError) {
    return (
      <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
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
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href={cancelHref}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        {editing
          ? (locale === 'en' ? 'Back to Citizen Profile' : 'رجوع إلى ملف المواطن')
          : (locale === 'en' ? 'Back to Citizens Registry' : 'رجوع إلى سجل المواطنين')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl text-foreground">
              {editing
                ? (locale === 'en' ? 'Edit Citizen Information' : 'تعديل بيانات مواطن')
                : (locale === 'en' ? 'Register New Citizen' : 'تسجيل مواطن جديد')}
            </h1>
            <p className="text-xs text-muted-foreground">
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
          <Badge variant="outline" className="font-mono text-xs" dir="ltr">
            {reference}
          </Badge>
        ) : null}
      </div>

      {queue.pending > 0 || queue.blocked > 0 ? (
        <OfflineQueueNotice
          pending={queue.pending}
          blocked={queue.blocked}
          syncing={queue.syncing}
          onSync={queue.sync}
          locale={locale}
          href={`${base}/citizens`}
        />
      ) : null}

      <CitizenForm
        tenant={tenant}
        config={config}
        mode={editing ? 'edit' : 'create'}
        initial={initial}
        submitting={submitting}
        error={error}
        offline={willQueue}
        onSubmit={(values) => void submit(values)}
        onCancel={() => router.push(cancelHref)}
        locale={locale}
      />
    </div>
  );
}
