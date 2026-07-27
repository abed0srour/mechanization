import { z } from 'zod';
import { landTypeSchema, PROPERTY_TYPE, unitTypeSchema, type PropertyType } from './enums';
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
 *   propertyType BUILDING -> buildingName + one-or-more units
 *                HOUSE    -> buildingName + side + area + sharedRights (no floor/unitType)
 *                LAND     -> landType + area only
 *                TENT     -> location description only
 */

/**
 * `errorMap` on both discriminated unions below because Zod's own message for
 * a missing or unrecognised discriminator — "Invalid discriminator value.
 * Expected 'OWNER' | 'TENANT'" — is English and names the wire value, not the
 * Arabic label a citizen chose from a ChoiceCard. One Arabic message covers
 * every way this branch can fail to resolve; it can only fail this way when
 * the choice has not been made yet.
 */
const occupancyBranch = z.discriminatedUnion(
  'occupancyType',
  [
    z.object({ occupancyType: z.literal('OWNER') }),
    z.object({
      occupancyType: z.literal('TENANT'),
      landlordName: arabicOrLatinName,
      landlordPhone: lebanesePhone,
    }),
  ],
  { errorMap: () => ({ message: 'نوع الإشغال مطلوب' }) },
);

const sharedRightsField = z
  .array(z.string().trim().min(1, 'القيمة غير صالحة'))
  .max(20)
  .default([]);

/**
 * `z.coerce.number()` turns a missing/blank input into `NaN` before Zod's own
 * type check ever sees it, so the failure surfaces as `invalid_type` — with
 * `required_error` alone silently never firing (the value is never literally
 * `undefined` by the time Zod inspects it). Both messages are set to the same
 * Arabic text so whichever code path actually triggers, the citizen sees the
 * same thing rather than either message falling back to Zod's English default.
 */
const areaField = z.coerce
  .number({ required_error: 'المساحة مطلوبة', invalid_type_error: 'المساحة يجب أن تكون رقماً' })
  .positive('المساحة يجب أن تكون أكبر من صفر')
  .max(1_000_000);

const propertyNumberField = z
  .string({ required_error: 'رقم العقار مطلوب' })
  .trim()
  .min(1, 'رقم العقار مطلوب')
  .max(40);

/**
 * الحي — common to every property type, unlike رقم العقار it is not checked
 * against anything (the cadastre has no neighbourhood layer), so this is a
 * plain free-text field rather than a lookup.
 */
const neighborhoodField = z
  .string({ required_error: 'الحي مطلوب' })
  .trim()
  .min(1, 'الحي مطلوب')
  .max(80, 'اسم الحي طويل جداً');

/**
 * One unit inside a building — شقة, عيادة or محل.
 *
 * A citizen who owns the whole building registers one عقار containing many of
 * these, rather than one عقار per apartment: the parcel has a single رقم العقار
 * and the cadastre check treats it as taken once, so the units have to hang off
 * the parcel instead of duplicating it.
 */
export const buildingUnitSchema = z.object({
  unitType: unitTypeSchema,
  floor: z.string({ required_error: 'الطابق مطلوب' }).trim().min(1, 'الطابق مطلوب').max(20),
  side: z.string().trim().max(60).optional(),
  unitArea: areaField,
  sharedRights: sharedRightsField,
});

export type BuildingUnit = z.infer<typeof buildingUnitSchema>;

/** A building with more units than this is a data-entry accident, not a landlord. */
export const buildingUnitsSchema = z
  .array(buildingUnitSchema, { required_error: 'يجب إضافة وحدة واحدة على الأقل' })
  .min(1, 'يجب إضافة وحدة واحدة على الأقل')
  .max(60, 'عدد الوحدات كبير جداً — يرجى مراجعة البلدية');

const propertyBranch = z.discriminatedUnion(
  'propertyType',
  [
    z.object({
      propertyType: z.literal('BUILDING'),
      neighborhood: neighborhoodField,
      propertyNumber: propertyNumberField,
      buildingName: z
        .string({ required_error: 'اسم المبنى مطلوب' })
        .trim()
        .min(1, 'اسم المبنى مطلوب')
        .max(120),
      units: buildingUnitsSchema,
    }),
    z.object({
      propertyType: z.literal('HOUSE'),
      neighborhood: neighborhoodField,
      propertyNumber: propertyNumberField,
      buildingName: z
        .string({ required_error: 'اسم المبنى/المنزل مطلوب' })
        .trim()
        .min(1, 'اسم المبنى/المنزل مطلوب')
        .max(120),
      side: z.string().trim().max(60).optional(),
      unitArea: areaField,
      sharedRights: sharedRightsField,
    }),
    z.object({
      propertyType: z.literal('LAND'),
      neighborhood: neighborhoodField,
      propertyNumber: propertyNumberField,
      landType: landTypeSchema,
      unitArea: areaField,
    }),
    z.object({
      propertyType: z.literal('TENT'),
      neighborhood: neighborhoodField,
      propertyNumber: propertyNumberField,
      tentLocation: z
        .string({ required_error: 'موقع الخيمة مطلوب' })
        .trim()
        .min(3, 'موقع الخيمة مطلوب')
        .max(200),
    }),
  ],
  { errorMap: () => ({ message: 'نوع العقار مطلوب' }) },
);

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
  BUILDING: ['neighborhood', 'propertyNumber', 'buildingName', 'units'],
  HOUSE: ['neighborhood', 'propertyNumber', 'buildingName', 'side', 'unitArea', 'sharedRights'],
  LAND: ['neighborhood', 'propertyNumber', 'landType', 'unitArea'],
  TENT: ['neighborhood', 'propertyNumber', 'tentLocation'],
} as const satisfies Record<string, readonly string[]>;

/** The per-unit fields a building's unit editor renders. */
export const BUILDING_UNIT_FIELDS = [
  'unitType',
  'floor',
  'side',
  'unitArea',
  'sharedRights',
] as const;

/**
 * صفة الإقامة only *suggests* a property type — a refugee may still own an
 * apartment, so this is a changeable default and never a gate.
 */
export const SUGGESTED_PROPERTY_TYPE: Record<string, 'TENT' | undefined> = {
  REFUGEE: 'TENT',
  DISPLACED: undefined,
  VILLAGE_RESIDENT: undefined,
};

/**
 * خيمة is offered only to a لاجئ.
 *
 * This is the one direction the rule runs. A refugee still gets every other
 * type — the long-standing point that صفة الإقامة describes the person and not
 * their property is unchanged, and someone who fled with a deed in their pocket
 * can still register the apartment they own. What is excluded is the reverse: a
 * village resident or a displaced person filing a tent, which in practice has
 * only ever been a mis-tap on a four-card chooser.
 */
export function allowedPropertyTypesFor(
  residentStatus: string | undefined,
): readonly PropertyType[] {
  return residentStatus === 'REFUGEE'
    ? PROPERTY_TYPE
    : PROPERTY_TYPE.filter((type) => type !== 'TENT');
}
