'use client';

import * as React from 'react';
import { MessageCircle, Printer, X } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import type { CitizenProfile, CitizenProfilePayment } from '@/lib/api-client';
import { formatLbp } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

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
 * Rendered as HTML and printed through the browser rather than built with a
 * PDF library. That is a deliberate trade: jsPDF and pdf-lib have no Arabic
 * shaping — they lay out `ا ل ب ا ز و ر ي ة` as disconnected left-to-right
 * glyphs unless you ship a shaping engine and an embedded font — whereas the
 * browser already shapes Arabic correctly and every OS print dialog offers
 * "Save as PDF". The output is a real PDF, the Arabic is right, and the
 * dependency count is zero.
 */
export function PaymentReceipt({
  open,
  onOpenChange,
  citizen,
  payment,
  municipalityName,
  /** What was handed over now — may be less than the invoice's full amount. */
  receivedAmount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citizen: CitizenProfile;
  payment: CitizenProfilePayment | null;
  municipalityName: string;
  receivedAmount?: number;
}) {
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
  ]
    .filter(Boolean)
    .join('\n');

  const waHref = wa
    ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel="إغلاق"
        className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl"
      >
        {/* `receipt-print-area` is what the print stylesheet keeps; everything
            else on the page — including this dialog's own chrome — is hidden. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div
            id="receipt-print-area"
            dir="rtl"
            className="mx-auto max-w-[700px] border-2 border-black bg-white p-6 text-black"
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
              التاريخ: {new Date().toLocaleDateString('ar-LB')}
              {payment.remaining > 0
                ? ` — دفعة جزئية، الرصيد المتبقي ${formatLbp(payment.remaining)}`
                : ''}
            </p>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden />
            إغلاق
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            طباعة / حفظ PDF
          </Button>
          {waHref ? (
            <Button asChild>
              <a href={waHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" aria-hidden />
                إرسال عبر واتساب
              </a>
            </Button>
          ) : (
            <Button disabled title="لا يوجد رقم هاتف مسجّل لهذا المواطن">
              <MessageCircle className="size-4" aria-hidden />
              إرسال عبر واتساب
            </Button>
          )}
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
