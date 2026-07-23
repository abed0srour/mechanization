import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { StaffJwtPayload } from '../application/login-staff.use-case';

export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffJwtPayload =>
    ctx.switchToHttp().getRequest<Request>().user as StaffJwtPayload,
);
