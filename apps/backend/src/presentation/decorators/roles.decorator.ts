import { SetMetadata } from '@nestjs/common';
import { StaffRole } from '../../domain/entities/user.entity';

export const ROLES_KEY = 'roles';

/** Restricts a route to the listed staff roles. Enforced by RolesGuard. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);
