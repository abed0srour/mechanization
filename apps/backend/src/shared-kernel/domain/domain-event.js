"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainEvent = void 0;
/** Base for anything the audit trail listens to. Pure data, no framework. */
class DomainEvent {
    tenantId;
    occurredAt = new Date();
    constructor(tenantId) {
        this.tenantId = tenantId;
    }
}
exports.DomainEvent = DomainEvent;
