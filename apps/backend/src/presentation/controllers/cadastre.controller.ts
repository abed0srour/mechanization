import { existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
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
   * Serves static GeoJSON map layers directly from the backend's configured
   * storage directory. Useful for containerized and Docker deployments where
   * backend and frontend filesystems are separated.
   */
  @Get('assets/:assetName')
  getAsset(
    @Param('tenantSlug') tenantSlug: string,
    @Param('assetName') assetName: string,
    @Res() res: Response,
  ) {
    const allowed = [
      'cadastre.geojson',
      'parcels.geojson',
      'parcel-polygons.geojson',
      'city-boundary.geojson',
    ];
    if (!allowed.includes(assetName)) {
      throw new NotFoundException('Asset not found');
    }

    const filePath = join(APP_CONFIG.cadastre.mapAssetsDir(tenantSlug), assetName);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Asset file not found');
    }

    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    createReadStream(filePath).pipe(res);
  }

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
