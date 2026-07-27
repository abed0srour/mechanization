import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { OtpCleanupJob } from './background-jobs/otp-cleanup.job';
import { AuditService } from './features/audit/audit.service';
import { CadastreImportService } from './features/cadastre/cadastre-import.service';
import { DocumentService } from './features/documents/document.service';
import { IdentityService } from './features/identity/identity.service';
import { OtpService } from './features/identity/otp.service';
import { RegistrationService } from './features/registration/registration.service';
import { ReportingService } from './features/reporting/reporting.service';
import { TenantService } from './features/tenant/tenant.service';

/**
 * One service per bounded context — no command/query handler registration, no
 * `CqrsModule`. Adding a use-case is adding a method, not adding two classes and
 * a handler binding.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // One signing key for citizen and staff tokens alike — the unification
        // in Section 10 is what makes a single JwtAuthGuard correct.
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [
    TenantService,
    IdentityService,
    OtpService,
    RegistrationService,
    DocumentService,
    AuditService,
    ReportingService,
    CadastreImportService,
    OtpCleanupJob,
  ],
  exports: [
    TenantService,
    IdentityService,
    OtpService,
    RegistrationService,
    DocumentService,
    AuditService,
    ReportingService,
    CadastreImportService,
    JwtModule,
  ],
})
export class ApplicationModule {}
