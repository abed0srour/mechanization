import { z } from 'zod';

/**
 * Domain enums. Values are stable machine identifiers (never translated);
 * Arabic display labels live in `labels.ts` so the wire format stays language-neutral.
 */

/**
 * Every enum in this file is driven by a fixed choice control (a `ChoiceCard`
 * or `Select`) in the wizard, never free text — so the only failure a citizen
 * can actually produce is "nothing chosen yet". One Arabic message covers that
 * (and, defensively, an unexpected value) rather than leaning on Zod's default
 * English "Required" / "Invalid enum value" text, which is what a bare
 * `z.enum(...)` falls back to for both cases.
 */
function arabicEnum<T extends readonly [string, ...string[]]>(values: T, message: string) {
  return z.enum(values as unknown as [T[number], ...T[number][]], {
    errorMap: () => ({ message }),
  });
}

export const GENDER = ['MALE', 'FEMALE'] as const;
export const genderSchema = arabicEnum(GENDER, 'الجنس مطلوب');
export type Gender = z.infer<typeof genderSchema>;

/** صفة الإقامة — classifies the person, never the property. */
export const RESIDENT_STATUS = ['REFUGEE', 'DISPLACED', 'VILLAGE_RESIDENT'] as const;
export const residentStatusSchema = arabicEnum(RESIDENT_STATUS, 'صفة الإقامة مطلوبة');
export type ResidentStatus = z.infer<typeof residentStatusSchema>;

export const IDENTITY_DOC_TYPE = [
  'NATIONAL_ID',
  'FAMILY_RECORD',
  'DRIVER_LICENSE',
  'PASSPORT',
] as const;
export const identityDocTypeSchema = arabicEnum(IDENTITY_DOC_TYPE, 'نوع وثيقة الإثبات مطلوب');
export type IdentityDocType = z.infer<typeof identityDocTypeSchema>;

/** الحالة الاجتماعية — asked in step 2 alongside the rest of the household picture. */
export const MARITAL_STATUS = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const;
export const maritalStatusSchema = arabicEnum(MARITAL_STATUS, 'الحالة الاجتماعية مطلوبة');
export type MaritalStatus = z.infer<typeof maritalStatusSchema>;

/**
 * How the person registering relates to the property — الشاغل, with a ل.
 *
 * It classifies the *person*, never the building; `UNIT_STATUS` below is the
 * one that describes the building, and the two are one Arabic dot apart on a
 * phone screen. They are kept in different controls, in different parts of the
 * card, and neither is ever rendered as the bare word.
 *
 * `FREE_OCCUPANT` — «شاغل بتسامح» — is the third case Lebanese practice has
 * always had and this register could not write down: a son in his father's
 * flat, a caretaker in the owner's ground floor, a family in a relative's
 * empty house. No بدل is paid, so they are not a مستأجر; no deed names them,
 * so they are not a مالك. Recording them as a tenant (the only prior option)
 * puts a tenancy in the register that does not exist, which is wrong in law
 * and quietly corrupts every count of how much of the town is rented.
 *
 * What they share with a tenant is the part that matters to the municipality:
 * they are the شاغل, so the القيمة التأجيرية and رسم النظافة fall on them,
 * and the owner still has to be named. What differs is that there is no عقد
 * إيجار to attach and often no phone number for a relative abroad — see
 * `occupancyBranch` in `property.schema.ts`, which requires the name and not
 * the number.
 */
export const OCCUPANCY_TYPE = ['OWNER', 'TENANT', 'FREE_OCCUPANT'] as const;
export const occupancyTypeSchema = arabicEnum(OCCUPANCY_TYPE, 'نوع الإشغال مطلوب');
export type OccupancyType = z.infer<typeof occupancyTypeSchema>;

/** Every occupancy that is not the owner, and so names someone else's property. */
export const NON_OWNER_OCCUPANCY = ['TENANT', 'FREE_OCCUPANT'] as const;

/**
 * حالة الوحدة — شاغرة, with an ر. A statement about the *unit*.
 *
 * Only an owner is ever asked. A مستأجر or a شاغل بتسامح **is** the occupant
 * of the unit they are filing, so asking them whether it is empty is a
 * contradiction the form does not pose — see `PropertyCard`.
 *
 * `RENTED` is the value that earns this enum its place, and it is not the one
 * anybody asks for first. A مبنى of ten flats is filed once by its owner, and
 * each tenant files their own card for the flat they live in — so the same
 * apartment is in the register twice, under two citizens, by design (ownership
 * and occupancy are different facts about it). Under a `PER_UNIT` notice that
 * is two charges for one flat unless something says which of the two rows is
 * the tenancy. This is that something.
 *
 * `VACANT` and `UNDER_CONSTRUCTION` are the two ways a unit has no شاغل at
 * all, which is what رسم الإشغال and رسم النظافة are levied on. They are kept
 * apart rather than folded into one «فارغة» because they are exempt for
 * different reasons and a municipality may well treat them differently — a
 * finished flat between tenants is not a shell with no roof on it.
 */
export const UNIT_STATUS = [
  'OWNER_OCCUPIED',
  'RENTED',
  'VACANT',
  'UNDER_CONSTRUCTION',
] as const;
export const unitStatusSchema = arabicEnum(UNIT_STATUS, 'حالة الوحدة غير صالحة');
export type UnitStatus = z.infer<typeof unitStatusSchema>;

/**
 * The statuses that mean nobody is in there.
 *
 * One set covering both, because every rule written against vacancy so far
 * wants both: a fee on الإشغال is not owed by an empty flat *or* by an
 * unfinished one. Kept as a named export rather than inlined at each call
 * site so that adding a fourth unoccupied state later is one edit and not a
 * search for `=== 'VACANT'`.
 */
export const UNOCCUPIED_UNIT_STATUS = ['VACANT', 'UNDER_CONSTRUCTION'] as const;

/**
 * Whether this unit has no occupant — and, crucially, **false for null**.
 *
 * A unit whose status was never recorded is not thereby empty; it is a unit
 * nobody was asked about. Reading the absence as vacancy would exempt every
 * row written before this field existed and every row an officer skipped,
 * which is silent under-collection of exactly the kind `isUnsurveyed` exists
 * to refuse. The unmarked unit is billed, and a resident who is owed the
 * exemption comes and says so — an error someone can see and correct.
 */
export function isUnoccupied(status: string | null | undefined): boolean {
  return status != null && (UNOCCUPIED_UNIT_STATUS as readonly string[]).includes(status);
}

export const PROPERTY_TYPE = ['BUILDING', 'HOUSE', 'LAND', 'TENT'] as const;
export const propertyTypeSchema = arabicEnum(PROPERTY_TYPE, 'نوع العقار مطلوب');
export type PropertyType = z.infer<typeof propertyTypeSchema>;

/**
 * What one unit inside a parcel actually is.
 *
 * Wider than the original three (شقة/عيادة/محل) because the list stopped being
 * only a description the moment fees could be assessed per unit: a rate table
 * can only distinguish what this enum distinguishes, so a محل and a مستودع
 * being the same value here means the municipality cannot charge them
 * differently even if its own schedule of fees does.
 *
 * `INDEPENDENT_HOUSE` is the one that looks redundant next to the `HOUSE`
 * property type and is not. `HOUSE` describes a whole card — a dwelling that is
 * the only thing on its parcel. This describes one standalone dwelling among
 * several structures sharing a parcel, which is exactly the case this taxonomy
 * could not express before.
 */
export const UNIT_TYPE = [
  'APARTMENT',
  'INDEPENDENT_HOUSE',
  'CLINIC',
  'OFFICE',
  'SHOP',
  'WAREHOUSE',
] as const;
export const unitTypeSchema = arabicEnum(UNIT_TYPE, 'نوع الوحدة مطلوب');
export type UnitType = z.infer<typeof unitTypeSchema>;

export const LAND_TYPE = ['AGRICULTURAL', 'INDUSTRIAL'] as const;
export const landTypeSchema = arabicEnum(LAND_TYPE, 'نوع الأرض مطلوب');
export type LandType = z.infer<typeof landTypeSchema>;

/*
 * `REPORT_STATUS` / `reportStatusSchema` / `ReportStatus` were here.
 *
 * The review workflow they described — قيد الانتظار → قيد المراجعة → تم
 * التحقق → مقبول, with مرفوض and a correction round-trip — existed because
 * citizens filed their own طلبات and the municipality had to adjudicate them.
 * Records are now entered by staff directly, so there is nothing to
 * adjudicate: a row exists because a clerk put it there, which is the same
 * thing "مقبول" used to mean.
 *
 * The `ReportStatus` enum and the `registrations.status` column still exist in
 * the tenant schema, defaulted and unread — dropping them is a separate,
 * irreversible migration across every municipality's schema.
 */

export const STAFF_ROLE = [
  'SUPER_ADMIN',
  'AUDITOR',
  'FIELD_INSPECTOR',
  'COLLECTOR',
  'ACCOUNTANT',
  'ADMINISTRATIVE_OFFICER',
] as const;
export const staffRoleSchema = arabicEnum(STAFF_ROLE, 'الصلاحية غير صالحة');
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const DOCUMENT_TYPE = [
  'IDENTITY',
  'OWNERSHIP_PROOF',
  'RENTAL_CONTRACT',
  'RESIDENCY_PROOF',
  'EXTRA_PHOTO',
] as const;
export const documentTypeSchema = arabicEnum(DOCUMENT_TYPE, 'نوع المستند غير صالح');
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const BLOOD_TYPE = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
] as const;
export const bloodTypeSchema = arabicEnum(BLOOD_TYPE, 'فئة الدم مطلوبة');
export type BloodType = z.infer<typeof bloodTypeSchema>;
