'use client';

import * as React from 'react';
import { Download, Loader2, MessageCircle, Printer, X } from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import type { CitizenProfile, CitizenProfilePayment } from '@/lib/api-client';
import { formatLbp } from '@/lib/currency';
import { formatDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { downloadFile, renderReceiptPdf, shareFile } from '@/lib/receipt-pdf';

/**
 * A receipt number that is stable for a given payment.
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
  if (digits.startsWith('0')) return `961${digits.slice(1)}`;
  return digits.length <= 8 ? `961${digits}` : digits;
}

/**
 * Official Republic of Lebanon Calligraphy SVG Vector Emblem.
 */
function LebaneseRepublicCalligraphy({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 60"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="الجمهورية اللبنانية"
    >
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        style={{
          fontFamily: "'Amiri', 'Traditional Arabic', 'Scheherazade New', 'Noto Naskh Arabic', serif",
          fontSize: '32px',
          fontWeight: 'bold',
          letterSpacing: '0.02em',
        }}
      >
        الجمهورية اللبنانية
      </text>
    </svg>
  );
}

/**
 * وصل قبض / ايصال جباية — Official municipal collection receipt matching the official physical printed book.
 */
export function PaymentReceipt({
  open,
  onOpenChange,
  citizen,
  payment,
  municipalityName,
  contactPhone,
  officeWhatsapp,
  receivedAmount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citizen: CitizenProfile;
  payment: CitizenProfilePayment | null;
  municipalityName: string;
  contactPhone?: string | null;
  officeWhatsapp?: string | null;
  receivedAmount?: number;
}) {
  const printRef = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState<null | 'share' | 'download'>(null);
  const [shareNote, setShareNote] = React.useState<string | null>(null);

  if (!payment) return null;

  const amount = receivedAmount ?? payment.amount;
  const properties = citizen.registrations.flatMap((r) => r.properties);
  const property = properties[0] ?? null;

  // The template's tick boxes, resolved from register
  const isCommercial = properties.some(
    (p) => p.unitType === 'SHOP' || p.units?.some((u) => u.unitType === 'SHOP'),
  );
  const isOwner = property?.occupancyType === 'OWNER';
  const isDisplaced = citizen.residentStatus === 'DISPLACED';

  const residentialUnits = properties.reduce(
    (total, p) =>
      total +
      (p.units?.filter((u) => u.unitType === 'APARTMENT').length ||
        (p.unitType === 'APARTMENT' ? 1 : 0)),
    0,
  );
  const shopUnits = properties.reduce(
    (total, p) =>
      total +
      (p.units?.filter((u) => u.unitType === 'SHOP').length || (p.unitType === 'SHOP' ? 1 : 0)),
    0,
  );

  const tenantProperty = properties.find((p) => p.occupancyType === 'TENANT');
  const wa = whatsappNumber(citizen.whatsapp ?? citizen.phone);

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
    `التاريخ: ${formatDate(new Date())}`,
    contactPhone ? `للاستفسار: ${contactPhone}` : null,
    officeWhatsapp ? `واتساب البلدية: ${officeWhatsapp}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null;

  const handlePdf = async (mode: 'share' | 'download') => {
    const node = printRef.current;
    if (!node) return;

    setBusy(mode);
    setShareNote(null);
    try {
      const file = await renderReceiptPdf(node, `وصل-${receiptNumber(payment)}.pdf`);

      if (mode === 'download') {
        downloadFile(file);
        return;
      }

      if (await shareFile(file, message)) return;

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
        className="flex max-h-[94vh] flex-col gap-0 p-0 sm:max-w-4xl"
      >
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6 bg-muted/20">
          {/* Printable Receipt Facsimile */}
          <div
            id="receipt-print-area"
            ref={printRef}
            dir="rtl"
            className="relative mx-auto min-w-[620px] max-w-[760px] bg-white p-4 text-black shadow-md select-none font-sans"
            style={{
              boxShadow: '0 0 0 1px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.08)',
            }}
          >
            {/* Outer Frame with Corner Ticks */}
            <div className="relative border-2 border-black p-2 bg-white">
              {/* Corner tick marks (Printing / Boundary Marks) */}
              <div className="pointer-events-none absolute -top-3 -start-3 size-6 border-e-2 border-b-2 border-black" />
              <div className="pointer-events-none absolute -top-3 -end-3 size-6 border-s-2 border-b-2 border-black" />
              <div className="pointer-events-none absolute -bottom-3 -start-3 size-6 border-e-2 border-t-2 border-black" />
              <div className="pointer-events-none absolute -bottom-3 -end-3 size-6 border-s-2 border-t-2 border-black" />

              {/* Inner Solid Border */}
              <div className="border-[2px] border-black p-5 sm:p-6 bg-white space-y-4">
                {/* 1. Top Header */}
                <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
                  {/* Left Header Title */}
                  <div className="text-center pt-2">
                    <h2 className="text-xl sm:text-2xl font-black tracking-tight font-sans">
                      ايصال جباية بدل النفايات
                    </h2>
                    <div className="w-16 h-[2px] bg-black mx-auto mt-1" />
                  </div>

                  {/* Right Header: Republic of Lebanon Emblem & Municipality Details */}
                  <div className="text-center space-y-0.5 leading-tight">
                    <div className="flex justify-center -mb-1">
                      <LebaneseRepublicCalligraphy className="h-9 w-44 text-black" />
                    </div>
                    <p className="text-xs font-bold text-black">
                      وزارة الداخلية والبلديات ـ محافظة الجنوب
                    </p>
                    <p className="text-xs font-bold text-black">قائمقامية صور</p>
                    <div className="pt-0.5">
                      <span className="inline-block border-b-2 border-black pb-0.5 text-base sm:text-lg font-black text-black">
                        بلدية {municipalityName || 'البازورية'}
                      </span>
                    </div>
                  </div>
                </header>

                {/* 2. Payer Section (إستلمنا من السيد/ السيدة) */}
                <div className="flex items-center gap-3 pt-1">
                  <span className="shrink-0 text-sm font-bold text-black whitespace-nowrap">
                    إستلمنا من السيد/ السيدة:
                  </span>
                  <div className="flex-1 bg-gray-200/90 h-9 px-4 flex items-center font-bold text-base text-black truncate">
                    {citizen.fullName}
                  </div>
                </div>

                {/* 3. Amount Section (مبلغ وقدره) */}
                <div className="flex items-center gap-3 py-1">
                  <span className="shrink-0 text-sm sm:text-base font-bold text-black whitespace-nowrap">
                    مبلغ وقدره :
                  </span>

                  {/* LBP Capsule */}
                  <div className="flex-1 max-w-[210px] h-9 rounded-full border-2 border-black px-3 flex items-center justify-center font-bold text-base tabular-nums text-black">
                    {amount ? Number(amount).toLocaleString('en-US') : ''}
                  </div>
                  <span className="font-bold text-base text-black">L.L</span>

                  {/* USD Capsule */}
                  <div className="flex-1 max-w-[190px] h-9 rounded-full border-2 border-black px-3 flex items-center justify-center font-bold text-base tabular-nums text-black">
                    {/* Blank on physical book */}
                  </div>
                  <span className="font-bold text-xl font-mono text-black">$</span>
                </div>

                {/* 4. Checkboxes Row */}
                <div className="flex items-center justify-center gap-4 sm:gap-6 py-1.5 border-y border-black/20">
                  <CheckboxItem label="سكني" checked={!isCommercial} />
                  <CheckboxItem label="تجاري" checked={isCommercial} />
                  <CheckboxItem label="ملك" checked={isOwner} />
                  <CheckboxItem label="نازح" checked={isDisplaced} />
                  <CheckboxItem label="فئة الدم" checked={false} />
                </div>

                {/* 5. Dotted Lines Property & Family Data */}
                <div className="space-y-2 text-xs sm:text-sm font-bold text-black">
                  {/* Row 1: Property and Neighborhood */}
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <DottedField
                      label="رقم العقار"
                      value={property?.propertyNumber}
                      flex="flex-[1.2]"
                    />
                    <DottedField
                      label="إسم المبنى"
                      value={property?.buildingName}
                      flex="flex-[1.5]"
                    />
                    <DottedField label="الحي" value={property?.neighborhood} flex="flex-[1]" />
                    <DottedField
                      label="المنطقة"
                      value={municipalityName || 'البازورية'}
                      flex="flex-[1]"
                    />
                  </div>

                  {/* Row 2: Units and Family Count */}
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <DottedField
                      label="عدد الوحدات السكنية"
                      value={residentialUnits > 0 ? String(residentialUnits) : undefined}
                      flex="flex-1"
                    />
                    <DottedField
                      label="المحلات التابعة"
                      value={shopUnits > 0 ? String(shopUnits) : undefined}
                      flex="flex-1"
                    />
                    <DottedField
                      label="عدد الأفراد المقيمين"
                      value={citizen.familySize ? String(citizen.familySize) : undefined}
                      flex="flex-1"
                    />
                  </div>

                  {/* Row 3: Social Cases */}
                  <div className="flex items-baseline gap-x-4">
                    <DottedField
                      label="الحالات الإجتماعية أن وجدت"
                      value={
                        citizen.maritalStatus
                          ? (ar.maritalStatus?.[citizen.maritalStatus as never] ?? undefined)
                          : undefined
                      }
                      flex="w-full"
                    />
                  </div>

                  {/* Row 4: Landlord and Contact */}
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <DottedField
                      label="اسم المالك بحال كان مستأجر"
                      value={tenantProperty?.landlordName}
                      flex="flex-[1.5]"
                    />
                    <DottedField label="الهاتف" value={citizen.phone} flex="flex-1" />
                    <DottedField label="الواتسب" value={citizen.whatsapp} flex="flex-1" />
                  </div>
                </div>

                {/* 6. Signatures Footer */}
                <div className="pt-6 pb-2 grid grid-cols-3 gap-6 text-center text-xs sm:text-sm font-bold text-black">
                  <div>
                    <p className="font-bold">ملاحظات</p>
                    <div className="w-24 sm:w-32 border-b-2 border-black mt-6 mx-auto" />
                  </div>
                  <div>
                    <p className="font-bold">توقيع أمين الصندوق</p>
                    <div className="w-24 sm:w-32 border-b-2 border-black mt-6 mx-auto" />
                  </div>
                  <div>
                    <p className="font-bold">توقيع المكلف</p>
                    <div className="w-24 sm:w-32 border-b-2 border-black mt-6 mx-auto" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Action Buttons Footer */}
        <footer className="shrink-0 space-y-2 border-t p-4 bg-card">
          {shareNote ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              {shareNote}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              رقم الوصل: {receiptNumber(payment)} • التاريخ: {formatDate(new Date())}
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                <X className="size-4 rtl:ml-1.5 ltr:mr-1.5" />
                إغلاق
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="size-4 rtl:ml-1.5 ltr:mr-1.5" />
                طباعة الوصل
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handlePdf('download')}
                disabled={busy !== null}
              >
                {busy === 'download' ? (
                  <Loader2 className="size-4 animate-spin rtl:ml-1.5 ltr:mr-1.5" />
                ) : (
                  <Download className="size-4 rtl:ml-1.5 ltr:mr-1.5" />
                )}
                تنزيل PDF
              </Button>
              <Button
                size="sm"
                onClick={() => void handlePdf('share')}
                disabled={busy !== null || !wa}
              >
                {busy === 'share' ? (
                  <Loader2 className="size-4 animate-spin rtl:ml-1.5 ltr:mr-1.5" />
                ) : (
                  <MessageCircle className="size-4 rtl:ml-1.5 ltr:mr-1.5" />
                )}
                إرسال عبر واتساب
              </Button>
            </div>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** Checkbox item matching the official template square boxes. */
function CheckboxItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-black">
      <div className="size-5 border-2 border-black flex items-center justify-center font-black text-xs text-black">
        {checked ? '✓' : ''}
      </div>
      <span>{label}</span>
    </div>
  );
}

/** Dotted line fillable row field matching the official municipal receipt format. */
function DottedField({
  label,
  value,
  flex = 'flex-1',
}: {
  label: string;
  value?: React.ReactNode;
  flex?: string;
}) {
  return (
    <div className={`flex items-baseline gap-1.5 ${flex} min-w-0`}>
      <span className="shrink-0 text-xs sm:text-sm font-bold whitespace-nowrap text-black">
        {label} :
      </span>
      <div className="flex-1 border-b-2 border-dotted border-black/80 px-1.5 min-h-[22px] flex items-center font-semibold text-xs sm:text-sm truncate text-black">
        {value || ''}
      </div>
    </div>
  );
}
