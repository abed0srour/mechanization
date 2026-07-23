"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyEntry = void 0;
const errors_1 = require("../../shared-kernel/domain/errors");
/**
 * One property card. The taxonomy rules live here rather than only in Zod so
 * they hold for every entry point — HTTP, seed scripts, future imports from a
 * municipality's existing spreadsheet.
 */
class PropertyEntry {
    props;
    constructor(props) {
        this.props = props;
    }
    static create(props) {
        PropertyEntry.assertOccupancyConsistent(props);
        PropertyEntry.assertTaxonomyConsistent(props);
        return new PropertyEntry(PropertyEntry.normalise(props));
    }
    static assertOccupancyConsistent(props) {
        if (props.occupancyType === 'TENANT') {
            if (!props.landlordName?.trim() || !props.landlordPhone?.trim()) {
                throw new errors_1.ValidationError('A tenant entry requires the landlord name and phone', {
                    propertyNumber: props.propertyNumber,
                });
            }
        }
    }
    static assertTaxonomyConsistent(props) {
        const fail = (message) => new errors_1.ValidationError(message, { propertyNumber: props.propertyNumber });
        switch (props.propertyType) {
            case 'BUILDING':
                if (!props.unitType)
                    throw fail('A building requires a unit type');
                if (!props.buildingName?.trim())
                    throw fail('A building requires a building name');
                if (!props.floor?.trim())
                    throw fail('A building requires a floor');
                if (!props.unitArea || props.unitArea <= 0)
                    throw fail('A building requires an area');
                break;
            case 'HOUSE':
                if (!props.buildingName?.trim())
                    throw fail('A house requires a name or description');
                if (!props.unitArea || props.unitArea <= 0)
                    throw fail('A house requires an area');
                if (props.floor)
                    throw fail('A standalone house cannot have a floor');
                if (props.unitType)
                    throw fail('A standalone house cannot have a unit type');
                break;
            case 'LAND':
                if (!props.landType)
                    throw fail('Land requires a land type');
                if (!props.unitArea || props.unitArea <= 0)
                    throw fail('Land requires an area');
                if (props.floor || props.unitType || props.buildingName) {
                    throw fail('Land cannot carry building details');
                }
                break;
            case 'TENT':
                if (!props.tentLocation?.trim())
                    throw fail('A tent requires a location description');
                if (props.floor || props.unitType || props.buildingName) {
                    throw fail('A tent cannot carry building details');
                }
                break;
        }
    }
    /** Strips fields that do not belong to the chosen branch. */
    static normalise(props) {
        const isBuilding = props.propertyType === 'BUILDING';
        const hasStructure = isBuilding || props.propertyType === 'HOUSE';
        const isTenant = props.occupancyType === 'TENANT';
        return {
            ...props,
            landlordName: isTenant ? props.landlordName?.trim() : null,
            landlordPhone: isTenant ? props.landlordPhone?.trim() : null,
            unitType: isBuilding ? props.unitType ?? null : null,
            landType: props.propertyType === 'LAND' ? props.landType ?? null : null,
            buildingName: hasStructure ? props.buildingName?.trim() ?? null : null,
            floor: isBuilding ? props.floor?.trim() ?? null : null,
            side: hasStructure ? props.side?.trim() ?? null : null,
            tentLocation: props.propertyType === 'TENT' ? props.tentLocation?.trim() ?? null : null,
            unitArea: props.propertyType === 'TENT' ? null : props.unitArea ?? null,
            sharedRights: hasStructure ? props.sharedRights ?? [] : [],
            propertyNumber: props.propertyNumber.trim(),
        };
    }
    get propertyNumber() {
        return this.props.propertyNumber;
    }
    /** Which document a citizen must attach for this specific card. */
    get requiredProofDocument() {
        return this.props.occupancyType === 'TENANT' ? 'RENTAL_CONTRACT' : 'OWNERSHIP_PROOF';
    }
}
exports.PropertyEntry = PropertyEntry;
