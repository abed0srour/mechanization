/**
 * Arabic number-to-words converter (Tafqeet / تفقيط الأرقام باللغة العربية).
 *
 * Formats financial figures into grammatically sound Arabic words for
 * municipal receipts and counter slips (e.g. 2,500,000 -> "مليونان وخمسمائة ألف ليرة لبنانية فقط لا غير").
 */

const ONES_MASCULINE = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];

const ONES_FEMININE = [
  '',
  'واحدة',
  'اثنتان',
  'ثلاث',
  'أربع',
  'خمس',
  'ست',
  'سبع',
  'ثمان',
  'تسع',
  'عشر',
  'إحدى عشرة',
  'اثنتا عشرة',
  'ثلاث عشرة',
  'أربع عشرة',
  'خمس عشرة',
  'ست عشرة',
  'سبع عشرة',
  'ثماني عشرة',
  'تسع عشرة',
];

const TENS = [
  '',
  'عشرة',
  'عشرون',
  'ثلاثون',
  'أربعون',
  'خمسون',
  'ستون',
  'سبعون',
  'ثمانون',
  'تسعون',
];

const HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

/** Converts a 1-999 chunk into Arabic words. */
function convertThreeDigits(num: number, feminine = false): string {
  if (num === 0) return '';

  const parts: string[] = [];
  const hundred = Math.floor(num / 100);
  const remainder = num % 100;

  if (hundred > 0) {
    parts.push(HUNDREDS[hundred]!);
  }

  if (remainder > 0) {
    if (remainder < 20) {
      parts.push(feminine ? ONES_FEMININE[remainder]! : ONES_MASCULINE[remainder]!);
    } else {
      const unit = remainder % 10;
      const ten = Math.floor(remainder / 10);

      if (unit > 0) {
        const unitWord = feminine ? ONES_FEMININE[unit]! : ONES_MASCULINE[unit]!;
        parts.push(`${unitWord} و${TENS[ten]!}`);
      } else {
        parts.push(TENS[ten]!);
      }
    }
  }

  return parts.join(' و');
}

/**
 * Converts any non-negative integer into Arabic words with the currency unit and "فقط لا غير".
 *
 * @param amount - Non-negative integer (in LBP)
 * @param currency - Optional currency suffix, defaults to 'ليرة لبنانية'
 */
export function tafqeet(amount: number, currency = 'ليرة لبنانية'): string {
  const integerPart = Math.floor(Math.abs(amount));

  if (integerPart === 0) {
    return `صفر ${currency} فقط لا غير`;
  }

  const billions = Math.floor(integerPart / 1_000_000_000);
  const millions = Math.floor((integerPart % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((integerPart % 1_000_000) / 1_000);
  const remainder = integerPart % 1_000;

  const chunks: string[] = [];

  // Billions (مليار - مذكر)
  if (billions > 0) {
    if (billions === 1) {
      chunks.push('مليار');
    } else if (billions === 2) {
      chunks.push('ملياران');
    } else if (billions >= 3 && billions <= 10) {
      chunks.push(`${ONES_MASCULINE[billions]} مليارات`);
    } else {
      chunks.push(`${convertThreeDigits(billions, false)} ملياراً`);
    }
  }

  // Millions (مليون - مذكر)
  if (millions > 0) {
    if (millions === 1) {
      chunks.push('مليون');
    } else if (millions === 2) {
      chunks.push('مليونان');
    } else if (millions >= 3 && millions <= 10) {
      chunks.push(`${ONES_MASCULINE[millions]} ملايين`);
    } else {
      chunks.push(`${convertThreeDigits(millions, false)} ملايين`);
    }
  }

  // Thousands (ألف - مذكر)
  if (thousands > 0) {
    if (thousands === 1) {
      chunks.push('ألف');
    } else if (thousands === 2) {
      chunks.push('ألفان');
    } else if (thousands >= 3 && thousands <= 10) {
      chunks.push(`${ONES_MASCULINE[thousands]} آلاف`);
    } else {
      chunks.push(`${convertThreeDigits(thousands, false)} ألفاً`);
    }
  }

  // Remainder (0-999)
  if (remainder > 0) {
    if (chunks.length === 0 && remainder === 1) {
      return `ليرة واحدة لبنانية فقط لا غير`;
    } else if (chunks.length === 0 && remainder === 2) {
      return `ليرتان لبنانيتان فقط لا غير`;
    } else if (chunks.length === 0 && remainder >= 3 && remainder <= 10) {
      return `${ONES_FEMININE[remainder]} ليرات لبنانية فقط لا غير`;
    } else {
      chunks.push(convertThreeDigits(remainder, false));
    }
  }

  const words = chunks.join(' و');
  return `${words} ${currency} فقط لا غير`;
}
