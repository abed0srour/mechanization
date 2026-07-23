import { z } from 'zod';

/**
 * Domain enums. Values are stable machine identifiers (never translated);
 * Arabic display labels live in `labels.ts` so the wire format stays language-neutral.
 */

export const GENDER = ['MALE', 'FEMALE'] as const;
export const genderSchema = z.enum(GENDER);
export type Gender = z.infer<typeof genderSchema>;

/** صفة الإقامة — classifies the person, never the property. */
export const RESIDENT_STATUS = ['REFUGEE', 'DISPLACED', 'VILLAGE_RESIDENT'] as const;
export const residentStatusSchema = z.enum(RESIDENT_STATUS);
export type ResidentStatus = z.infer<typeof residentStatusSchema>;

export const IDENTITY_DOC_TYPE = [
  'NATIONAL_ID',
  'FAMILY_RECORD',
  'DRIVER_LICENSE',
  'PASSPORT',
] as const;
export const identityDocTypeSchema = z.enum(IDENTITY_DOC_TYPE);
export type IdentityDocType = z.infer<typeof identityDocTypeSchema>;

export const OCCUPANCY_TYPE = ['OWNER', 'TENANT'] as const;
export const occupancyTypeSchema = z.enum(OCCUPANCY_TYPE);
export type OccupancyType = z.infer<typeof occupancyTypeSchema>;

export const PROPERTY_TYPE = ['BUILDING', 'HOUSE', 'LAND', 'TENT'] as const;
export const propertyTypeSchema = z.enum(PROPERTY_TYPE);
export type PropertyType = z.infer<typeof propertyTypeSchema>;

export const UNIT_TYPE = ['APARTMENT', 'CLINIC', 'SHOP'] as const;
export const unitTypeSchema = z.enum(UNIT_TYPE);
export type UnitType = z.infer<typeof unitTypeSchema>;

export const LAND_TYPE = ['AGRICULTURAL', 'INDUSTRIAL'] as const;
export const landTypeSchema = z.enum(LAND_TYPE);
export type LandType = z.infer<typeof landTypeSchema>;

export const REPORT_STATUS = [
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'APPROVED',
  'REJECTED',
] as const;
export const reportStatusSchema = z.enum(REPORT_STATUS);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const STAFF_ROLE = ['SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR'] as const;
export const staffRoleSchema = z.enum(STAFF_ROLE);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const DOCUMENT_TYPE = [
  'IDENTITY',
  'OWNERSHIP_PROOF',
  'RENTAL_CONTRACT',
  'RESIDENCY_PROOF',
  'EXTRA_PHOTO',
] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPE);
export type DocumentType = z.infer<typeof documentTypeSchema>;
