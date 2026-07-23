import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { CITIZEN_PROFILE_REPOSITORY } from './domain/citizen-profile.repository';
import { ResolveCitizenSessionUseCase } from './application/resolve-citizen-session.use-case';
import { CitizenJwtStrategy } from './infrastructure/citizen-jwt.strategy';
import { PrismaCitizenProfileRepository } from './infrastructure/prisma-citizen-profile.repository';
import { CitizenAuthController } from './presentation/citizen-auth.controller';

@Module({
  imports: [PassportModule],
  controllers: [CitizenAuthController],
  providers: [
    { provide: CITIZEN_PROFILE_REPOSITORY, useClass: PrismaCitizenProfileRepository },
    ResolveCitizenSessionUseCase,
    CitizenJwtStrategy,
  ],
  exports: [CITIZEN_PROFILE_REPOSITORY],
})
export class CitizenIdentityModule {}
