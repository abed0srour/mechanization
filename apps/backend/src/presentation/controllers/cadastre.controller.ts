import { Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CadastreImportService } from '../../application/features/cadastre/cadastre-import.service';
import { ValidationError } from '../../application/common/exceptions';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { SessionClaims } from '../../application/features/identity/identity.service';
import { APP_CONFIG } from '../config/app.config';

@Controller('t/:tenantSlug/cadastre')
export class CadastreController {
  constructor(private readonly cadastreImport: CadastreImportService) {}

  /**
   * SUPER_ADMIN only: this rebuilds the parcel registry every citizen
   * submission validates against and overwrites the map's cartography layer —
   * a mistaken upload here affects every registration the municipality takes
   * afterward, not just one record.
   */
  @Roles('SUPER_ADMIN')
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: APP_CONFIG.cadastre.maxFileSizeBytes } }),
  )
  async import(
    @Param('tenantSlug') tenantSlug: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: SessionClaims,
  ) {
    if (!file) {
      throw new ValidationError('لم يتم إرفاق ملف GeoJSON');
    }

    return this.cadastreImport.importGeoJson({
      tenantSlug,
      buffer: file.buffer,
      actor: { id: user.sub, role: user.role ?? '' },
    });
  }
}
