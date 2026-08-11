'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Banknote,
  Clock,
  Info,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Save,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  ApiRequestError,
  getMunicipalitySettings,
  logApiError,
  updateMunicipalitySettings,
} from '@/lib/api-client';
import type { MunicipalitySettings } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const EMPTY = {
  contactPhone: '',
  whatsappNumber: '',
  whishMoneyNumber: '',
  cashOfficeHours: '',
  cashOfficeAddress: '',
};

/**
 * إعدادات البلدية — the handful of values the portal quotes back to citizens.
 *
 * These used to live in a card at the bottom of the fees screen, which is
 * where they were *edited* but not where anyone looked for them: the office
 * WhatsApp number is printed on every receipt and the opening hours appear on
 * the citizen's pay dialog, so they belong to the municipality rather than to
 * the fee ledger. They now have a page, and the fees screen links to it.
 *
 * SUPER_ADMIN only — `PATCH /fees/settings` is `@Roles('SUPER_ADMIN')` on the
 * server, so anyone else would only be shown a form that refuses to save.
 */
export default function SettingsPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [saved, setSaved] = useState<MunicipalitySettings | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    if (session.user.role !== 'SUPER_ADMIN') {
      router.replace(`${base}/dashboard`);
      return;
    }
    setToken(session.accessToken);
  }, [tenant, base, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getMunicipalitySettings(tenant, token);
      setSaved(result);
      setDraft({
        contactPhone: result.contactPhone ?? '',
        whatsappNumber: result.whatsappNumber ?? '',
        whishMoneyNumber: result.whishMoneyNumber ?? '',
        cashOfficeHours: result.cashOfficeHours ?? '',
        cashOfficeAddress: result.cashOfficeAddress ?? '',
      });
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      setError('تعذّر تحميل الإعدادات.');
    } finally {
      setLoading(false);
    }
  }, [tenant, token, base, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await updateMunicipalitySettings(tenant, token, draft);
      setSaved(result);
      setNotice('تم حفظ الإعدادات.');
      setError(null);
    } catch (caught) {
      logApiError(caught);
      setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر حفظ الإعدادات.');
    } finally {
      setSaving(false);
    }
  }, [tenant, token, draft]);

  const set = (patch: Partial<typeof draft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));

  if (!token) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-2 border-b pb-6">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <SettingsIcon className="size-7 text-primary" aria-hidden />
          إعدادات البلدية
        </h1>
        <p className="text-sm text-muted-foreground">
          أرقام التواصل التي تُطبع على الوصولات، وتفاصيل الدفع التي تظهر للمواطن
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm text-success">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          جارٍ التحميل…
        </p>
      ) : (
        <>
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Phone className="size-5" aria-hidden />
                أرقام التواصل
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                تُطبع على وصل القبض، ويستخدم رقم الواتساب لإرسال الوصل إلى المواطن.
              </p>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <Field
                label="رقم هاتف البلدية"
                htmlFor="contactPhone"
                hint="يظهر على الوصل ليتمكن المواطن من الاتصال بالبلدية"
              >
                <Input
                  id="contactPhone"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  placeholder="07 123456"
                  className="text-start"
                  value={draft.contactPhone}
                  onChange={(event) => set({ contactPhone: event.target.value })}
                />
              </Field>

              <Field
                label="رقم واتساب البلدية"
                htmlFor="whatsappNumber"
                hint="الحساب الذي تُرسل منه الوصولات، ويُطبع على الوصل ليرد عليه المواطن"
              >
                <Input
                  id="whatsappNumber"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  placeholder="70 123456"
                  className="text-start"
                  value={draft.whatsappNumber}
                  onChange={(event) => set({ whatsappNumber: event.target.value })}
                />
              </Field>

              {/*
                Said plainly, because the alternative is a clerk believing the
                municipality's number is on the citizen's screen when their own
                personal number is. A `wa.me` link addresses a *recipient*; it
                has no way to choose a sender, and nothing on this page can
                change that — the sender is whichever WhatsApp account the
                browser or phone is signed into at the moment the link opens.
              */}
              <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="space-y-1">
                  <p className="font-medium">كيف يُرسل الوصل عبر واتساب</p>
                  <p className="text-muted-foreground">
                    رابط <span dir="ltr">wa.me</span> يفتح محادثة مع رقم المواطن، لكنه لا
                    يحدّد المُرسِل — تُرسَل الرسالة من حساب الواتساب المسجَّل دخوله على
                    الجهاز أو المتصفح. لكي تصل الرسالة من رقم البلدية، سجّل الدخول إلى{' '}
                    <span dir="ltr">WhatsApp Web</span> بحساب البلدية على جهاز الموظف قبل
                    إرسال الوصولات.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Banknote className="size-5" aria-hidden />
                إعدادات الدفع
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                تظهر للمواطن في صفحة الدفع. اترك الحقل فارغاً لإخفاء الخيار.
              </p>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <Field
                label="رقم Whish Money"
                htmlFor="whishMoneyNumber"
                hint="بدون رقم، لا يُعرض خيار التحويل على المواطن إطلاقاً"
              >
                <Input
                  id="whishMoneyNumber"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  className="text-start"
                  value={draft.whishMoneyNumber}
                  onChange={(event) => set({ whishMoneyNumber: event.target.value })}
                />
              </Field>

              <Field label="أوقات الدوام" htmlFor="cashOfficeHours">
                <Input
                  id="cashOfficeHours"
                  placeholder="الإثنين — الجمعة، ٨:٠٠ — ١٤:٠٠"
                  value={draft.cashOfficeHours}
                  onChange={(event) => set({ cashOfficeHours: event.target.value })}
                />
              </Field>

              <Field label="عنوان مكتب الجباية" htmlFor="cashOfficeAddress">
                <Input
                  id="cashOfficeAddress"
                  value={draft.cashOfficeAddress}
                  onChange={(event) => set({ cashOfficeAddress: event.target.value })}
                />
              </Field>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {saved?.updatedAt
                ? `آخر تحديث: ${formatDateTime(saved.updatedAt)}`
                : 'لم تُحفظ أي إعدادات بعد.'}
            </p>
            <Button size="lg" onClick={() => void save()} disabled={saving}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              حفظ الإعدادات
            </Button>
          </div>

          {/* A preview, because these two strings are read by citizens far more
              often than by the person typing them. */}
          {draft.cashOfficeHours || draft.cashOfficeAddress ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              {draft.cashOfficeHours ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5 shrink-0" aria-hidden />
                  {draft.cashOfficeHours}
                </span>
              ) : null}
              {draft.cashOfficeAddress ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  {draft.cashOfficeAddress}
                </span>
              ) : null}
              {draft.whatsappNumber ? (
                <span className="inline-flex items-center gap-1.5" dir="ltr">
                  <MessageCircle className="size-3.5 shrink-0" aria-hidden />
                  {draft.whatsappNumber}
                </span>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
