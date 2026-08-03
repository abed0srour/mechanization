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

export const OCCUPANCY_TYPE = ['OWNER', 'TENANT'] as const;
export const occupancyTypeSchema = arabicEnum(OCCUPANCY_TYPE, 'نوع الإشغال مطلوب');
export type OccupancyType = z.infer<typeof occupancyTypeSchema>;

export const PROPERTY_TYPE = ['BUILDING', 'HOUSE', 'LAND', 'TENT'] as const;
export const propertyTypeSchema = arabicEnum(PROPERTY_TYPE, 'نوع العقار مطلوب');
export type PropertyType = z.infer<typeof propertyTypeSchema>;

export const UNIT_TYPE = ['APARTMENT', 'CLINIC', 'SHOP'] as const;
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

export const STAFF_ROLE = ['SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR'] as const;
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
