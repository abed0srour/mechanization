'use client';

import * as React from 'react';
import { Download, Loader2, MessageCircle, Printer, X } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import type { CitizenProfile, CitizenProfilePayment } from '@/lib/api-client';
import { formatLbp } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { downloadFile, renderReceiptPdf, shareFile } from '@/lib/receipt-pdf';

/**
 * A receipt number that is stable for a given payment.
 *
 * Derived rather than stored: reprinting the same settled invoice has to
 * produce the same number on the paper, or the municipality's copy and the
 * citizen's copy disagree. Storing one would be better — an incrementing
 * per-municipality series is what an auditor actually wants — but that is a
 * table and a sequence, and this derivation is honest in the meantime because
 * it is a pure function of the invoice it belongs to.
 */
function receiptNumber(payment: CitizenProfilePayment): string {
  return payment.id.replace(/-/g, '').slice(0, 10).toUpperCase();
}

/** `+9617xxxxxxx` / `03 123456` → the digits wa.me expects, Lebanon-defaulted. */
function whatsappNumber(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('961')) return digits;
  // A local 8-digit number (03 123456 → 03123456) drops its leading zero and
  // takes the country code; anything else is passed through as typed rather
  // than mangled into a number that dials someone else.
  if (digits.startsWith('0')) return `961${digits.slice(1)}`;
  return digits.length <= 8 ? `961${digits}` : digits;
}

/**
 * وصل قبض — the municipality's cash receipt, laid out to match the printed
 * book it replaces.
 *
 * Laid out as HTML so the browser does the Arabic shaping, then turned into a
 * real PDF file on demand (see `lib/receipt-pdf.ts`) so it can be *attached*
 * to a WhatsApp message rather than merely described in one.
 *
 * Three ways out, in descending order of how much they do for the clerk:
 * share the PDF straight to WhatsApp via the OS share sheet; download the PDF;
 * or print it. The first is the only one that puts an actual document in the
 * citizen's chat — a `wa.me` link has a `text` parameter and nothing else.
 */
export function PaymentReceipt({
  open,
  onOpenChange,
  citizen,
  payment,
  municipalityName,
  contactPhone,
  officeWhatsapp,
  /** What was handed over now — may be less than the invoice's full amount. */
  receivedAmount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citizen: CitizenProfile;
  payment: CitizenProfilePayment | null;
  municipalityName: string;
  /** The municipality's own numbers, from إعدادات البلدية. */
  contactPhone?: string | null;
  /**
   * The office WhatsApp account.
   *
   * Printed on the receipt and quoted in the message, but it cannot make the
   * message *come from* that account: a `wa.me` link names a recipient and has
   * no sender field at all — WhatsApp sends as whichever account the browser
   * or phone is signed into. Signing the message body is the mitigation.
   */
  officeWhatsapp?: string | null;
  receivedAmount?: number;
}) {
  /** The node rasterised into the PDF — the receipt itself, not the dialog. */
  const printRef = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState<null | 'share' | 'download'>(null);
  const [shareNote, setShareNote] = React.useState<string | null>(null);

  // Hooks first, guard second: returning before them would change the hook
  // count between renders the moment a payment is selected.
  if (!payment) return null;

  const amount = receivedAmount ?? payment.amount;
  const properties = citizen.registrations.flatMap((r) => r.properties);
  const property = properties[0] ?? null;

  // The template's tick boxes, resolved from what the register actually holds.
  const isCommercial = properties.some(
    (p) => p.unitType === 'SHOP' || p.units.some((u) => u.unitType === 'SHOP'),
  );
  const ticks = [
    { label: 'سكني', on: !isCommercial },
    { label: 'تجاري', on: isCommercial },
    { label: 'ملك', on: property?.occupancyType === 'OWNER' },
    { label: 'نازح', on: citizen.residentStatus === 'DISPLACED' },
    { label: 'فئة الدم', on: false },
  ];

  const residentialUnits = properties.reduce(
    (total, p) =>
      total + (p.units.filter((u) => u.unitType === 'APARTMENT').length || (p.unitType === 'APARTMENT' ? 1 : 0)),
    0,
  );
  const shopUnits = properties.reduce(
    (total, p) =>
      total + (p.units.filter((u) => u.unitType === 'SHOP').length || (p.unitType === 'SHOP' ? 1 : 0)),
    0,
  );

  const tenantProperty = properties.find((p) => p.occupancyType === 'TENANT');
  const wa = whatsappNumber(citizen.whatsapp ?? citizen.phone);

  /**
   * WhatsApp carries the receipt's *text*, not the PDF.
   *
   * `wa.me` can only prefill a message — attaching a file is not something any
   * link-based hand-off can do; that needs the WhatsApp Business Cloud API
   * (a Meta app, a registered number, a media upload, a server-side token).
   * So the clerk prints/saves the PDF here and sends this message alongside
   * it, and the message is written to stand on its own if they never attach
   * anything: it carries the receipt number, the amount and the balance.
   */
  const message = [
    `بلدية ${municipalityName}`,
    `وصل قبض رقم ${receiptNumber(payment)}`,
    '',
    `المكلّف: ${citizen.fullName}`,
    citizen.referenceNumber ? `الرقم المرجعي: ${citizen.referenceNumber}` : null,
    `البند: ${payment.title}`,
    `المبلغ المقبوض: ${formatLbp(amount)}`,
    payment.remaining > 0
      ? `الرصيد المتبقي: ${formatLbp(payment.remaining)}`
      : 'تم تسديد كامل المبلغ. شكراً لكم.',
    '',
    `التاريخ: ${new Date().toLocaleDateString('ar-LB')}`,
    // Signed with the office numbers: the message may well arrive from a
    // clerk's personal account (a wa.me link cannot choose its sender), so
    // the municipality has to identify itself in the body or the citizen has
    // no idea who billed them.
    contactPhone ? `للاستفسار: ${contactPhone}` : null,
    officeWhatsapp ? `واتساب البلدية: ${officeWhatsapp}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const waHref = wa
    ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}`
    : null;

  /**
   * Builds the PDF, then either shares it or saves it.
   *
   * The two paths differ only in what happens to the finished file, so they
   * share the render: producing the PDF is the slow part (a full rasterise of
   * the receipt at 2×), and doing it twice for "download then share" would be
   * a visible pause each time.
   */
  const handlePdf = async (mode: 'share' | 'download') => {
    const node = printRef.current;
    if (!node) return;

    setBusy(mode);
    setShareNote(null);
    try {
      const file = await renderReceiptPdf(
        node,
        `وصل-${receiptNumber(payment)}.pdf`,
      );

      if (mode === 'download') {
        downloadFile(file);
        return;
      }

      if (await shareFile(file, message)) return;

      /*
       * No file sharing in this browser (Firefox, most desktop browsers with
       * no share target). Falling back rather than failing: the clerk still
       * gets the PDF and still gets WhatsApp open on the right conversation —
       * they attach it themselves, which is one drag instead of nothing.
       *
       * The window is opened from inside the same click that started this,
       * via the href the button already carries, because a `window.open` after
       * an await has lost its user-gesture and is blocked as a popup.
       */
      downloadFile(file);
      setShareNote(
        'متصفحك لا يدعم إرسال الملفات مباشرة. تم تنزيل الوصل — افتح واتساب وأرفقه بالرسالة.',
      );
      if (waHref) window.open(waHref, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error(error);
      setShareNote('تعذّر إنشاء ملف PDF. جرّب «طباعة» بدلاً من ذلك.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel="إغلاق"
        className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl"
      >
        {/* `receipt-print-area` is what the print stylesheet keeps; everything
            else on the page — including this dialog's own chrome — is hidden. */}
        {/*
          Scrolls on both axes, unlike every other panel in the app.

          This is a facsimile of the البلدية's printed receipt book — the
          three-column signature block, the pill-shaped amount boxes and their
          minimum widths are the paper form, not a layout choice, so reflowing
          them on a narrow screen would produce a document that no longer
          matches the one being signed. The receipt keeps its geometry and the
          container scrolls to it instead.
        */}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 sm:p-6">
          <div
            id="receipt-print-area"
            ref={printRef}
            dir="rtl"
            className="mx-auto min-w-[34rem] max-w-[700px] border-2 border-black bg-white p-4 text-black sm:p-6"
          >
            <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
              <p className="text-lg font-bold">ايصال جباية بدل النفايات</p>
              <div className="text-center leading-tight">
                <p className="text-sm font-bold">الجمهورية اللبنانية</p>
                <p className="text-[11px]">وزارة الداخلية والبلديات ـ محافظة الجنوب</p>
                <p className="text-[11px]">قائمقامية صــور</p>
                <p className="mt-1 text-base font-bold">بلدية {municipalityName}</p>
              </div>
            </header>

            <Line label="إستلمنا من السيد/ السيدة" value={citizen.fullName} bold />

            <div className="my-3 flex items-center gap-3">
              <span className="shrink-0 text-sm font-bold">مبلغ وقدره :</span>
              <span className="min-w-[190px] rounded-full border-2 border-black px-4 py-1 text-center font-bold tabular-nums">
                {amount.toLocaleString('en-US')}
              </span>
              <span className="font-bold">ل.ل</span>
              {/* The USD box exists on the printed book and is left blank —
                  this system holds no USD figure, and printing a converted one
                  would invent a rate nobody agreed. */}
              <span className="min-w-[120px] rounded-full border-2 border-black px-4 py-1">
                &nbsp;
              </span>
              <span className="font-bold">$</span>
            </div>

            <div className="my-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {ticks.map((tick) => (
                <span key={tick.label} className="flex items-center gap-1.5 text-sm">
                  {tick.label}
                  <span className="flex size-5 items-center justify-center border-2 border-black text-xs font-bold">
                    {tick.on ? '✓' : ''}
                  </span>
                </span>
              ))}
            </div>

            <Line
              pairs={[
                ['رقم العقار', property?.propertyNumber],
                ['إسم المبنى', property?.buildingName],
                ['الحي', property?.neighborhood],
                ['المنطقة', municipalityName],
              ]}
            />
            <Line
              pairs={[
                ['عدد الوحدات السكنية', residentialUnits || null],
                ['المحلات التابعة', shopUnits || null],
                ['عدد الافراد المقيمين', citizen.familySize],
              ]}
            />
            <Line
              pairs={[
                [
                  'الحالات الإجتماعية أن وجدت',
                  citizen.maritalStatus
                    ? (ar.maritalStatus?.[citizen.maritalStatus as never] ?? null)
                    : null,
                ],
              ]}
            />
            <Line
              pairs={[
                ['اسم المالك بحال كان مستأجر', tenantProperty?.landlordName],
                ['الهاتف', citizen.phone],
                ['الواتسب', citizen.whatsapp],
              ]}
            />

            <div className="mt-6 grid grid-cols-3 gap-4 text-center text-sm font-bold">
              <div>
                <p>ملاحظات</p>
                <p className="mt-1 text-[11px] font-normal">
                  وصل رقم {receiptNumber(payment)} — {payment.title}
                </p>
              </div>
              <div>
                <p>توقيع أمين الصندوق</p>
                <p className="mx-auto mt-6 w-28 border-t border-black" />
              </div>
              <div>
                <p>توقيع المكلف</p>
                <p className="mx-auto mt-6 w-28 border-t border-black" />
              </div>
            </div>

            <p className="mt-4 border-t border-black pt-2 text-center text-[11px]">
              {contactPhone || officeWhatsapp ? (
                <span dir="ltr" className="me-3">
                  {[contactPhone, officeWhatsapp].filter(Boolean).join(' · ')}
                </span>
              ) : null}
              التاريخ: {new Date().toLocaleDateString('ar-LB')}
              {payment.remaining > 0
                ? ` — دفعة جزئية، الرصيد المتبقي ${formatLbp(payment.remaining)}`
                : ''}
            </p>
          </div>
        </div>

        <footer className="shrink-0 space-y-2 border-t p-4">
          {shareNote ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              {shareNote}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="size-4" aria-hidden />
              إغلاق
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              طباعة
            </Button>
            <Button variant="outline" onClick={() => void handlePdf('download')} disabled={busy !== null}>
              {busy === 'download' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              تنزيل PDF
            </Button>
            {/*
              The headline action. It builds the PDF and hands the *file* to
              the OS share sheet, which is where WhatsApp picks it up — the
              only route by which a link-based flow can carry an attachment.
              Where the browser cannot share files it degrades to
              "download + open WhatsApp", explained in `shareNote` rather than
              left for the clerk to work out.
            */}
            <Button onClick={() => void handlePdf('share')} disabled={busy !== null || !wa}>
              {busy === 'share' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <MessageCircle className="size-4" aria-hidden />
              )}
              إرسال الوصل PDF عبر واتساب
            </Button>
          </div>

          {!wa ? (
            <p className="text-end text-xs text-muted-foreground">
              لا يوجد رقم واتساب مسجّل لهذا المواطن — يمكنك تنزيل الوصل وإرساله يدوياً.
            </p>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** One dotted-underline row of the printed form. */
function Line({
  label,
  value,
  pairs,
  bold,
}: {
  label?: string;
  value?: React.ReactNode;
  pairs?: Array<[string, React.ReactNode]>;
  bold?: boolean;
}) {
  const entries = pairs ?? [[label ?? '', value]];
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-1 border-b border-dotted border-black py-1.5 text-sm">
      {entries.map(([key, val]) => (
        <span key={key} className="flex min-w-0 items-end gap-1">
          <span className={bold ? 'font-bold' : 'font-semibold'}>{key} :</span>
          <span className={bold ? 'font-bold' : ''}>{val ?? '—'}</span>
        </span>
      ))}
    </div>
  );
}
