import { Body, Controller, Get, Ip, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { staffLoginSchema } from '@mechanization/shared-schemas';
import { zodBody } from '../../shared-kernel/presentation/zod-validation.pipe';
import { LoginStaffUseCase } from '../application/login-staff.use-case';
import { CurrentStaff } from './current-staff.decorator';
import { StaffAuthGuard } from './staff-auth.guard';
import type { StaffJwtPayload } from '../application/login-staff.use-case';

@Controller('t/:tenantSlug/staff/auth')
export class StaffAuthController {
  constructor(private readonly loginStaff: LoginStaffUseCase) {}

  /** Throttled hard: staff login is the highest-value target on the platform. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body(zodBody(staffLoginSchema)) body: { email: string; password: string },
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.loginStaff.execute({
      tenantId: req.tenant!.id,
      tenantSlug: req.tenant!.slug,
      email: body.email,
      password: body.password,
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /** Lets the dashboard confirm a stored token is still valid on page load. */
  @UseGuards(StaffAuthGuard)
  @Get('me')
  me(@CurrentStaff() staff: StaffJwtPayload) {
    return {
      id: staff.sub,
      email: staff.email,
      role: staff.role,
      tenantId: staff.tenantId,
      tenantSlug: staff.tenantSlug,
    };
  }
}
