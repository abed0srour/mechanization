import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  TenantMismatchError,
  UnauthorizedError,
  ValidationError,
} from '../domain/errors';

/** Maps framework-free domain errors onto HTTP without leaking internals. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json(
        typeof body === 'string' ? { message: body } : body,
      );
      return;
    }

    if (exception instanceof DomainError) {
      const status = this.statusFor(exception);
      if (status >= 500) this.logger.error(exception.message, exception.stack);
      response.status(status).json({
        code: exception.code,
        message: exception.message,
        ...(exception instanceof ValidationError && exception.details
          ? { details: exception.details }
          : {}),
      });
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
  }

  private statusFor(error: DomainError): number {
    if (error instanceof NotFoundError) return HttpStatus.NOT_FOUND;
    if (error instanceof ConflictError) return HttpStatus.CONFLICT;
    if (error instanceof ValidationError) return HttpStatus.UNPROCESSABLE_ENTITY;
    if (error instanceof UnauthorizedError) return HttpStatus.UNAUTHORIZED;
    if (error instanceof ForbiddenError || error instanceof TenantMismatchError) {
      return HttpStatus.FORBIDDEN;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
