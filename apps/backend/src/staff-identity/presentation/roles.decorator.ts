import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ForbiddenError } from '../../shared-kernel/domain/errors';
import { StaffJwtPayload } from '../application/login-staff.use-case';
import { StaffRole } from '../domain/staff-user.entity';

export const ROLES_KEY = 'staff_roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as StaffJwtPayload | undefined;

    if (!user || !required.includes(user.role as StaffRole)) {
      throw new ForbiddenError('Your role does not allow this action');
    }
    return true;
  }
}
