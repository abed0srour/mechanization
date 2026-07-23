/**
 * Domain errors are framework-free. The presentation layer maps them to HTTP
 * status codes, so the domain never imports NestJS.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(entity: string, id?: string) {
    super(id ? `${entity} '${id}' was not found` : `${entity} was not found`);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(message: string, readonly details?: unknown) {
    super(message);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
}

/** Raised when a request would cross a tenant boundary. Never leak details. */
export class TenantMismatchError extends DomainError {
  readonly code = 'TENANT_MISMATCH';
  constructor() {
    super('Request does not belong to this municipality');
  }
}
