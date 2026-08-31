'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight,
  Banknote,
  Building2,
  Calendar,
  Clock3,
  ExternalLink,
  FileDigit,
  FileText,
  Flag,
  Hash,
  Heart,
  Home,
  IdCard,
  Key,
  Layers,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Receipt as ReceiptIcon,
  Ruler,
  Tent,
  Trees,
  User,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  getCitizenProfile,
  getDocumentViewUrl,
  getMunicipalitySettings,
  getTenantConfig,
  logApiError,
  settlePayment,
} from '@/lib/api-client';
import type {
  CitizenFeeTotals,
  CitizenProfile,
  CitizenProfilePayment,
  CitizenProfileProperty,
  MunicipalitySettings,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { useToast } from '@/components/ui/toast';
import { findLocatedProperty, mapHref } from '@/lib/map-link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { PaymentReceipt } from '@/components/admin/payment-receipt';
import { LoadingState } from '@/components/ui/states';
import {
  SettlePaymentDialog,
  type SettleValues,
} from '@/components/admin/settle-payment-dialog';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/dates';

/** One glyph per property branch, so a card's kind is readable before its text. */
const PROPERTY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  BUILDING: Building2,
  HOUSE: Home,
  LAND: Trees,
  TENT: Tent,
};

interface FactItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: React.ReactNode;
  /** Latin-script content (numbers, phones) that must not mirror in RTL. */
  ltr?: boolean;
}

/**
 * Drops the facts this citizen has no value for.
 *
 * Filtering the *list* rather than having each field render itself as null is
 * what keeps the grids aligned: a self-nulling field still occupies no cell,
 * so the ones after it slide into different columns for every citizen, and no
 * two profiles line up the same way. Filtering first means the grid only ever
 * receives cells it will actually fill.
 */
function present(facts: FactItem[]): FactItem[] {
  return facts.filter((fact) => fact.value != null && fact.value !== '');
}

/**
 * One citizen and everything they have filed.
 *
 * The route is tenant- and admin-path-scoped (`/{tenant}/{locale}/{adminPath}/
 * citizens/{id}`) rather than a bare `/citizens/{id}`. Two reasons, both
 * structural: a citizen id alone does not say which municipality's schema to
 * read — the tenant boundary in this system is the database connection, not a
 * WHERE clause — and this page renders identity-document numbers and residency
 * status, which belong behind the same obscure staff path and role guard as
 * the rest of the portal.
 */
export default function CitizenProfilePage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string; citizenId: string }>;
}) {
  const { tenant, locale, adminPath, citizenId } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [citizen, setCitizen] = useState<CitizenProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const toast = useToast();
  /** Printed on the receipt header — the tenant config is the only source. */
  const [municipalityName, setMunicipalityName] = useState('');
  /** Office numbers printed on a receipt — see إعدادات البلدية. */
  const [settings, setSettings] = useState<MunicipalitySettings | null>(null);

  /** Mirrors the server's write roles; the server is the enforcement. */
  const canEdit =
    role === 'SUPER_ADMIN' || role === 'FIELD_INSPECTOR' || role === 'ADMINISTRATIVE_OFFICER';
  /** Settling a payment belongs to the money roles server-side (`@Roles` on the
   *  fees controller), so offering it to an inspector would only earn a 403. */
  const canManage =
    role === 'SUPER_ADMIN' || role === 'COLLECTOR' || role === 'ACCOUNTANT';

  const reload = useCallback(async () => {
    if (!token) return;
    setCitizen(await getCitizenProfile(tenant, token, citizenId));
  }, [tenant, token, citizenId]);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
    setRole(session.user.role);

    // Public endpoint, and non-blocking: a failed config fetch must not stop
    // the profile rendering. It only supplies the name printed on a receipt,
    // which falls back to the tenant slug.
    getTenantConfig(tenant)
      .then((config) => setMunicipalityName(config.nameAr || config.name))
      .catch(() => setMunicipalityName(tenant));

    // Same non-blocking treatment as the config: a receipt without the office
    // numbers is still a valid receipt.
    getMunicipalitySettings(tenant, session.accessToken)
      .then(setSettings)
      .catch(() => setSettings(null));

    getCitizenProfile(tenant, session.accessToken, citizenId)
      .then(setCitizen)
      .catch((caught: unknown) => {
        logApiError(caught);
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`${base}/login`);
          return;
        }
        setError(
          caught instanceof ApiRequestError && caught.status === 404
            ? 'لا يوجد مواطن بهذا المعرّف.'
            : 'تعذّر تحميل ملف المواطن.',
        );
      });
  }, [tenant, base, citizenId, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive">
          {error}
        </p>
        <Link href={`${base}/dashboard`} className={buttonVariants({ variant: 'outline' })}>
          رجوع إلى اللوحة
        </Link>
      </div>
    );
  }

  if (!citizen) {
    return (
      <LoadingState fullHeight />
    );
  }

  const propertyCount = citizen.registrations.reduce(
    (total, registration) => total + registration.properties.length,
    0,
  );

  // The property the top "عرض على الخريطة" button points at — the first one
  // with coordinates, across every registration in submission order. A
  // citizen with several properties still gets one obvious map action; the
  // rest get their own link inline where they're listed below.
  const locatedProperty = findLocatedProperty(
    citizen.registrations.flatMap((registration) => registration.properties),
  );

  const openDocument = async (documentId: string) => {
    if (!token) return;
    setOpeningDocId(documentId);
    try {
      const { url } = await getDocumentViewUrl(tenant, token, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      // A toast rather than `alert()`, which blocks the whole tab until it is
      // dismissed — for a failure whose remedy is simply "try the next
      // document", freezing the page the reader is working through is a
      // heavier interruption than the problem.
      toast.error('تعذّر فتح الملف', {
        description:
          caught instanceof ApiRequestError ? caught.message : 'قد يكون الرابط منتهي الصلاحية.',
      });
    } finally {
      setOpeningDocId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Its own row above the header. Inside it, the avatar aligned to this
          link rather than to the name it belongs to, which is what left the
          circle floating above the heading.

          Points at the citizens registry rather than the dashboard: this page
          is reached from that list far more often than from the review queue,
          and "back" that lands somewhere other than where you came from is
          worse than no back link. */}
      <Link
        href={`${base}/citizens`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        رجوع إلى سجل المواطنين
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div className="flex min-w-0 items-center gap-4">
          {/* A generic person glyph rather than the name's first letter: an
              initial reads as data the municipality holds about someone when
              it is really just decoration, and "ف" identifies nobody. */}
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20"
          >
            <User className="size-7" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h1 className="truncate text-3xl font-bold tracking-tight">{citizen.fullName}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <FileText className="size-3.5" aria-hidden />
                {citizen.registrations.length} طلب
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden />
                {propertyCount} عقار
              </span>
              {citizen.gender ? (
                <Badge variant="outline">{ar.gender[citizen.gender as never]}</Badge>
              ) : null}
              {citizen.residentStatus ? (
                <Badge variant="outline">
                  {ar.residentStatus[citizen.residentStatus as never]}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Link href={`${base}/citizens/${citizen.id}/edit`} className={buttonVariants()}>
              <Pencil className="size-4" aria-hidden />
              تعديل البيانات
            </Link>
          ) : null}
          <Link
            href={locatedProperty ? mapHref(base, locatedProperty) : `${base}/map`}
            className={buttonVariants({ variant: 'outline' })}
            title={locatedProperty ? undefined : 'لم يتم تحديد موقع أي عقار لهذا المواطن بعد'}
          >
            <MapPin className="size-4" aria-hidden />
            عرض على الخريطة
          </Link>
        </div>
      </div>

      {/*
        Four labelled groups rather than one twelve-field grid. The fields
        answer different questions — who they are, how to reach them, who is
        with them, what the municipality filed — and a reviewer is normally
        after exactly one of those, which a flat list makes them scan for.
      */}
      <CollapsibleSection
        id="personal"
        title="البيانات الشخصية"
        icon={IdCard}
        className="[&_summary]:pb-4"
        summary={
          <span className="text-muted-foreground">
            {citizen.identityDocNumber ? (
              <bdi dir="ltr">{citizen.identityDocNumber}</bdi>
            ) : null}
          </span>
        }
      >
        <div className="-m-5 divide-y">
          {/* Six fields — fills a three-column grid exactly, two rows deep. */}
          <FactSection
            title="الهوية"
            facts={[
              {
                icon: User,
                label: 'الاسم',
                value: citizen.fullName,
              },
              {
                icon: User,
                label: 'الجنس',
                value: ar.gender[citizen.gender as never],
              },
              {
                icon: Flag,
                label: 'الجنسية',
                value: citizen.nationality,
              },
              {
                icon: Home,
                label: 'صفة الإقامة',
                value: ar.residentStatus[citizen.residentStatus as never],
              },
              {
                icon: IdCard,
                label: 'نوع وثيقة الإثبات',
                value: ar.identityDocType[citizen.identityDocType as never],
              },
              {
                icon: FileDigit,
                label: 'رقم الوثيقة',
                value: citizen.identityDocNumber,
                ltr: true,
              },
              citizen.isLebanese
                ? {
                    icon: FileDigit,
                    label: 'رقم السجل',
                    value: citizen.civilRecordNumber,
                    ltr: true,
                  }
                : {
                    icon: FileDigit,
                    label: 'رقم الإقامة',
                    value: citizen.residencyNumber,
                    ltr: true,
                  },
            ]}
          />

          {/*
            The remaining three groups hold two fields each. Stacked full-width
            like الهوية above, every one of them would span the card with an
            empty third alongside it — three sparse bands in a row. Sitting
            them side by side, each as a narrow column of two, fills the same
            width once instead of three times.
          */}
          <div className="grid gap-x-6 gap-y-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
            <FactSection
              stack
              title="التواصل"
              facts={[
                {
                  icon: Phone,
                  label: 'الهاتف',
                  value: citizen.phone ? <PhoneLink phone={citizen.phone} /> : null,
                },
                {
                  icon: MessageCircle,
                  label: 'واتساب',
                  value: citizen.whatsapp ? <PhoneLink phone={citizen.whatsapp} /> : null,
                },
              ]}
            />

            <FactSection
              stack
              title="الأسرة"
              facts={[
                {
                  icon: Heart,
                  label: 'الحالة الاجتماعية',
                  value: citizen.maritalStatus
                    ? (ar.maritalStatus?.[citizen.maritalStatus as never] ?? citizen.maritalStatus)
                    : undefined,
                },
                {
                  icon: Users,
                  label: 'عدد أفراد الأسرة',
                  value: citizen.familySize?.toString(),
                },
              ]}
            />

            <FactSection
              stack
              title="بيانات التسجيل"
              facts={[
                { icon: Hash, label: 'الرقم المرجعي', value: citizen.referenceNumber, ltr: true },
                {
                  icon: Calendar,
                  label: 'تاريخ أول تسجيل',
                  value: formatDate(citizen.registeredAt),
                },
              ]}
            />
          </div>
        </div>
      </CollapsibleSection>

      <FeesPanel
        citizen={citizen}
        payments={citizen.payments}
        fees={citizen.fees}
        canManage={canManage}
        municipalityName={municipalityName}
        contactPhone={settings?.contactPhone}
        officeWhatsapp={settings?.whatsappNumber}
        onSettled={() => void reload()}
      />

      <CollapsibleSection
        id="properties"
        title="العقارات"
        icon={FileText}
        defaultOpen={false}
        summary={
          <span className="text-muted-foreground">{propertyCount} عقار</span>
        }
      >
        <div className="space-y-4">

        {citizen.registrations.map((registration) => (
          <Card key={registration.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
              <div>
                <CardTitle className="font-mono text-base">
                  {/* Inline `<bdi>` for the same reason as `Fact` below. */}
                  <bdi dir="ltr">{registration.referenceNumber}</bdi>
                </CardTitle>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Calendar className="size-3.5" aria-hidden />
                  {formatDate(registration.submittedAt)}
                </p>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-6">
              {registration.properties.map((property) => (
                <PropertyCard key={property.id} property={property} base={base} />
              ))}

              {registration.properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد عقارات في هذا الطلب.</p>
              ) : null}

              <div className="space-y-2 border-t pt-4">
                <SubHeading icon={FileText}>
                  المرفقات {registration.documents.length > 0 ? `(${registration.documents.length})` : ''}
                </SubHeading>
                {registration.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد مرفقات لهذا الطلب.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {registration.documents.map((document) => (
                      <li key={document.id}>
                        <button
                          type="button"
                          onClick={() => openDocument(document.id)}
                          disabled={openingDocId === document.id}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-start transition-colors hover:bg-muted/60 disabled:opacity-60"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate text-sm font-medium">
                              {ar.documentType?.[document.type as never] ?? document.type}
                            </span>
                          </span>
                          {openingDocId === document.id ? (
                            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                          ) : (
                            <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

            </CardContent>
          </Card>
        ))}

        {citizen.registrations.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-muted-foreground">
            لا توجد عقارات مسجّلة لهذا المواطن.
          </p>
        ) : null}
        </div>
      </CollapsibleSection>
    </div>
  );
}

/** Tone per payment state, matching the fees screen's vocabulary. */
const PAYMENT_TONE: Record<string, string> = {
  PAID: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  PENDING_REVIEW:
    'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  UNPAID:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  OVERDUE: 'border-red-600/30 bg-red-600/10 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

/**
 * The citizen's ledger — totals, then every invoice, each settleable on its own.
 *
 * "Clear them one by one" is the point of the list below. A citizen three
 * periods behind owes three separate debts, and a clerk taking cash for one of
 * them must not be forced to settle all three or none: every row carries its
 * own «تسجيل دفعة» and its own receipt. Bulk-only settlement is exactly what
 * made arrears impossible to work down gradually.
 */
function FeesPanel({
  citizen,
  payments,
  fees,
  canManage,
  municipalityName,
  contactPhone,
  officeWhatsapp,
  onSettled,
}: {
  citizen: CitizenProfile;
  payments: CitizenProfilePayment[];
  fees: CitizenFeeTotals;
  canManage: boolean;
  municipalityName: string;
  contactPhone?: string | null;
  officeWhatsapp?: string | null;
  onSettled: () => void;
}) {
  const { tenant } = useParams<{ tenant: string }>();
  const [settling, setSettling] = useState<CitizenProfilePayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  /** Payment whose receipt is open, plus what was just received against it. */
  const [receipt, setReceipt] = useState<{
    payment: CitizenProfilePayment;
    received: number;
  } | null>(null);

  const outstanding = payments.filter((payment) => payment.paymentStatus !== 'PAID');

  const submit = async ({ amount, note }: SettleValues) => {
    const target = settling;
    if (!target) return;
    const token = loadSession(tenant)?.accessToken;
    if (!token) return;

    setBusy(true);
    setSettleError(null);
    try {
      await settlePayment(tenant, token, target.id, { method: 'CASH', amount, note });
      setSettling(null);
      // Straight into the receipt: a clerk who has just taken cash needs the
      // paper in the citizen's hand before they walk away, and making them
      // hunt for a second button is how receipts stop being issued at all.
      setReceipt({
        payment: { ...target, remaining: Math.max(target.remaining - amount, 0) },
        received: amount,
      });
      onSettled();
    } catch (caught) {
      logApiError(caught);
      setSettleError(
        caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدفعة.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CollapsibleSection
        id="fees"
        title="الرسوم والمدفوعات"
        icon={Wallet}
        summary={
          fees.outstandingTotal > 0 ? (
            <span
              className={cn(
                'font-semibold',
                fees.overdueTotal > 0 ? 'text-destructive' : undefined,
              )}
            >
              <Money amount={fees.outstandingTotal} /> مستحق
            </span>
          ) : (
            <span className="text-emerald-600">لا مستحقات</span>
          )
        }
      >
        <div className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Total label="إجمالي الرسوم" value={fees.feesTotal} />
            <Total label="المسدَّد" value={fees.paidTotal} tone="text-emerald-600" />
            <Total label="غير المسدَّد" value={fees.outstandingTotal} />
            <Total
              label={`المتأخرات${fees.overdueCount > 0 ? ` (${fees.overdueCount})` : ''}`}
              value={fees.overdueTotal}
              tone={fees.overdueTotal > 0 ? 'text-destructive' : undefined}
            />
          </dl>

          {fees.pendingReviewCount > 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
              <Clock3 className="size-4 shrink-0 text-blue-600" aria-hidden />
              {fees.pendingReviewCount} دفعة بانتظار تحقق الموظف — راجعها من صفحة إدارة الرسوم.
            </p>
          ) : null}

          {payments.length === 0 ? (
            <p className="rounded-lg border p-6 text-center text-muted-foreground">
              لم تُصدَر أي رسوم على هذا المواطن.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {payments.map((payment) => {
                const settled = payment.paymentStatus === 'PAID';
                const partly = !settled && payment.paidAmount > 0;
                return (
                  <li key={payment.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="truncate">{payment.title}</span>
                          <Badge
                            variant="outline"
                            className={cn('shrink-0', PAYMENT_TONE[payment.paymentStatus])}
                          >
                            {ar.paymentStatus?.[payment.paymentStatus as never] ??
                              payment.paymentStatus}
                          </Badge>
                          {partly ? (
                            <Badge variant="outline" className="shrink-0">
                              مسدَّد جزئياً
                            </Badge>
                          ) : null}
                        </p>
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="size-3.5 shrink-0" aria-hidden />
                            استحقاق {formatDate(payment.dueDate)}
                          </span>
                          {payment.frequency ? (
                            <span>
                              {ar.feeFrequency?.[payment.frequency as never] ??
                                payment.frequency}
                            </span>
                          ) : null}
                          {payment.paidAt ? (
                            <span className="text-emerald-600">
                              سُدّد {formatDate(payment.paidAt)}
                            </span>
                          ) : null}
                        </p>
                        {payment.reviewNote ? (
                          <p className="text-xs text-muted-foreground">
                            ملاحظة الموظف: {payment.reviewNote}
                          </p>
                        ) : null}
                      </div>

                      <div className="shrink-0 text-end">
                        <Money amount={payment.amount} exact className="font-semibold" />
                        {partly ? (
                          <p className="text-xs text-muted-foreground">
                            متبقٍ <Money amount={payment.remaining} exact />
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {/* Per-row actions: settle this one debt, or reprint its
                        receipt. Both stay on the row they belong to, so there
                        is never a question which invoice was paid. */}
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        {!settled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSettleError(null);
                              setSettling(payment);
                            }}
                          >
                            <Banknote className="size-4" aria-hidden />
                            تسجيل دفعة نقدية
                          </Button>
                        ) : null}
                        {payment.paidAmount > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setReceipt({ payment, received: payment.paidAmount })
                            }
                          >
                            <ReceiptIcon className="size-4" aria-hidden />
                            إنشاء وصل وإرسال عبر واتساب
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {outstanding.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              {outstanding.length} مطالبة غير مسدّدة — يمكن تسديد كل منها على حدة، كلياً أو
              جزئياً.
            </p>
          ) : null}
        </div>
      </CollapsibleSection>

      <SettlePaymentDialog
        open={settling !== null}
        onOpenChange={(next) => {
          if (!next) setSettling(null);
        }}
        payment={settling}
        submitting={busy}
        error={settleError}
        onSubmit={(values) => void submit(values)}
      />

      <PaymentReceipt
        open={receipt !== null}
        onOpenChange={(next) => {
          if (!next) setReceipt(null);
        }}
        citizen={citizen}
        payment={receipt?.payment ?? null}
        receivedAmount={receipt?.received}
        municipalityName={municipalityName}
        contactPhone={contactPhone}
        officeWhatsapp={officeWhatsapp}
      />
    </>
  );
}
/**
 * One money total in the fee summary row.
 *
 * Four of these sit in a grid that drops to two columns on a tablet and one
 * on a phone, so each tile is a third of a card wide at its narrowest — the
 * place a ten-digit municipal total would have wrapped its label away from
 * its figure. `Money` compacts it and keeps the exact number on hover.
 */
function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 text-xl font-bold', tone)}>
        <Money amount={value} />
      </dd>
    </div>
  );
}

/**
 * One property card, rendering whichever of the wizard's four branches this
 * property came from. Every field is conditional because the branches share
 * only الحي and رقم العقار — a plot has a land type and no floor, a tent has
 * a written location and neither.
 *
 * Sections are separated by rules (`divide-y`) rather than by nesting another
 * bordered box inside this one: at three levels deep (registration → property
 * → landlord) the boxes-in-boxes read as clutter well before they read as
 * structure.
 */
function PropertyCard({
  property,
  base,
}: {
  property: CitizenProfileProperty;
  base: string;
}) {
  const Icon = PROPERTY_ICON[property.propertyType] ?? Building2;
  const isTenant = property.occupancyType === 'TENANT';

  const details = present([
    {
      icon: Hash,
      label: 'رقم العقار',
      value: property.propertyNumber,
      ltr: true,
    },
    {
      icon: MapPin,
      label: 'الحي',
      value: property.neighborhood,
    },
    {
      icon: Building2,
      label: 'اسم المبنى',
      value: property.buildingName,
    },
    {
      icon: Trees,
      label: 'نوع الأرض',
      value: property.landType
        ? (ar.landType[property.landType as never] ?? property.landType)
        : null,
    },
    {
      icon: Home,
      label: 'نوع الوحدة',
      value: property.unitType
        ? (ar.unitType[property.unitType as never] ?? property.unitType)
        : null,
    },
    { icon: Layers, label: 'الطابق', value: property.floor },
    { icon: MapPin, label: 'الجهة', value: property.side },
    {
      icon: Ruler,
      label: 'المساحة',
      value: property.unitArea != null ? `${property.unitArea} م²` : null,
    },
    {
      icon: Tent,
      label: 'موقع الخيمة',
      value: property.tentLocation,
    },
    {
      icon: Key,
      label: 'الحقوق المشتركة',
      value: property.sharedRights.length > 0 ? property.sharedRights.join('، ') : null,
    },
  ]);

  const landlord = present([
    {
      icon: User,
      label: 'اسم المالك',
      value: property.landlordName,
    },
    {
      icon: Phone,
      label: 'هاتف المالك',
      value: property.landlordPhone ? <PhoneLink phone={property.landlordPhone} /> : null,
    },
  ]);

  return (
    <div className="divide-y rounded-lg border bg-muted/20">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="font-semibold">
              العقار رقم{' '}
              <span dir="ltr" className="font-mono">
                {property.propertyNumber}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">
                {ar.propertyType[property.propertyType as never] ?? property.propertyType}
              </Badge>
              <Badge variant={isTenant ? 'warning' : 'outline'}>
                {ar.occupancyType[property.occupancyType as never] ?? property.occupancyType}
              </Badge>
            </div>
          </div>
        </div>

        {property.latitude != null ? (
          <Link
            href={mapHref(base, property)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <MapPin className="size-3.5" aria-hidden />
            عرض على الخريطة
          </Link>
        ) : null}
      </div>

      {details.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((fact) => (
            <Fact key={fact.label} {...fact} />
          ))}
        </dl>
      ) : null}

      {/* A tenant's claim is only reviewable alongside who they rent from —
          the wizard requires both fields, and staff previously saw neither. */}
      {isTenant && landlord.length > 0 ? (
        <div className="space-y-3 p-4">
          <SubHeading icon={UserCheck}>المالك</SubHeading>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {landlord.map((fact) => (
              <Fact key={fact.label} {...fact} />
            ))}
          </dl>
        </div>
      ) : null}

      {/* Owning a whole building is one عقار with many units. The count alone
          said nothing about which floors were claimed. */}
      {property.units.length > 0 ? (
        <div className="space-y-3 p-4">
          <SubHeading icon={Layers}>
            الوحدات ({property.units.length})
          </SubHeading>
          <ul className="divide-y rounded-lg border bg-background">
            {property.units.map((unit) => (
              <li key={unit.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <Badge variant="secondary" className="shrink-0">
                  {ar.unitType[unit.unitType as never] ?? unit.unitType}
                </Badge>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Layers className="size-3.5 shrink-0" aria-hidden />
                  الطابق {unit.floor}
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Ruler className="size-3.5 shrink-0" aria-hidden />
                  {unit.unitArea} م²
                </span>
                {unit.side ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" aria-hidden />
                    {unit.side}
                  </span>
                ) : null}
                {unit.sharedRights.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Key className="size-3.5 shrink-0" aria-hidden />
                    {unit.sharedRights.join('، ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A labelled block of facts, absent entirely when the citizen has none of them.
 *
 * `stack` is for the narrow groups that sit side by side as columns: they
 * supply their own spacing from the parent grid, so this adds neither padding
 * nor a second grid inside a grid cell one column wide.
 */
function FactSection({
  title,
  facts,
  stack = false,
}: {
  title: string;
  facts: FactItem[];
  stack?: boolean;
}) {
  const shown = present(facts);
  if (shown.length === 0) return null;
  return (
    <div className={stack ? 'space-y-3' : 'space-y-3 p-6'}>
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      <dl className={stack ? 'space-y-4' : 'grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3'}>
        {shown.map((fact) => (
          <Fact key={fact.label} {...fact} />
        ))}
      </dl>
    </div>
  );
}

/** Small icon + label heading used inside a property or attachment block. */
function SubHeading({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </p>
  );
}

/** Click-to-call, kept LTR so the number is not mirrored in an RTL page. */
function PhoneLink({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone}`} dir="ltr" className="font-medium text-primary hover:underline">
      {phone}
    </a>
  );
}

/** One labelled value: caption above, value below, so long Arabic labels and
 *  Latin numbers never have to share a baseline. */
function Fact({ icon: Icon, label, value, ltr }: FactItem) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 break-words font-medium">
        {/*
          `dir` belongs on an inline `<bdi>`, never on the block `<dd>`. A
          block element carrying dir="ltr" also flips its text-align to left,
          so a document number sat at the far edge of its cell while the
          Arabic caption above stayed at the right — the two looked like they
          belonged to different fields. `<bdi>` isolates the digits so they
          still read left-to-right, while the line itself keeps the page's RTL
          alignment and stays under its own label.
        */}
        {ltr ? <bdi dir="ltr">{value}</bdi> : value}
      </dd>
    </div>
  );
}
