"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantMismatchError = exports.ForbiddenError = exports.UnauthorizedError = exports.ValidationError = exports.ConflictError = exports.NotFoundError = exports.DomainError = void 0;
/**
 * Domain errors are framework-free. The presentation layer maps them to HTTP
 * status codes, so the domain never imports NestJS.
 */
class DomainError extends Error {
    constructor(message) {
        super(message);
        this.name = new.target.name;
    }
}
exports.DomainError = DomainError;
class NotFoundError extends DomainError {
    code = 'NOT_FOUND';
    constructor(entity, id) {
        super(id ? `${entity} '${id}' was not found` : `${entity} was not found`);
    }
}
exports.NotFoundError = NotFoundError;
class ConflictError extends DomainError {
    code = 'CONFLICT';
}
exports.ConflictError = ConflictError;
class ValidationError extends DomainError {
    details;
    code = 'VALIDATION_FAILED';
    constructor(message, details) {
        super(message);
        this.details = details;
    }
}
exports.ValidationError = ValidationError;
class UnauthorizedError extends DomainError {
    code = 'UNAUTHORIZED';
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends DomainError {
    code = 'FORBIDDEN';
}
exports.ForbiddenError = ForbiddenError;
/** Raised when a request would cross a tenant boundary. Never leak details. */
class TenantMismatchError extends DomainError {
    code = 'TENANT_MISMATCH';
    constructor() {
        super('Request does not belong to this municipality');
    }
}
exports.TenantMismatchError = TenantMismatchError;
