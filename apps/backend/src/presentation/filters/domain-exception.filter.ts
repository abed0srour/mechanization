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

    // Leads with `error (STATUS): message` so the terminal reads the same way
    // as the frontend's own console output — the request context (method,
    // path, correlationId) trails it rather than burying the message behind
    // an arrow.
    if (status >= 500) {
      // The client only ever gets the generic body message; the log gets the
      // real exception detail (and full stack, never sent to the client).
      const detail = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `error (${status}): ${detail} — ${request.method} ${request.originalUrl} [${correlationId}]`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `error (${status}): ${body.message} — ${request.method} ${request.originalUrl} [${correlationId}]`,
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

    /*
     * A Prisma constraint that reached the filter is a *bug*, not a business
     * rule: every one of these has a service-layer check that should have run
     * first and thrown a `DomainError` naming the actual conflict — which
     * national id, which sector, which worker.
     *
     * They are mapped anyway, because 500 with a correlation id is a worse
     * answer to "this email is taken" than 409 is. But the wording stays
     * deliberately unspecific. An earlier revision phrased P2002 as «يوجد
     * تعارض مع تكليف أو سجل قائم مسبقاً» — a *sector assignment* clash — from a
     * filter that also serves citizen registration, payments and staff
     * accounts, so a duplicate national id told the clerk about a تكليف. A
     * generic sentence is not a good error message; a confidently wrong one is
     * worse.
     *
     * Each is logged at error level with the constraint it hit, because the
     * fix belongs in the service that let it through.
     */
    const prismaCode =
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      typeof (exception as { code: unknown }).code === 'string'
        ? (exception as { code: string }).code
        : null;

    if (prismaCode === 'P2002' || prismaCode === 'P2003' || prismaCode === 'P2025') {
      this.logger.error(
        `Unhandled Prisma ${prismaCode} reached the exception filter (correlationId=${correlationId ?? 'none'}). ` +
          'A service-layer check is missing — this should have been a DomainError.',
        exception instanceof Error ? exception.stack : undefined,
      );

      if (prismaCode === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: 'CONFLICT',
            message: 'هذه البيانات مسجّلة مسبقاً',
            correlationId,
          },
        };
      }
      if (prismaCode === 'P2003') {
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          body: {
            code: 'VALIDATION_ERROR',
            message: 'أحد السجلات المرتبطة بهذه العملية غير موجود',
            correlationId,
          },
        };
      }
      return {
        status: HttpStatus.NOT_FOUND,
        body: {
          code: 'NOT_FOUND',
          message: 'السجل المطلوب غير موجود',
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
