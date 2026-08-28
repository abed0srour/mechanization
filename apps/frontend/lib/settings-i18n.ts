/**
 * Bilingual copy for the settings section.
 *
 * Every other admin screen in this portal is written in Arabic inline, which
 * works because every reader of those screens is a municipal clerk in Lebanon.
 * Settings is the one section that does not hold: it is where a vendor, an
 * auditor, or a consultant configures a deployment, and those readers are not
 * reliably Arabic-first. The `[locale]` segment already exists in the route and
 * the header already switches it — until now nothing downstream read it.
 *
 * A plain typed object rather than a translation library. There are two
 * languages, both known at build time, and one section using them; `next-intl`
 * or `i18next` would add a provider, a loader and a message-extraction step to
 * buy pluralisation and interpolation this copy does not need. The type is the
 * enforcement — a key added to `ar` and forgotten in `en` fails the build.
 *
 * Direction is *not* handled here. `TenantLayout` puts `dir="rtl"` on `<html>`
 * for the Arabic locale, so the whole tree already flips; components stay
 * correct by using logical properties (`ps-*`, `text-start`, `border-e`) rather
 * than by asking which language they are in. The one thing that does not flip
 * is data that is always Latin — a phone number, an IBAN, a currency code —
 * and those carry `dir="ltr"` at the input.
 */

export type SettingsLocale = 'ar' | 'en';

/** The shape both bundles must fill. `ar` is the source of truth for keys. */
export interface SettingsCopy {
  page: {
    title: string;
    subtitle: string;
  };
  nav: {
    label: string;
    profile: string;
    finance: string;
    numbering: string;
    security: string;
    backup: string;
    users: string;
  };
  common: {
    save: string;
    saving: string;
    saved: string;
    discard: string;
    cancel: string;
    optional: string;
    required: string;
    loadError: string;
    saveError: string;
    unsavedChanges: string;
    notConnected: string;
    notConnectedHint: string;
    storedLocally: string;
  };
  profile: {
    title: string;
    description: string;
    identityHeading: string;
    identityHint: string;
    nameAr: string;
    nameArHint: string;
    nameEn: string;
    nameEnHint: string;
    contactHeading: string;
    contactHint: string;
    phone: string;
    phoneHint: string;
    whatsapp: string;
    whatsappHint: string;
    email: string;
    website: string;
    regionHeading: string;
    regionHint: string;
    governorate: string;
    district: string;
    town: string;
    officeHeading: string;
    officeHint: string;
    officeHours: string;
    officeHoursPlaceholder: string;
    officeAddress: string;
    officeAddressPlaceholder: string;
    logoHeading: string;
    logoHint: string;
    logoAlt: string;
    logoEmpty: string;
    logoUpload: string;
    logoReplace: string;
    logoRemove: string;
    logoTooLarge: string;
    logoWrongType: string;
    logoConstraints: string;
  };
  finance: {
    title: string;
    description: string;
    defaultsHeading: string;
    defaultsHint: string;
    defaultFrequency: string;
    defaultFrequencyHint: string;
    dueDays: string;
    dueDaysHint: string;
    priceDisplay: string;
    priceDisplayHint: string;
    priceDisplayCompact: string;
    priceDisplayExact: string;
    rateHeading: string;
    rateHint: string;
    defaultRate: string;
    defaultRateHint: string;
    rateAppliesTo: string;
    ratePreview: string;
    ratePreviewBase: string;
    ratePreviewCharge: string;
    ratePreviewTotal: string;
    currencyHeading: string;
    currencyHint: string;
    baseCurrency: string;
    baseCurrencyHint: string;
    secondaryCurrency: string;
    secondaryCurrencyHint: string;
    secondaryNone: string;
    exchangeRate: string;
    exchangeRateHint: string;
    exchangeRateUnit: string;
    exchangeRateUpdated: string;
    exchangeRateNever: string;
    conversionPreview: string;
    whishHeading: string;
    whishHint: string;
    whishNumber: string;
    invalidRate: string;
    invalidExchange: string;
  };
  numbering: {
    title: string;
    description: string;
    heading: string;
    hint: string;
    prefix: string;
    prefixHint: string;
    nextNumber: string;
    nextNumberHint: string;
    padding: string;
    paddingHint: string;
    preview: string;
    previewHint: string;
    previewNext: string;
    previewAfter: string;
    documents: Record<SequenceKey, string>;
    documentHints: Record<SequenceKey, string>;
    invalidNext: string;
    invalidPadding: string;
    collision: string;
  };
}

/** The documents this portal issues a reference number for. */
export const SEQUENCE_KEYS = [
  'invoice',
  'serviceOrder',
  'permit',
  'taxReceipt',
  'refund',
] as const;
export type SequenceKey = (typeof SEQUENCE_KEYS)[number];

/** The currencies a Lebanese municipality actually quotes in. */
export const CURRENCIES = ['LBP', 'USD', 'EUR'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const CURRENCY_NAMES: Record<SettingsLocale, Record<CurrencyCode, string>> = {
  ar: { LBP: 'ليرة لبنانية (ل.ل)', USD: 'دولار أميركي ($)', EUR: 'يورو (€)' },
  en: { LBP: 'Lebanese pound (LBP)', USD: 'US dollar (USD)', EUR: 'Euro (EUR)' },
};

const AR: SettingsCopy = {
  page: {
    title: 'إعدادات البلدية',
    subtitle: 'الملف الشخصي، المالية، الترقيم، الأمان، النسخ الاحتياطي، والمستخدمون',
  },
  nav: {
    label: 'أقسام الإعدادات',
    profile: 'الملف الشخصي للبلدية',
    finance: 'المالية',
    numbering: 'تسلسل الترقيم',
    security: 'الأمان',
    backup: 'النسخ الاحتياطي والاستعادة',
    users: 'المستخدمون والأدوار',
  },
  common: {
    save: 'حفظ التغييرات',
    saving: 'جارٍ الحفظ…',
    saved: 'تم حفظ الإعدادات.',
    discard: 'تراجع',
    cancel: 'إلغاء',
    optional: 'اختياري',
    required: 'إلزامي',
    loadError: 'تعذّر تحميل الإعدادات.',
    saveError: 'تعذّر حفظ الإعدادات.',
    unsavedChanges: 'لديك تغييرات غير محفوظة.',
    notConnected: 'غير موصول بالخادم بعد',
    notConnectedHint:
      'تُحفظ هذه الإعدادات على هذا المتصفح فقط إلى أن تُضاف نقاط الحفظ على الخادم.',
    storedLocally: 'محفوظ محلياً',
  },
  profile: {
    title: 'الملف الشخصي للبلدية',
    description: 'الاسم والشعار وبيانات التواصل التي يظهرها البوابة للمواطنين.',
    identityHeading: 'هوية البلدية',
    identityHint: 'الاسم كما يُطبع على الإيصالات والمستندات الرسمية.',
    nameAr: 'اسم البلدية (عربي)',
    nameArHint: 'مثال: بلدية البازورية',
    nameEn: 'اسم البلدية (إنكليزي)',
    nameEnHint: 'يُستخدم في المستندات والمراسلات باللغة الإنكليزية.',
    contactHeading: 'بيانات التواصل',
    contactHint: 'تُطبع على الإيصالات ويراها المواطن في صفحة الدفع.',
    phone: 'الهاتف',
    phoneHint: 'الرقم العام للبلدية، يُطبع على كل إيصال.',
    whatsapp: 'واتساب',
    whatsappHint:
      'حساب المكتب. يُطبع على الإيصال ليردّ عليه المواطن — ولا يجعل رابط wa.me يُرسل من هذا الرقم.',
    email: 'البريد الإلكتروني',
    website: 'الموقع الإلكتروني',
    regionHeading: 'الموقع الإداري',
    regionHint: 'المحافظة والقضاء والبلدة كما ترد في السجلات الرسمية.',
    governorate: 'المحافظة',
    district: 'القضاء',
    town: 'البلدة',
    officeHeading: 'دوام المكتب',
    officeHint: 'يظهر للمواطن الذي يختار الدفع نقداً في البلدية.',
    officeHours: 'ساعات الدوام',
    officeHoursPlaceholder: 'الاثنين–الجمعة، ٨:٠٠–١٤:٠٠',
    officeAddress: 'عنوان المكتب',
    officeAddressPlaceholder: 'الطابق الأول، مبنى البلدية، الساحة العامة',
    logoHeading: 'الشعار الرسمي',
    logoHint: 'يظهر في ترويسة البوابة وعلى المستندات المطبوعة.',
    logoAlt: 'شعار البلدية',
    logoEmpty: 'لا شعار بعد',
    logoUpload: 'رفع شعار',
    logoReplace: 'استبدال',
    logoRemove: 'إزالة',
    logoTooLarge: 'حجم الصورة يتجاوز الحد المسموح.',
    logoWrongType: 'الملف ليس صورة.',
    logoConstraints: 'PNG أو SVG أو JPG — حتى ٥٠٠ كيلوبايت.',
  },
  finance: {
    title: 'المالية',
    description: 'القيم الافتراضية للفواتير الجديدة، ونسبة الرسم، وإدارة العملات.',
    defaultsHeading: 'الإعدادات الافتراضية',
    defaultsHint: 'تُطبَّق على كل فاتورة جديدة، ويمكن تعديلها عند الإصدار.',
    defaultFrequency: 'دورية الرسم الافتراضية',
    defaultFrequencyHint: 'الدورية المقترحة في نافذة إصدار رسم جديد.',
    dueDays: 'مهلة السداد (أيام)',
    dueDaysHint: 'عدد الأيام بين إصدار الفاتورة وتاريخ استحقاقها.',
    priceDisplay: 'عرض المبالغ',
    priceDisplayHint: 'كيف تُعرض المبالغ الكبيرة في الجداول واللوحات.',
    priceDisplayCompact: 'مختصر (١.٢٥ مليون ل.ل)',
    priceDisplayExact: 'كامل (1,250,000 ل.ل)',
    rateHeading: 'نسبة الرسم الافتراضية',
    rateHint: 'النسبة المضافة إلى مبلغ الفاتورة ما لم تُحدَّد نسبة أخرى.',
    defaultRate: 'النسبة (%)',
    defaultRateHint: 'من 0 إلى 100. اتركها صفراً إن كانت الرسوم بمبالغ مقطوعة.',
    rateAppliesTo: 'تُطبَّق على الفواتير الجديدة فقط — الفواتير الصادرة لا تتغيّر.',
    ratePreview: 'مثال',
    ratePreviewBase: 'المبلغ الأساسي',
    ratePreviewCharge: 'الرسم المضاف',
    ratePreviewTotal: 'الإجمالي',
    currencyHeading: 'العملات وسعر الصرف',
    currencyHint: 'العملة الأساسية للسجلات، وعملة ثانوية اختيارية للعرض.',
    baseCurrency: 'العملة الأساسية',
    baseCurrencyHint: 'عملة القيد والإيصالات. تغييرها لا يحوّل الأرصدة القائمة.',
    secondaryCurrency: 'العملة الثانوية',
    secondaryCurrencyHint: 'تُعرض بجانب المبلغ الأساسي عند الاقتضاء.',
    secondaryNone: 'بلا عملة ثانوية',
    exchangeRate: 'سعر الصرف',
    exchangeRateHint: 'كم وحدة من العملة الأساسية تعادل وحدة واحدة من الثانوية.',
    exchangeRateUnit: 'لكل وحدة',
    exchangeRateUpdated: 'آخر تحديث',
    exchangeRateNever: 'لم يُحدَّث بعد',
    conversionPreview: 'المعادلة',
    whishHeading: 'الدفع عبر Whish Money',
    whishHint: 'الرقم الذي يحوّل إليه المواطن. يبقى الخيار مخفياً إن تُرك فارغاً.',
    whishNumber: 'رقم Whish Money',
    invalidRate: 'النسبة يجب أن تكون بين 0 و100.',
    invalidExchange: 'سعر الصرف يجب أن يكون أكبر من صفر.',
  },
  numbering: {
    title: 'تسلسل الترقيم',
    description: 'صيغة الأرقام المرجعية للمستندات التي تصدرها البلدية.',
    heading: 'تسلسلات المستندات',
    hint: 'لكل نوع مستند بادئته وعدّاده الخاص، فلا يتداخل ترقيم نوع مع آخر.',
    prefix: 'البادئة',
    prefixHint: 'حروف لاتينية وأرقام وشرطات، مثل MUN-',
    nextNumber: 'الرقم التالي',
    nextNumberHint: 'رقم أول مستند يصدر بعد الحفظ.',
    padding: 'خانات التصفير',
    paddingHint: 'طول الرقم مع الأصفار على اليسار — 4 تعطي 0042.',
    preview: 'المعاينة',
    previewHint: 'هكذا يظهر الرقم على المستند.',
    previewNext: 'التالي',
    previewAfter: 'ثم',
    documents: {
      invoice: 'فاتورة بلدية',
      serviceOrder: 'أمر خدمة',
      permit: 'رخصة رسمية',
      taxReceipt: 'إيصال رسم',
      refund: 'مذكرة استرداد',
    },
    documentHints: {
      invoice: 'المطالبات المرسلة إلى المواطنين.',
      serviceOrder: 'أوامر العمل الصادرة إلى الأقسام والمتعهدين.',
      permit: 'رخص البناء والإشغال والأنشطة.',
      taxReceipt: 'الإيصالات المسلّمة عند القبض.',
      refund: 'المبالغ المعادة إلى المواطن.',
    },
    invalidNext: 'الرقم التالي يجب أن يكون عدداً صحيحاً أكبر من صفر.',
    invalidPadding: 'خانات التصفير يجب أن تكون بين 1 و12.',
    collision: 'هذه البادئة مستخدمة في تسلسل آخر — الأرقام ستتشابه.',
  },
};

const EN: SettingsCopy = {
  page: {
    title: 'Municipality settings',
    subtitle: 'Profile, finance, numbering, security, backups, and users',
  },
  nav: {
    label: 'Settings sections',
    profile: 'Municipality profile',
    finance: 'Finance',
    numbering: 'Numbering sequences',
    security: 'Security',
    backup: 'Backup & restore',
    users: 'Users & roles',
  },
  common: {
    save: 'Save changes',
    saving: 'Saving…',
    saved: 'Settings saved.',
    discard: 'Discard',
    cancel: 'Cancel',
    optional: 'Optional',
    required: 'Required',
    loadError: 'Could not load settings.',
    saveError: 'Could not save settings.',
    unsavedChanges: 'You have unsaved changes.',
    notConnected: 'Not yet connected to the server',
    notConnectedHint:
      'These settings are kept in this browser until the matching server endpoints exist.',
    storedLocally: 'Stored locally',
  },
  profile: {
    title: 'Municipality profile',
    description: 'The name, logo, and contact details the portal shows to citizens.',
    identityHeading: 'Identity',
    identityHint: 'The name as printed on receipts and official documents.',
    nameAr: 'Municipality name (Arabic)',
    nameArHint: 'For example: بلدية البازورية',
    nameEn: 'Municipality name (English)',
    nameEnHint: 'Used on English-language documents and correspondence.',
    contactHeading: 'Contact details',
    contactHint: 'Printed on receipts and shown to citizens on the payment page.',
    phone: 'Phone',
    phoneHint: "The municipality's public number, printed on every receipt.",
    whatsapp: 'WhatsApp',
    whatsappHint:
      'The office account. Printed on the receipt for citizens to reply to — it cannot make a wa.me link send from this number.',
    email: 'Email',
    website: 'Website',
    regionHeading: 'Administrative location',
    regionHint: 'Governorate, district, and town as they appear in official records.',
    governorate: 'Governorate',
    district: 'District',
    town: 'Town',
    officeHeading: 'Office hours',
    officeHint: 'Shown to citizens who choose to pay in cash at the municipality.',
    officeHours: 'Opening hours',
    officeHoursPlaceholder: 'Mon–Fri, 08:00–14:00',
    officeAddress: 'Office address',
    officeAddressPlaceholder: 'First floor, municipality building, main square',
    logoHeading: 'Official logo',
    logoHint: 'Appears in the portal header and on printed documents.',
    logoAlt: 'Municipality logo',
    logoEmpty: 'No logo yet',
    logoUpload: 'Upload logo',
    logoReplace: 'Replace',
    logoRemove: 'Remove',
    logoTooLarge: 'The image is larger than the allowed size.',
    logoWrongType: 'That file is not an image.',
    logoConstraints: 'PNG, SVG, or JPG — up to 500 KB.',
  },
  finance: {
    title: 'Finance',
    description: 'Defaults for new invoices, the standard fee rate, and currency management.',
    defaultsHeading: 'Default settings',
    defaultsHint: 'Applied to every new invoice, and editable at the point of issue.',
    defaultFrequency: 'Default fee frequency',
    defaultFrequencyHint: 'Pre-selected when a new fee is issued.',
    dueDays: 'Payment term (days)',
    dueDaysHint: 'Days between issuing an invoice and its due date.',
    priceDisplay: 'Amount display',
    priceDisplayHint: 'How large amounts are shown in tables and dashboards.',
    priceDisplayCompact: 'Compact (1.25M LBP)',
    priceDisplayExact: 'Full (1,250,000 LBP)',
    rateHeading: 'Default tax / fee rate',
    rateHint: 'Added to an invoice amount unless a different rate is given.',
    defaultRate: 'Rate (%)',
    defaultRateHint: '0 to 100. Leave at zero if fees are flat amounts.',
    rateAppliesTo: 'Applies to new invoices only — issued invoices do not change.',
    ratePreview: 'Example',
    ratePreviewBase: 'Base amount',
    ratePreviewCharge: 'Rate applied',
    ratePreviewTotal: 'Total',
    currencyHeading: 'Currencies and exchange rate',
    currencyHint: 'The currency records are kept in, plus an optional display currency.',
    baseCurrency: 'Base currency',
    baseCurrencyHint: 'The currency of record and of receipts. Changing it converts nothing.',
    secondaryCurrency: 'Secondary currency',
    secondaryCurrencyHint: 'Shown alongside the base amount where it helps.',
    secondaryNone: 'No secondary currency',
    exchangeRate: 'Exchange rate',
    exchangeRateHint: 'How many units of the base currency equal one of the secondary.',
    exchangeRateUnit: 'per unit',
    exchangeRateUpdated: 'Last updated',
    exchangeRateNever: 'Never updated',
    conversionPreview: 'Equivalent',
    whishHeading: 'Whish Money payments',
    whishHint: 'The number citizens transfer to. Left empty, the option stays hidden.',
    whishNumber: 'Whish Money number',
    invalidRate: 'The rate must be between 0 and 100.',
    invalidExchange: 'The exchange rate must be greater than zero.',
  },
  numbering: {
    title: 'Numbering sequences',
    description: 'The reference-number format for each document the municipality issues.',
    heading: 'Document sequences',
    hint: 'Each document type has its own prefix and counter, so no two share a number.',
    prefix: 'Prefix',
    prefixHint: 'Latin letters, digits, and dashes — for example MUN-',
    nextNumber: 'Next number',
    nextNumberHint: 'The number the first document issued after saving will take.',
    padding: 'Zero-padding',
    paddingHint: 'Total digit length, zero-filled on the left — 4 gives 0042.',
    preview: 'Preview',
    previewHint: 'How the reference will read on the document.',
    previewNext: 'Next',
    previewAfter: 'Then',
    documents: {
      invoice: 'Municipal invoice',
      serviceOrder: 'Service order',
      permit: 'Official permit',
      taxReceipt: 'Tax receipt',
      refund: 'Refund note',
    },
    documentHints: {
      invoice: 'Charges sent to citizens.',
      serviceOrder: 'Work orders issued to departments and contractors.',
      permit: 'Construction, occupancy, and activity permits.',
      taxReceipt: 'Receipts handed over when payment is taken.',
      refund: 'Amounts returned to a citizen.',
    },
    invalidNext: 'The next number must be a whole number greater than zero.',
    invalidPadding: 'Zero-padding must be between 1 and 12.',
    collision: 'Another sequence already uses this prefix — their numbers will look alike.',
  },
};

/**
 * The bundle for a route's `[locale]` segment.
 *
 * Anything that is not `en` falls back to Arabic rather than throwing: the
 * segment is user-editable in the URL, and a mistyped locale should render the
 * portal's primary language, not a crash.
 */
export function settingsCopy(locale: string): SettingsCopy {
  return locale === 'en' ? EN : AR;
}

/** True when the given route locale reads right-to-left. */
export function isRtlLocale(locale: string): boolean {
  return locale !== 'en';
}
