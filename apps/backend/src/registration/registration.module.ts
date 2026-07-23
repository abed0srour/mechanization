import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { StaffIdentityModule } from '../staff-identity/staff-identity.module';
import { REGISTRATION_REPOSITORY } from './domain/registration.repository';
import { ChangeRegistrationStatusUseCase } from './application/change-registration-status.use-case';
import { CheckPropertyNumberUseCase } from './application/check-property-number.use-case';
import { SubmitRegistrationUseCase } from './application/submit-registration.use-case';
import { PrismaRegistrationRepository } from './infrastructure/prisma-registration.repository';
import { RegistrationController } from './presentation/registration.controller';

@Module({
  imports: [TenantModule, StaffIdentityModule],
  controllers: [RegistrationController],
  providers: [
    { provide: REGISTRATION_REPOSITORY, useClass: PrismaRegistrationRepository },
    SubmitRegistrationUseCase,
    CheckPropertyNumberUseCase,
    ChangeRegistrationStatusUseCase,
  ],
  exports: [REGISTRATION_REPOSITORY],
})
export class RegistrationModule {}
