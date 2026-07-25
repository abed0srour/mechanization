import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  TenantMismatchError,
  TenantNotProvisionedError,
  UnauthorizedError,
  ValidationError,
} from '../../application/common/exceptions';

const STATUS_BY_ERROR: Array<[new (...args: never[]) => DomainError, HttpStatus]> = [
  [NotFoundError, HttpStatus.NOT_FOUND],
  [ConflictError, HttpStatus.CONFLICT],
  [ValidationError, HttpStatus.UNPROCESSABLE_ENTITY],
  [UnauthorizedError, HttpStatus.UNAUTHORIZED],
  [TenantMismatchError, HttpStatus.FORBIDDEN],
  [TenantNotProvisionedError, HttpStatus.SERVICE_UNAVAILABLE],
  [ForbiddenError, HttpStatus.FORBIDDEN],
];

/**
 * The one place errors become HTTP.
 *
 * Controllers contain no try/catch at all — that is deliberate. Scattering
 * error handling across handlers is how response shapes silently drift apart,
 * and how an internal message eventually reaches a citizen's screen.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const correlationId = request.correlationId;

    const { status, body } = this.describe(exception, correlationId);

    if (status >= 500) {
      // Full detail to the logs, never to the client.
      this.logger.error(
        `[${correlationId}] ${request.method} ${request.originalUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `[${correlationId}] ${request.method} ${request.originalUrl} → ${status}: ${body.message}`,
      );
    }

    response.status(status).json(body);
  }

  private describe(
    exception: unknown,
    correlationId?: string,
  ): { status: HttpStatus; body: Record<string, unknown> } {
    if (exception instanceof DomainError) {
      const match = STATUS_BY_ERROR.find(([type]) => exception instanceof type);
      const status = match?.[1] ?? HttpStatus.BAD_REQUEST;

      return {
        status,
        body: {
          code: exception.code,
          message: exception.message,
          ...(exception instanceof ValidationError && exception.details
            ? { details: exception.details }
            : {}),
          correlationId,
        },
      };
    }

    // Nest's own exceptions (404 on an unmatched route, payload-too-large from
    // the body parser) still need a consistent shape.
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      return {
        status: exception.getStatus(),
        body: {
          code: 'HTTP_ERROR',
          message:
            typeof payload === 'string'
              ? payload
              : ((payload as { message?: string }).message ?? exception.message),
          correlationId,
        },
      };
    }

    /**
     * Anything unrecognised is a bug. The client gets a generic message and the
     * correlation id — enough for a citizen to quote to the municipality, and
     * nothing about the database, the stack, or which table failed.
     */
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً أو مراجعة البلدية.',
        correlationId,
      },
    };
  }
}
