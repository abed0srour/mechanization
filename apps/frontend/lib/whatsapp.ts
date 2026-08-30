import { formatLbp } from './currency';
import { formatDate } from './dates';

/**
 * Normalizes a phone number into international format for WhatsApp wa.me links.
 * Strips all non-digit characters and applies Lebanon's country code (+961) where needed.
 */
export function formatWhatsAppPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Already prefixed with 00961
  if (digits.startsWith('00961')) return digits.slice(2);
  // Already has 961 country code
  if (digits.startsWith('961')) return digits;
  // Local Lebanese format with leading 0 (e.g. 03xxxxxx, 07xxxxxx, 01xxxxxx)
  if (digits.startsWith('0')) return `961${digits.slice(1)}`;
  // Local 8-digit or 7-digit mobile/landline without 0 (e.g. 70xxxxxx, 71xxxxxx, 3xxxxxx)
  if (digits.length === 7 || digits.length === 8) return `961${digits}`;

  // Other international formats (e.g. 1555..., 44...)
  return digits;
}

/**
 * Derives a human-readable, consistent receipt identifier from a payment record.
 */
export function getReceiptNumber(paymentId: string): string {
  return paymentId.replace(/-/g, '').slice(0, 10).toUpperCase();
}

export interface WhatsAppReceiptParams {
  phone: string | null | undefined;
  citizenName: string;
  feeType: string;
  amount: number | string;
  receiptNumber: string;
  paymentDate?: string | Date | null;
}

/**
 * Generates the standardized Arabic WhatsApp receipt message text.
 *
 * Template:
 * مرحبا [اسم_المواطن]،
 * شكرا لك، تم استلام دفعة [نوع_الرسوم] بنجاح.
 * - رقم الإيصال: [رقم_الإيصال]
 * - المبلغ: [المبلغ]
 * - التاريخ: [التاريخ]
 * شكرا لتعاونكم.
 */
export function buildWhatsAppReceiptMessage({
  citizenName,
  feeType,
  amount,
  receiptNumber,
  paymentDate,
}: Omit<WhatsAppReceiptParams, 'phone'>): string {
  const dateStr = paymentDate ? formatDate(paymentDate) : formatDate(new Date());
  const formattedAmount = typeof amount === 'number' ? formatLbp(amount) : amount;

  return [
    `مرحباً ${citizenName}،`,
    `شكراً لك، تم استلام دفعة ${feeType} بنجاح.`,
    `- رقم الإيصال: ${receiptNumber}`,
    `- المبلغ: ${formattedAmount}`,
    `- التاريخ: ${dateStr}`,
    'شكراً لتعاونكم.',
  ].join('\n');
}

/**
 * Builds a direct WhatsApp chat link (wa.me) with the pre-filled encoded receipt message.
 */
export function buildWhatsAppReceiptUrl(params: WhatsAppReceiptParams): string | null {
  const phone = formatWhatsAppPhone(params.phone);
  if (!phone) return null;

  const message = buildWhatsAppReceiptMessage(params);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
