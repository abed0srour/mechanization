import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Validates a request body against a Zod schema shared with the frontend, so a
 * field can never be optional in the form and required on the server.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Some fields need correcting',
          fields: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      throw error;
    }
  }
}

export const zodBody = (schema: ZodSchema) => new ZodValidationPipe(schema);
