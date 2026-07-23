"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registration = void 0;
const errors_1 = require("../../shared-kernel/domain/errors");
/** Server-enforced lifecycle. REJECTED is reachable from any non-terminal state. */
const ALLOWED_TRANSITIONS = {
    PENDING: ['UNDER_REVIEW', 'REJECTED'],
    UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
    VERIFIED: ['APPROVED', 'REJECTED'],
    APPROVED: [],
    REJECTED: [],
};
class Registration {
    id;
    tenantId;
    citizenId;
    referenceNumber;
    _status;
    properties;
    constructor(id, tenantId, citizenId, referenceNumber, _status, properties) {
        this.id = id;
        this.tenantId = tenantId;
        this.citizenId = citizenId;
        this.referenceNumber = referenceNumber;
        this._status = _status;
        this.properties = properties;
    }
    static create(props) {
        if (props.properties.length === 0) {
            throw new errors_1.ValidationError('A registration must include at least one property');
        }
        /** Two cards in one submission cannot claim the same رقم العقار. */
        const numbers = props.properties.map((p) => p.propertyNumber);
        const duplicate = numbers.find((n, i) => numbers.indexOf(n) !== i);
        if (duplicate) {
            throw new errors_1.ConflictError(`Property number '${duplicate}' appears more than once`);
        }
        return new Registration(props.id, props.tenantId, props.citizenId, props.referenceNumber, 'PENDING', props.properties);
    }
    static rehydrate(props) {
        return new Registration(props.id, props.tenantId, props.citizenId, props.referenceNumber, props.status, props.properties ?? []);
    }
    get status() {
        return this._status;
    }
    changeStatus(next, reason) {
        const from = this._status;
        if (!ALLOWED_TRANSITIONS[from].includes(next)) {
            throw new errors_1.ConflictError(`Cannot move a report from ${from} to ${next}`);
        }
        if (next === 'REJECTED' && !reason?.trim()) {
            throw new errors_1.ValidationError('A rejection must include a reason');
        }
        this._status = next;
        return { from, to: next };
    }
}
exports.Registration = Registration;
