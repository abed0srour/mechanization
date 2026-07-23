import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { selectCitizenProfileSchema } from '@mechanization/shared-schemas';
import { zodBody } from '../../shared-kernel/presentation/zod-validation.pipe';
import { ResolveCitizenSessionUseCase } from '../application/resolve-citizen-session.use-case';
import { CITIZEN_JWT, SupabaseJwtPayload } from '../infrastructure/citizen-jwt.strategy';

@Controller('t/:tenantSlug/citizen/auth')
@UseGuards(AuthGuard(CITIZEN_JWT))
export class CitizenAuthController {
  constructor(private readonly resolveSession: ResolveCitizenSessionUseCase) {}

  /**
   * Called straight after Supabase verifies the OTP on the client. Returns the
   * profile(s) registered to that verified phone within this municipality.
   */
  @Get('session')
  async session(@Req() req: Request) {
    const supabaseUser = req.user as SupabaseJwtPayload;
    return this.resolveSession.execute(req.tenant!.id, supabaseUser.phone!);
  }

  /** Used only when one phone serves several household members. */
  @Post('select-profile')
  async selectProfile(
    @Req() req: Request,
    @Body(zodBody(selectCitizenProfileSchema)) body: { citizenId: string },
  ) {
    const supabaseUser = req.user as SupabaseJwtPayload;
    return this.resolveSession.select(req.tenant!.id, body.citizenId, supabaseUser.sub);
  }
}
