import type { VisitDisposition, VisitOutcome } from './field-work.schema';
import type {
  BloodType,
  DocumentType,
  Gender,
  IdentityDocType,
  LandType,
  MaritalStatus,
  OccupancyType,
  PropertyType,
  ResidentStatus,
  StaffRole,
  UnitType,
} from './enums';

/** Arabic display labels. Keep UI copy here, not inside the schemas. */
export const ar = {
  gender: { MALE: 'ذكر', FEMALE: 'أنثى' } satisfies Record<Gender, string>,

  bloodType: {
    A_POSITIVE: 'A+',
    A_NEGATIVE: 'A-',
    B_POSITIVE: 'B+',
    B_NEGATIVE: 'B-',
    AB_POSITIVE: 'AB+',
    AB_NEGATIVE: 'AB-',
    O_POSITIVE: 'O+',
    O_NEGATIVE: 'O-',
  } satisfies Record<BloodType, string>,

  /** How often a fee recurs. */
  feeFrequency: {
    ONCE: 'مرة واحدة',
    MONTHLY: 'شهري',
    HALF_YEARLY: 'نصف سنوي',
    ANNUALLY: 'سنوي',
  },

  /** Who a fee is issued to. */
  feeTargetType: {
    ALL_CITIZENS: 'جميع المواطنين',
    BUILDING_CATEGORY: 'فئة عقارية',
    INDIVIDUAL_CITIZEN: 'مواطن محدّد',
  },

  /** The property categories a fee may target, in the registry's own terms. */
  feeTargetCategory: {
    BUILDING: 'مبانٍ',
    HOUSE: 'منازل',
    LAND: 'أراضٍ',
    TENT: 'خيم',
    APARTMENT: 'شقق سكنية',
    CLINIC: 'عيادات',
    SHOP: 'محلات تجارية',
  },

  /** Where a payment stands. `PENDING_REVIEW` is a claim, not a receipt. */
  paymentStatus: {
    UNPAID: 'مطلوب',
    PENDING_REVIEW: 'قيد المراجعة',
    PAID: 'مدفوع',
    OVERDUE: 'متأخّر',
  },

  paymentMethod: {
    CASH: 'نقداً في البلدية',
    WHISH_MONEY: 'تحويل Whish Money',
    COLLECTOR: 'عبر المحصّل',
  },

  /** Staff roles as the municipality names them, not as the enum spells them. */
  staffRole: {
    SUPER_ADMIN: 'مدير النظام',
    AUDITOR: 'مدقّق',
    FIELD_INSPECTOR: 'مفتّش ميداني',
    COLLECTOR: 'جابي',
    ACCOUNTANT: 'محاسب',
    ADMINISTRATIVE_OFFICER: 'موظف إداري',
  } satisfies Record<StaffRole, string>,

  residentStatus: {
    REFUGEE: 'لاجئ',
    DISPLACED: 'نازح',
    VILLAGE_RESIDENT: 'من سكان الضيعة',
  } satisfies Record<ResidentStatus, string>,

  identityDocType: {
    NATIONAL_ID: 'هوية',
    FAMILY_RECORD: 'إخراج قيد',
    DRIVER_LICENSE: 'دفتر سواقة',
    PASSPORT: 'جواز سفر',
  } satisfies Record<IdentityDocType, string>,

  /** Label of the number field that appears once a document type is chosen. */
  identityDocNumberLabel: {
    NATIONAL_ID: 'رقم الهوية',
    FAMILY_RECORD: 'رقم القيد',
    DRIVER_LICENSE: 'رقم الرخصة',
    PASSPORT: 'رقم الجواز',
  } satisfies Record<IdentityDocType, string>,

  maritalStatus: {
    SINGLE: 'أعزب',
    MARRIED: 'متزوج',
    DIVORCED: 'مطلّق',
    WIDOWED: 'أرمل',
  } satisfies Record<MaritalStatus, string>,

  occupancyType: { OWNER: 'مالك', TENANT: 'مستأجر' } satisfies Record<OccupancyType, string>,

  propertyType: {
    BUILDING: 'مبنى',
    HOUSE: 'منزل',
    LAND: 'أرض',
    TENT: 'خيمة',
  } satisfies Record<PropertyType, string>,

  unitType: {
    APARTMENT: 'شقة',
    CLINIC: 'عيادة',
    SHOP: 'محل تجاري',
  } satisfies Record<UnitType, string>,

  landType: {
    AGRICULTURAL: 'زراعي',
    INDUSTRIAL: 'صناعي',
  } satisfies Record<LandType, string>,

  documentType: {
    IDENTITY: 'وثيقة الإثبات',
    OWNERSHIP_PROOF: 'سند الملكية',
    RENTAL_CONTRACT: 'عقد الإيجار',
    RESIDENCY_PROOF: 'إثبات الإقامة',
    EXTRA_PHOTO: 'صورة إضافية',
  } satisfies Record<DocumentType, string>,

  /**
   * نتيجة الزيارة — why a door did not produce a finished record. Worded as the
   * worker would say it out loud, because this is a list they pick from while
   * standing on a doorstep, not a report heading.
   */
  visitOutcome: {
    COMPLETED: 'اكتمل التسجيل',
    PARTIAL: 'بيانات ناقصة',
    NOBODY_HOME: 'لا أحد في المنزل',
    ACCESS_BLOCKED: 'تعذّر الوصول',
    NOT_DECISION_MAKER: 'الموجود لا يملك صلاحية',
    SEASONAL: 'إقامة موسمية',
    ABROAD: 'مقيم خارج لبنان',
    DOCUMENTS_MISSING: 'المستندات غير متوفرة',
    ESTATE_UNSETTLED: 'إرث غير مقسوم',
    DISPUTED: 'ملكية متنازع عليها',
    REFUSED: 'رفض التعاون',
    ALREADY_REGISTERED: 'مسجّل مسبقاً',
    DEMOLISHED: 'مهدوم',
    ADDRESS_INVALID: 'العنوان غير صحيح',
    MERGED_PARCEL: 'مدموج بعقار آخر',
  } satisfies Record<VisitOutcome, string>,

  /** What the municipality does next about an outcome. */
  visitDisposition: {
    DONE: 'منجز',
    RETRY: 'يحتاج زيارة أخرى',
    WAITING: 'بانتظار طرف آخر',
    CLOSED: 'مغلق نهائياً',
  } satisfies Record<VisitDisposition, string>,
} as const;

export const en = {
  gender: { MALE: 'Male', FEMALE: 'Female' } satisfies Record<Gender, string>,

  bloodType: {
    A_POSITIVE: 'A+',
    A_NEGATIVE: 'A-',
    B_POSITIVE: 'B+',
    B_NEGATIVE: 'B-',
    AB_POSITIVE: 'AB+',
    AB_NEGATIVE: 'AB-',
    O_POSITIVE: 'O+',
    O_NEGATIVE: 'O-',
  } satisfies Record<BloodType, string>,

  feeFrequency: {
    ONCE: 'Once',
    MONTHLY: 'Monthly',
    HALF_YEARLY: 'Semi-Annually',
    ANNUALLY: 'Annually',
  },

  feeTargetType: {
    ALL_CITIZENS: 'All Citizens',
    BUILDING_CATEGORY: 'Property Category',
    INDIVIDUAL_CITIZEN: 'Individual Citizen',
  },

  feeTargetCategory: {
    BUILDING: 'Buildings',
    HOUSE: 'Houses',
    LAND: 'Land',
    TENT: 'Tents',
    APARTMENT: 'Apartments',
    CLINIC: 'Clinics',
    SHOP: 'Commercial Shops',
  },

  paymentStatus: {
    UNPAID: 'Unpaid',
    PENDING_REVIEW: 'Pending Review',
    PAID: 'Paid',
    OVERDUE: 'Overdue',
  },

  paymentMethod: {
    CASH: 'Cash at Municipality',
    WHISH_MONEY: 'Whish Money Transfer',
    COLLECTOR: 'Via Collector',
  },

  staffRole: {
    SUPER_ADMIN: 'System Administrator',
    AUDITOR: 'Auditor',
    FIELD_INSPECTOR: 'Field Inspector',
    COLLECTOR: 'Collector',
    ACCOUNTANT: 'Accountant',
    ADMINISTRATIVE_OFFICER: 'Administrative Officer',
  } satisfies Record<StaffRole, string>,

  residentStatus: {
    REFUGEE: 'Refugee',
    DISPLACED: 'Displaced',
    VILLAGE_RESIDENT: 'Village Resident',
  } satisfies Record<ResidentStatus, string>,

  identityDocType: {
    NATIONAL_ID: 'National ID',
    FAMILY_RECORD: 'Family Record',
    DRIVER_LICENSE: 'Driver License',
    PASSPORT: 'Passport',
  } satisfies Record<IdentityDocType, string>,

  identityDocNumberLabel: {
    NATIONAL_ID: 'National ID Number',
    FAMILY_RECORD: 'Family Record Number',
    DRIVER_LICENSE: 'Driver License Number',
    PASSPORT: 'Passport Number',
  } satisfies Record<IdentityDocType, string>,

  maritalStatus: {
    SINGLE: 'Single',
    MARRIED: 'Married',
    DIVORCED: 'Divorced',
    WIDOWED: 'Widowed',
  } satisfies Record<MaritalStatus, string>,

  occupancyType: { OWNER: 'Owner', TENANT: 'Tenant' } satisfies Record<OccupancyType, string>,

  propertyType: {
    BUILDING: 'Building',
    HOUSE: 'House',
    LAND: 'Land',
    TENT: 'Tent',
  } satisfies Record<PropertyType, string>,

  unitType: {
    APARTMENT: 'Apartment',
    CLINIC: 'Clinic',
    SHOP: 'Commercial Shop',
  } satisfies Record<UnitType, string>,

  landType: {
    AGRICULTURAL: 'Agricultural',
    INDUSTRIAL: 'Industrial',
  } satisfies Record<LandType, string>,

  documentType: {
    IDENTITY: 'Identity Document',
    OWNERSHIP_PROOF: 'Proof of Ownership',
    RENTAL_CONTRACT: 'Rental Agreement',
    RESIDENCY_PROOF: 'Residency Verification',
    EXTRA_PHOTO: 'Additional Photograph',
  } satisfies Record<DocumentType, string>,

  visitOutcome: {
    COMPLETED: 'Registered',
    PARTIAL: 'Partial data',
    NOBODY_HOME: 'Nobody home',
    ACCESS_BLOCKED: 'Could not reach',
    NOT_DECISION_MAKER: 'Not the decision maker',
    SEASONAL: 'Seasonal resident',
    ABROAD: 'Lives abroad',
    DOCUMENTS_MISSING: 'Documents unavailable',
    ESTATE_UNSETTLED: 'Estate undivided',
    DISPUTED: 'Ownership disputed',
    REFUSED: 'Refused',
    ALREADY_REGISTERED: 'Already registered',
    DEMOLISHED: 'Demolished',
    ADDRESS_INVALID: 'Invalid address',
    MERGED_PARCEL: 'Merged into another parcel',
  } satisfies Record<VisitOutcome, string>,

  visitDisposition: {
    DONE: 'Done',
    RETRY: 'Needs another visit',
    WAITING: 'Blocked on someone else',
    CLOSED: 'Closed',
  } satisfies Record<VisitDisposition, string>,
} as const;

export function getLabels(locale: string = 'ar') {
  return locale === 'en' ? en : ar;
}
