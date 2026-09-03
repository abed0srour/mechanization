/**
 * What a fee can actually be charged against.
 *
 * A citizen's holdings are stored in two shapes, for good reasons that have
 * nothing to do with billing. A مبنى keeps its flats in `building_units`,
 * because a building *is* a list of units and each one has its own floor and
 * area. A منزل, an أرض or a خيمة keeps its single unit flat on the property
 * card itself, because inventing a one-row child table for a plot of land
 * would be ceremony around nothing.
 *
 * Assessment cannot care about that difference. "Six shops" has to mean six
 * whether they are six units in one building, six cards on six parcels, or —
 * now that a parcel may carry several structures — six cards on one. This is
 * the one place that flattening happens, so no rate rule has to know how the
 * register chose to store what it is charging for.
 */

/** The taxonomy values a card may hold; kept loose to avoid importing Prisma enums. */
export interface BillableUnit {
  /** `APARTMENT`, `SHOP`, … or null where the card never recorded one. */
  unitType: string | null;
  /** Square metres, or null when it was never established. */
  unitArea: number | null;
  /**
   * `VACANT`, `RENTED`, … or null where nobody was asked.
   *
   * Carried through the flattening rather than read from the card later,
   * because after this function there is no card — a shop is a shop whether it
   * came from a building's unit row or from a منزل filed on its own parcel,
   * and an exemption that could only see one of those two shapes would exempt
   * a landlord's empty flat and charge the identical empty house next door.
   */
  unitStatus: string | null;
  /** The card this came from, for the invoice's breakdown. */
  propertyType: string;
  propertyNumber: string | null;
}

/** The stored shape this reads — a property card and its unit rows. */
export interface BillablePropertyEntry {
  propertyType: string;
  propertyNumber: string | null;
  unitType: string | null;
  /** Prisma hands Decimal back; a plain number or null is equally acceptable. */
  unitArea: { toString(): string } | number | null;
  unitStatus?: string | null;
  units: ReadonlyArray<{
    unitType: string;
    unitArea: { toString(): string } | number | null;
    unitStatus?: string | null;
  }>;
}

function toNumber(value: { toString(): string } | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether this card is a building nobody has been inside.
 *
 * A مبنى with no unit rows is not a building with nothing in it — it is a
 * building whose units were never surveyed, which is a state the register
 * explicitly supports: an officer who could not get past the caretaker flags
 * «الوحدات غير مجرودة» and files the record anyway.
 *
 * It has to be told apart from a genuine zero, because under a per-unit rate
 * the two produce the same number and opposite meanings. Counted as zero, the
 * largest unsurveyed building in the municipality bills nothing at all — and
 * the fee schedule would be quietly most generous to exactly the properties
 * worth the most. See `assessCitizen`, which refuses to guess.
 */
export function isUnsurveyed(entry: BillablePropertyEntry): boolean {
  return entry.propertyType === 'BUILDING' && entry.units.length === 0;
}

/** Every chargeable unit on one property card, in either storage shape. */
export function billableUnits(entry: BillablePropertyEntry): BillableUnit[] {
  if (entry.units.length > 0) {
    return entry.units.map((unit) => ({
      unitType: unit.unitType,
      unitArea: toNumber(unit.unitArea),
      unitStatus: unit.unitStatus ?? null,
      propertyType: entry.propertyType,
      propertyNumber: entry.propertyNumber,
    }));
  }

  // A building with no rows is unsurveyed, not empty — and must not be handed
  // back as a phantom unit that a rate would happily multiply by.
  if (isUnsurveyed(entry)) return [];

  return [
    {
      unitType: entry.unitType,
      unitArea: toNumber(entry.unitArea),
      unitStatus: entry.unitStatus ?? null,
      propertyType: entry.propertyType,
      propertyNumber: entry.propertyNumber,
    },
  ];
}
