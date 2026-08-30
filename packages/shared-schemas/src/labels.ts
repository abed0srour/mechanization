import type {
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
} as const;
