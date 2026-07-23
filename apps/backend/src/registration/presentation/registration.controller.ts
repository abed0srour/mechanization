import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  changeStatusSchema,
  submitRegistrationSchema,
} from '@mechanization/shared-schemas';
import { ValidationError } from '../../shared-kernel/domain/errors';
import { zodBody } from '../../shared-kernel/presentation/zod-validation.pipe';
import { CurrentStaff } from '../../staff-identity/presentation/current-staff.decorator';
import { Roles } from '../../staff-identity/presentation/roles.decorator';
import { RolesGuard } from '../../staff-identity/presentation/roles.decorator';
import { StaffAuthGuard } from '../../staff-identity/presentation/staff-auth.guard';
import type { StaffJwtPayload } from '../../staff-identity/application/login-staff.use-case';
import { ChangeRegistrationStatusUseCase } from '../application/change-registration-status.use-case';
import { CheckPropertyNumberUseCase } from '../application/check-property-number.use-case';
import { SubmitRegistrationUseCase } from '../application/submit-registration.use-case';

@Controller('t/:tenantSlug/registrations')
export class RegistrationController {
  constructor(
    private readonly submitRegistration: SubmitRegistrationUseCase,
    private readonly checkPropertyNumber: CheckPropertyNumberUseCase,
    private readonly changeStatus: ChangeRegistrationStatusUseCase,
  ) {}

  /**
   * The wizard's single submit: one multipart request carrying the JSON payload
   * plus every file, so a dropped connection cannot leave a citizen half
   * registered across several calls.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('multipart')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 30 } }))
  async submit(
    @Req() req: Request,
    @Body('payload') rawPayload: string,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    if (!rawPayload) {
      throw new ValidationError('The submission payload is missing');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new ValidationError('The submission payload is not valid JSON');
    }

    const payload = submitRegistrationSchema.parse(parsed);

    const result = await this.submitRegistration.execute({
      tenantSlug: req.tenant!.slug,
      tenantId: req.tenant!.id,
      payload,
    });

    // Files are handed to the documents context once the registration exists,
    // so an upload can never reference a registration that was rolled back.
    return { ...result, receivedFiles: files.length };
  }

  /** Blur-check while the citizen types رقم العقار. */
  @Get('property-number/availability')
  async availability(@Req() req: Request, @Query('number') number: string) {
    return this.checkPropertyNumber.execute(req.tenant!.id, number ?? '');
  }

  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR')
  @Patch(':id/status')
  async patchStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(zodBody(changeStatusSchema)) body: { status: string; reason?: string },
    @CurrentStaff() staff: StaffJwtPayload,
  ) {
    return this.changeStatus.execute({
      tenantId: req.tenant!.id,
      registrationId: id,
      status: body.status as never,
      reason: body.reason,
      staff: { id: staff.sub, email: staff.email, role: staff.role },
    });
  }
}
