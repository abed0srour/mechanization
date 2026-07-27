import { ValidationError } from '../errors/domain-error';

export type OccupancyType = 'OWNER' | 'TENANT';
export type PropertyType = 'BUILDING' | 'HOUSE' | 'LAND' | 'TENT';
export type UnitType = 'APARTMENT' | 'CLINIC' | 'SHOP';
export type LandType = 'AGRICULTURAL' | 'INDUSTRIAL';

/**
 * One unit inside a building. A citizen who owns the whole building files a
 * single عقار carrying several of these — the parcel has one رقم العقار, and
 * that number is unique, so the units cannot each be their own entry.
 */
export interface BuildingUnitProps {
  unitType: UnitType;
  floor: string;
  side?: string | null;
  unitArea: number;
  sharedRights?: string[];
}

export interface PropertyEntryProps {
  occupancyType: OccupancyType;
  landlordName?: string | null;
  landlordPhone?: string | null;
  propertyType: PropertyType;
  /** الحي — common to every property type; free text, unlike رقم العقار there is nothing to check it against. */
  neighborhood: string;
  propertyNumber: string;
  unitType?: UnitType | null;
  landType?: LandType | null;
  buildingName?: string | null;
  floor?: string | null;
  side?: string | null;
  tentLocation?: string | null;
  unitArea?: number | null;
  sharedRights?: string[];
  /** BUILDING only — every other type describes its single unit inline. */
  units?: BuildingUnitProps[];
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * One property card. The taxonomy rules live here rather than only in Zod so
 * they hold for every entry point — HTTP, seed scripts, and the spreadsheet
 * import a municipality will inevitably ask for.
 */
export class PropertyEntry {
  private constructor(readonly props: Readonly<PropertyEntryProps>) {}

  static create(props: PropertyEntryProps): PropertyEntry {
    PropertyEntry.assertOccupancyConsistent(props);
    PropertyEntry.assertTaxonomyConsistent(props);
    PropertyEntry.assertCoordinatesPlausible(props);
    return new PropertyEntry(PropertyEntry.normalise(props));
  }

  /** Rebuilds from a persisted row without re-running creation validation. */
  static rehydrate(props: PropertyEntryProps): PropertyEntry {
    return new PropertyEntry(props);
  }

  private static assertOccupancyConsistent(props: PropertyEntryProps): void {
    if (props.occupancyType === 'TENANT') {
      if (!props.landlordName?.trim() || !props.landlordPhone?.trim()) {
        throw new ValidationError('A tenant entry requires the landlord name and phone', {
          propertyNumber: props.propertyNumber,
        });
      }
    }
  }

  private static assertTaxonomyConsistent(props: PropertyEntryProps): void {
    const fail = (message: string) =>
      new ValidationError(message, { propertyNumber: props.propertyNumber });

    // Common to every type, checked once here rather than duplicated in each
    // branch below.
    if (!props.neighborhood?.trim()) throw fail('Every property requires a neighbourhood');

    // Only a building is divisible into units; anything else with a `units`
    // array is a caller that has confused the two shapes.
    if (props.propertyType !== 'BUILDING' && (props.units?.length ?? 0) > 0) {
      throw fail(`A ${props.propertyType.toLowerCase()} cannot be divided into units`);
    }

    switch (props.propertyType) {
      case 'BUILDING': {
        if (!props.buildingName?.trim()) throw fail('A building requires a building name');

        // The units carry نوع الوحدة / الطابق / المساحة now, so a building with
        // none of them describes nothing at all.
        const units = props.units ?? [];
        if (units.length === 0) throw fail('A building requires at least one unit');

        units.forEach((unit, index) => {
          const where = `unit ${index + 1}`;
          if (!unit.unitType) throw fail(`${where} requires a unit type`);
          if (!unit.floor?.trim()) throw fail(`${where} requires a floor`);
          if (!unit.unitArea || unit.unitArea <= 0) throw fail(`${where} requires an area`);
        });
        break;
      }
      case 'HOUSE':
        if (!props.buildingName?.trim()) throw fail('A house requires a name or description');
        if (!props.unitArea || props.unitArea <= 0) throw fail('A house requires an area');
        if (props.floor) throw fail('A standalone house cannot have a floor');
        if (props.unitType) throw fail('A standalone house cannot have a unit type');
        break;
      case 'LAND':
        if (!props.landType) throw fail('Land requires a land type');
        if (!props.unitArea || props.unitArea <= 0) throw fail('Land requires an area');
        if (props.floor || props.unitType || props.buildingName) {
          throw fail('Land cannot carry building details');
        }
        break;
      case 'TENT':
        if (!props.tentLocation?.trim()) throw fail('A tent requires a location description');
        if (props.floor || props.unitType || props.buildingName) {
          throw fail('A tent cannot carry building details');
        }
        break;
    }
  }

  /**
   * A pin dropped outside Lebanon is a mis-tap or a spoofed payload, and it
   * would silently distort the admin map's bounds for every other entry.
   */
  private static assertCoordinatesPlausible(props: PropertyEntryProps): void {
    const { latitude, longitude } = props;
    if (latitude == null && longitude == null) return;

    if (latitude == null || longitude == null) {
      throw new ValidationError('A location needs both a latitude and a longitude', {
        propertyNumber: props.propertyNumber,
      });
    }
    if (latitude < 33.0 || latitude > 34.7 || longitude < 35.0 || longitude > 36.7) {
      throw new ValidationError('الموقع خارج حدود لبنان', {
        propertyNumber: props.propertyNumber,
      });
    }
  }

  /** Strips fields that do not belong to the chosen branch. */
  private static normalise(props: PropertyEntryProps): PropertyEntryProps {
    const isBuilding = props.propertyType === 'BUILDING';
    const hasStructure = isBuilding || props.propertyType === 'HOUSE';
    const isTenant = props.occupancyType === 'TENANT';

    return {
      ...props,
      neighborhood: props.neighborhood.trim(),
      landlordName: isTenant ? props.landlordName?.trim() : null,
      landlordPhone: isTenant ? props.landlordPhone?.trim() : null,
      // A building's unit detail lives in `units`; the inline columns describe
      // the single unit that a HOUSE or a LAND is, and stay empty for a building.
      unitType: null,
      landType: props.propertyType === 'LAND' ? (props.landType ?? null) : null,
      buildingName: hasStructure ? (props.buildingName?.trim() ?? null) : null,
      floor: null,
      side: props.propertyType === 'HOUSE' ? (props.side?.trim() ?? null) : null,
      tentLocation: props.propertyType === 'TENT' ? (props.tentLocation?.trim() ?? null) : null,
      unitArea:
        props.propertyType === 'TENT' || isBuilding ? null : (props.unitArea ?? null),
      sharedRights: props.propertyType === 'HOUSE' ? (props.sharedRights ?? []) : [],
      units: isBuilding
        ? (props.units ?? []).map((unit) => ({
            ...unit,
            floor: unit.floor.trim(),
            side: unit.side?.trim() || null,
            sharedRights: unit.sharedRights ?? [],
          }))
        : [],
      propertyNumber: props.propertyNumber.trim(),
    };
  }

  get propertyNumber(): string {
    return this.props.propertyNumber;
  }

  get propertyType(): PropertyType {
    return this.props.propertyType;
  }

  /** Which proof a citizen must attach for this specific card. */
  get requiredProofDocument(): 'OWNERSHIP_PROOF' | 'RENTAL_CONTRACT' {
    return this.props.occupancyType === 'TENANT' ? 'RENTAL_CONTRACT' : 'OWNERSHIP_PROOF';
  }
}
