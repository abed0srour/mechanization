import { z } from 'zod';
import { landTypeSchema, unitTypeSchema } from './enums';
import { arabicOrLatinName, lebanesePhone } from './primitives';

/**
 * Steps 3–4 — a single repeatable "property card".
 *
 * Two independent conditional axes are modelled as discriminated unions so that
 * impossible combinations are unrepresentable rather than merely discouraged:
 *
 *   occupancy   OWNER  -> no landlord block
 *               TENANT -> landlord name + phone required
 *
 *   propertyType BUILDING -> unitType + buildingName + floor + side + area + sharedRights
 *                HOUSE    -> buildingName + side + area + sharedRights (no floor/unitType)
 *                LAND     -> landType + area only
 *                TENT     -> location description only
 */

const occupancyBranch = z.discriminatedUnion('occupancyType', [
  z.object({ occupancyType: z.literal('OWNER') }),
  z.object({
    occupancyType: z.literal('TENANT'),
    landlordName: arabicOrLatinName,
    landlordPhone: lebanesePhone,
  }),
]);

const sharedRightsField = z.array(z.string().trim().min(1)).max(20).default([]);
const areaField = z.coerce.number().positive('المساحة يجب أن تكون أكبر من صفر').max(1_000_000);
const propertyNumberField = z.string().trim().min(1, 'رقم العقار مطلوب').max(40);

const propertyBranch = z.discriminatedUnion('propertyType', [
  z.object({
    propertyType: z.literal('BUILDING'),
    propertyNumber: propertyNumberField,
    unitType: unitTypeSchema,
    buildingName: z.string().trim().min(1, 'اسم المبنى مطلوب').max(120),
    floor: z.string().trim().min(1, 'الطابق مطلوب').max(20),
    side: z.string().trim().max(60).optional(),
    unitArea: areaField,
    sharedRights: sharedRightsField,
  }),
  z.object({
    propertyType: z.literal('HOUSE'),
    propertyNumber: propertyNumberField,
    buildingName: z.string().trim().min(1, 'اسم المبنى/المنزل مطلوب').max(120),
    side: z.string().trim().max(60).optional(),
    unitArea: areaField,
    sharedRights: sharedRightsField,
  }),
  z.object({
    propertyType: z.literal('LAND'),
    propertyNumber: propertyNumberField,
    landType: landTypeSchema,
    unitArea: areaField,
  }),
  z.object({
    propertyType: z.literal('TENT'),
    propertyNumber: propertyNumberField,
    tentLocation: z.string().trim().min(3, 'موقع الخيمة مطلوب').max(200),
  }),
]);

export const propertyEntrySchema = z.intersection(occupancyBranch, propertyBranch);
export type PropertyEntry = z.infer<typeof propertyEntrySchema>;

/** At least one property; the soft ceiling catches accidental repeat taps. */
export const propertyEntriesSchema = z
  .array(propertyEntrySchema)
  .min(1, 'يجب تسجيل عقار واحد على الأقل')
  .max(25, 'عدد العقارات كبير جداً — يرجى مراجعة البلدية');

/**
 * Which fields a given property type renders. The UI reads this instead of
 * re-implementing the branch logic, so the form and the validator cannot drift.
 */
export const PROPERTY_FIELD_MAP = {
  BUILDING: ['propertyNumber', 'unitType', 'buildingName', 'floor', 'side', 'unitArea', 'sharedRights'],
  HOUSE: ['propertyNumber', 'buildingName', 'side', 'unitArea', 'sharedRights'],
  LAND: ['propertyNumber', 'landType', 'unitArea'],
  TENT: ['propertyNumber', 'tentLocation'],
} as const satisfies Record<string, readonly string[]>;

/**
 * صفة الإقامة only *suggests* a property type — a refugee may still own an
 * apartment, so this is a changeable default and never a gate.
 */
export const SUGGESTED_PROPERTY_TYPE: Record<string, 'TENT' | undefined> = {
  REFUGEE: 'TENT',
  DISPLACED: undefined,
  VILLAGE_RESIDENT: undefined,
};
