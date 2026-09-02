/** `+9617xxxxxxx` / `03 123456` → the digits wa.me expects, Lebanon-defaulted. */
export function formatWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('961')) return digits;
  if (digits.startsWith('0')) return `961${digits.slice(1)}`;
  return digits.length <= 8 ? `961${digits}` : digits;
}

/** «بلدية »-prefixed display name, falling back to the generic «البلدية». */
function municipalityDisplayName(municipalityName: string | undefined): string {
  const rawName = municipalityName?.trim() || '';
  if (!rawName) return 'البلدية';
  return rawName.startsWith('بلدية') ? rawName : `بلدية ${rawName}`;
}

/**
 * Generates a formal, clear municipality registration welcome & reference
 * message in Arabic — gendered from the citizen's own `gender` field when
 * known, and neutral («المواطن/ة») only for older records that predate it.
 */
export function buildCitizenWelcomeMessage({
  fullName,
  gender,
  referenceNumber,
  municipalityName,
}: {
  fullName: string;
  gender?: string | null;
  referenceNumber: string | null;
  municipalityName?: string;
}): string {
  const salutation =
    gender === 'MALE'
      ? `حضرة المواطن ${fullName} المحترم،`
      : gender === 'FEMALE'
        ? `حضرة المواطنة ${fullName} المحترمة،`
        : `حضرة المواطن/ة ${fullName} المحترم/ة،`;

  const municipalityDisplay = municipalityDisplayName(municipalityName);

  return (
    `${salutation}\n\n` +
    `تحية طيبة،\n` +
    `نود إعلامكم بأنه قد تم تسجيل وتحديث بياناتكم وملفكم بنجاح لدى ${municipalityDisplay}.\n\n` +
    (referenceNumber ? `📌 *الرقم المرجعي الخاص بكم:* \`${referenceNumber}\`\n\n` : '') +
    `يرجى حفظ هذا الرقم المرجعي والاحتفاظ به لمتابعة كافة معاملاتكم وسجلاتكم الرسمية لدى البلدية.\n\n` +
    `مع تحيات،\n` +
    `${municipalityDisplay}`
  );
}

/** The wa.me/web.whatsapp.com deep link for a pre-filled message, or null with no reachable number. */
export function buildWhatsappHref(
  destination: string | null | undefined,
  message: string,
): string | null {
  const digits = formatWhatsappNumber(destination);
  return digits ? `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}` : null;
}
