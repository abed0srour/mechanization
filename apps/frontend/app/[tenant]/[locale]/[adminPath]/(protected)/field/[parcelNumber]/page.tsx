'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ClipboardList, WifiOff } from 'lucide-react';
import { draftGaps, type FieldDraftPayload } from '@mechanization/shared-schemas';
import type { PublicTenantConfig } from '@/lib/api-client';
import { applyVisitLocally, enqueue, loadWorklist, readMeta } from '@/lib/field-db';
import {
  CitizenForm,
  EMPTY_CITIZEN,
  toPayloadProperty,
  toPropertyDraft,
  text,
  type CitizenFormValues,
} from '@/components/admin/citizen-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';

/**
 * ──────────────────────  The doorstep record, offline  ───────────────────────
 *
 * The register's own form — literally `CitizenForm`, the same component
 * «تسجيل مواطن جديد» renders — on a page of its own, reading and writing
 * IndexedDB instead of the API.
 *
 * The same component, not a copy of it, and that is the whole point. Every
 * conditional rule in this form is a rule about the municipality's records, not
 * about who is holding the keyboard: رقم السجل only for a Lebanese citizen, a
 * landlord block only for a tenant, a units editor only for a مبنى, خيمة only
 * for a لاجئ. A second, simplified field form would have started as a subset and
 * drifted into a different set of questions — and the worker would have
 * collected the wrong ones, for weeks, before anyone noticed at promotion.
 *
 * So a household with a four-unit building is entered here exactly as it would
 * be at the counter, with as many properties and as many units as it really
 * has.
 *
 * Two things differ, and only two:
 *
 *  1. `allowIncomplete` — «حفظ» never refuses. A worker with three of the nine
 *     answers keeps those three; the gap list below the form says what to ask
 *     for next time rather than blocking the save.
 *  2. It saves to the device, not the server. Promotion into a real citizen
 *     record happens later, through the identical validator, so nothing about
 *     the register's guarantees is loosened by this screen existing.
 *
 * A page rather than the sheet this used to be: the form is three sections tall
 * with a repeatable property card inside the third, and on a phone a sheet that
 * scrolls internally puts «حفظ» and the field being typed in two different
 * scroll contexts.
 */
export default function FieldDraftPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string; parcelNumber: string }>;
}) {
  const { tenant, locale, adminPath, parcelNumber } = use(params);
  const parcel = decodeURIComponent(parcelNumber);
  const base = `/${tenant}/${locale}/${adminPath}`;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  /** Everything this screen needs, all of it from the device. */
  const local = useQuery({
    queryKey: ['field-draft', tenant, parcel],
    queryFn: async () => {
      const [parcels, meta] = await Promise.all([loadWorklist(), readMeta()]);
      return {
        parcel: parcels.find((row) => row.parcelNumber === parcel) ?? null,
        config: (meta.config as PublicTenantConfig | null) ?? null,
      };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const cached = local.data?.parcel ?? null;
  const config = local.data?.config ?? null;

  /**
   * The stored draft as the form's own shape.
   *
   * Drafts are stored in the *payload* shape — coerced numbers, the thing the
   * create validator reads — so it has to come back through `toPropertyDraft`,
   * which is the same function the counter's edit screen uses to reopen a saved
   * citizen. One conversion, used by both entry points.
   */
  const initial = useMemo<CitizenFormValues>(() => {
    const payload = cached?.draft?.payload;
    if (!payload) {
      // A fresh draft already knows the one thing the worklist told us, and the
      // number is the thing a worker should never have to retype at a door.
      return {
        ...EMPTY_CITIZEN,
        properties: [{ propertyNumber: parcel }],
      };
    }
    const properties = Array.isArray(payload.properties) ? payload.properties : [];
    return {
      personal: { isLebanese: true, ...(payload.personal ?? {}) },
      contact: {
        whatsappSameAsPhone: true,
        ...(payload.contact ?? {}),
        // Every input reads its value as a string; a numeric familySize would
        // render as an empty box and then be reported as a missing field.
        ...(payload.contact?.familySize !== undefined
          ? { familySize: text(payload.contact.familySize) ?? '' }
          : {}),
      },
      properties:
        properties.length > 0
          ? properties.map((row) => toPropertyDraft(row as Record<string, unknown>))
          : [{ propertyNumber: parcel }],
    };
  }, [cached, parcel]);

  const gaps = useMemo(() => (cached?.draft ? draftGaps(cached.draft.payload) : []), [cached]);

  const save = useMutation({
    mutationFn: async (values: CitizenFormValues) => {
      const payload: FieldDraftPayload = {
        personal: values.personal,
        contact: values.contact,
        properties: values.properties.map(toPayloadProperty),
      };
      const clientId = cached?.draft?.clientId ?? crypto.randomUUID();

      await enqueue({
        kind: 'draft',
        clientId,
        parcelNumber: parcel,
        payload,
        updatedAt: new Date().toISOString(),
      });
      // Gaps recomputed here rather than left until the next sync: the worklist
      // row must never claim a draft is complete when it is not.
      await applyVisitLocally(parcel, {
        draft: { clientId, payload, gaps: draftGaps(payload).map((gap) => gap.path) },
      });
      return draftGaps(payload).length;
    },
    onSuccess: async (remaining) => {
      await queryClient.invalidateQueries({ queryKey: ['field-draft', tenant, parcel] });
      await queryClient.invalidateQueries({ queryKey: ['field-local', tenant] });
      toast.success(
        remaining === 0 ? 'حُفظت البيانات كاملةً على الجهاز' : 'حُفظ ما أدخلته على الجهاز',
        {
          description:
            remaining === 0
              ? 'ستُسجَّل كسجل رسمي عند المزامنة.'
              : `ما زال ناقصاً ${remaining} حقلاً — يمكنك إكمالها في زيارة قادمة.`,
        },
      );
      router.push(`${base}/field`);
    },
    onError: () => toast.error('تعذّر الحفظ على الجهاز'),
  });

  if (local.isPending) return <LoadingState fullHeight label="جارٍ فتح البيانات…" />;

  if (!cached) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={ClipboardList}
          title={`العقار ${parcel} ليس ضمن قائمتك`}
          description="ربما تغيّر تكليفك منذ آخر مزامنة. ارجع إلى قائمة العمل وزامن."
          action={
            <Link
              href={`${base}/field`}
              className="text-sm font-medium text-primary hover:underline"
            >
              رجوع إلى قائمة العمل
            </Link>
          }
        />
      </div>
    );
  }

  /*
    No cached config means the device has never completed a sync, and the form
    cannot know which أنواع العقارات this municipality accepts. Rendering it
    anyway would offer every type and collect answers the register may refuse —
    worse than saying plainly that one online sync is needed first.
  */
  if (!config) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={WifiOff}
          title="يلزم اتصال واحد قبل العمل دون شبكة"
          description="لم تكتمل أي مزامنة على هذا الجهاز بعد، ولا يمكن معرفة أنواع العقارات التي تعتمدها البلدية. اتصل بالشبكة واضغط «مزامنة» مرة واحدة."
          action={
            <Link
              href={`${base}/field`}
              className="text-sm font-medium text-primary hover:underline"
            >
              رجوع إلى قائمة العمل
            </Link>
          }
        />
      </div>
    );
  }

  const complete = Boolean(cached.draft) && gaps.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`${base}/field`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        رجوع إلى قائمة العمل
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5 sm:gap-4 sm:pb-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20 sm:size-14"
          >
            <ClipboardList className="size-5 sm:size-7" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-3xl">
              بيانات العقار {parcel}
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              القطاع {cached.zoneCode} — سجّل ما حصلت عليه، ولا شيء إلزامي الآن
            </p>
          </div>
        </div>

        {cached.draft ? (
          <Badge variant={complete ? 'soft-success' : 'soft-warning'} className="gap-1">
            {complete && <CheckCircle2 className="size-3" aria-hidden />}
            {complete ? 'مكتملة' : `ناقص ${gaps.length} حقلاً`}
          </Badge>
        ) : (
          <Badge variant="soft-muted">مسودة جديدة</Badge>
        )}
      </div>

      {/* Said once, at the top, rather than on every save: this screen never
          reaches the network, and a worker should know that before they start
          typing rather than wonder why nothing uploaded. */}
      <Card className="border-dashed shadow-none">
        <CardContent className="flex items-start gap-3 p-4 text-xs leading-relaxed text-muted-foreground sm:text-sm">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            يُحفظ كل شيء على الجهاز فوراً ويُرسل عند المزامنة. لا حاجة لاتصال الآن، ولا يُشترط
            إكمال كل الحقول — احفظ ما لديك وأكمل الباقي في زيارة قادمة.
          </span>
        </CardContent>
      </Card>

      <CitizenForm
        tenant={tenant}
        config={config}
        mode="create"
        initial={initial}
        submitting={save.isPending}
        error={null}
        onSubmit={(values) => save.mutate(values)}
        onCancel={() => router.push(`${base}/field`)}
        locale={locale}
        allowIncomplete
        submitLabel="حفظ على الجهاز"
      />
    </div>
  );
}
