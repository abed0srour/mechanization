import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PASSWORD_HASHER } from './domain/password-hasher';
import { STAFF_USER_REPOSITORY } from './domain/staff-user.repository';
import { LoginStaffUseCase } from './application/login-staff.use-case';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password.hasher';
import { PrismaStaffUserRepository } from './infrastructure/prisma-staff-user.repository';
import { StaffJwtStrategy, STAFF_JWT } from './infrastructure/staff-jwt.strategy';
import { StaffAuthController } from './presentation/staff-auth.controller';
import { RolesGuard } from './presentation/roles.decorator';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: STAFF_JWT }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '12h' },
    }),
  ],
  controllers: [StaffAuthController],
  providers: [
    { provide: STAFF_USER_REPOSITORY, useClass: PrismaStaffUserRepository },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    LoginStaffUseCase,
    StaffJwtStrategy,
    RolesGuard,
  ],
  exports: [STAFF_USER_REPOSITORY, PASSWORD_HASHER, RolesGuard],
})
export class StaffIdentityModule {}
