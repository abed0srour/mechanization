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
}

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
