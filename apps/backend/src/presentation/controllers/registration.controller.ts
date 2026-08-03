import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  changeStatusSchema,
  correctionSchema,
  submitRegistrationSchema,
} from '@mechanization/shared-schemas';
import { RegistrationService } from '../../application/features/registration/registration.service';
import { DocumentService } from '../../application/features/documents/document.service';
import { ZodValidationPipe } from '../../application/common/pipes/zod-validation.pipe';
import { ValidationError } from '../../application/common/exceptions';
import { Document } from '../../domain/entities/document.entity';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';
import { APP_CONFIG } from '../config/app.config';

@Controller('t/:tenantSlug/registrations')
export class RegistrationController {
  constructor(
    private readonly registrations: RegistrationService,
    private readonly documents: DocumentService,
  ) {}

  /**
   * The whole wizard in one multipart request: a JSON `payload` part plus the
   * files.
   *
   * Public on purpose — a citizen submits before they have an account, and the
   * reference number returned here is what lets them come back. Forcing login
   * first would put an SMS delivery failure between a citizen and their claim.
   */
  @Public()
  @Post()
  @Throttle({
    default: {
      limit: APP_CONFIG.throttle.submission.limit,
      ttl: APP_CONFIG.throttle.submission.ttlSeconds * 1000,
    },
  })
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: Document.maxBytes,
        files: APP_CONFIG.documents.maxFilesPerSubmission,
      },
    }),
  )
  async submit(
    @Param('tenantSlug') tenantSlug: string,
    @Body('payload') rawPayload: string,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    // The JSON arrives as a string part alongside the binaries, so it is parsed
    // here before the shared schema validates it.
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload ?? '');
    } catch {
      throw new ValidationError('تعذّرت قراءة بيانات النموذج');
    }

    const payload = new ZodValidationPipe(submitRegistrationSchema).transform(parsed);

    const result = await this.registrations.submit({ tenantSlug, payload });

    // Files are attached after the registration transaction commits: the
    // citizen's data is safe even if an upload fails, and they keep the
    // reference number to follow up with.
    const { documentIds } = await this.documents.attachToRegistration({
      tenantSlug,
      citizenId: result.citizenId,
      registrationId: result.registrationId,
      propertyIds: result.propertyIds,
      slots: payload.documentSlots as never,
      files: files.map((file) => ({
        fieldName: file.fieldname,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      })),
    });

    return {
      registrationId: result.registrationId,
      referenceNumber: result.referenceNumber,
      status: result.status,
      propertyCount: result.propertyCount,
      documentCount: documentIds.length,
    };
  }

  /**
   * Live check while the citizen types رقم العقار: is it a real parcel, and
   * how many neighbours are already registered on it.
   *
   * Still on the `/availability` path so an older client keeps working; the
   * response no longer carries an `available` flag, because co-registration
   * on one cadastral number is normal and never refused.
   */
  @Public()
  @Get('property-number/:propertyNumber/availability')
  async checkPropertyNumber(@Param('propertyNumber') propertyNumber: string) {
    return this.registrations.checkPropertyNumber(propertyNumber);
  }

  // ──────────────────────────  Citizen views  ──────────────────────────

  @Get('mine')
  async listMine(@CurrentUser() user: SessionClaims) {
    return { items: await this.registrations.listMine(user.sub) };
  }

  @Get('by-reference/:referenceNumber')
  async getByReference(
    @CurrentUser() user: SessionClaims,
    @Param('referenceNumber') referenceNumber: string,
  ) {
    const registration = await this.registrations.getForCitizen(referenceNumber, user.sub);
    return {
      id: registration.id,
      referenceNumber: registration.referenceNumber,
      status: registration.status,
      propertyCount: registration.properties.length,
    };
  }

  /**
   * The correction form's data: the reviewer's note, the flags, and the
   * current values behind them.
   *
   * Scoped to `user.sub` all the way down into the WHERE clause — this returns
   * identity-document numbers, so "is it mine" is answered by the query rather
   * than by a check the next refactor could drop.
   */
  @Get('mine/:id/correction')
  async getCorrection(@CurrentUser() user: SessionClaims, @Param('id') id: string) {
    return this.registrations.getCorrectionContext(id, user.sub);
  }

  /** Submits those corrections and puts the claim back in the review queue. */
  @Patch('mine/:id/correction')
  async submitCorrection(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(correctionSchema))
    body: {
      personal?: Record<string, unknown>;
      contact?: Record<string, unknown>;
      properties?: Array<{ id: string } & Record<string, unknown>>;
    },
    @CurrentUser() user: SessionClaims,
  ) {
    const transition = await this.registrations.applyCorrection({
      tenantSlug,
      registrationId: id,
      citizenId: user.sub,
      personal: body.personal ?? {},
      contact: body.contact ?? {},
      properties: body.properties ?? [],
    });

    return { registrationId: id, ...transition };
  }

  // ──────────────────────────  Staff views  ──────────────────────────

  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR')
  @Get()
  async listForReview(
    @Query('status') status?: string,
    @Query('limit') limit = '25',
    @Query('offset') offset = '0',
  ) {
    return this.registrations.listForReview({
      status: status as never,
      limit: Math.min(Number(limit) || 25, 100),
      offset: Number(offset) || 0,
    });
  }

  @Roles('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR')
  @Get(':id')
  async getById(@Param('id') id: string) {
    const registration = await this.registrations.getById(id);
    return {
      id: registration.id,
      referenceNumber: registration.referenceNumber,
      status: registration.status,
      allowedNextStatuses: registration.allowedNextStatuses,
      properties: registration.properties.map((property) => property.props),
    };
  }

  /**
   * The transition itself is validated by the aggregate, and APPROVED is
   * additionally restricted to SUPER_ADMIN inside the service — the role list
   * here is the outer gate, not the whole rule.
   */
  @Roles('SUPER_ADMIN', 'FIELD_INSPECTOR')
  @Patch(':id/status')
  async changeStatus(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeStatusSchema))
    body: {
      status: string;
      reason?: string;
      rejectedFields?: string[];
      allowCitizenCorrection?: boolean;
      revisitAt?: string;
    },
    @CurrentUser() user: SessionClaims,
  ) {
    const transition = await this.registrations.changeStatus({
      tenantSlug,
      registrationId: id,
      status: body.status as never,
      reason: body.reason,
      rejectedFields: body.rejectedFields,
      allowCitizenCorrection: body.allowCitizenCorrection,
      revisitAt: body.revisitAt,
      actor: { id: user.sub, role: user.role ?? '' },
    });

    return { registrationId: id, ...transition };
  }
}
