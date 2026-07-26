import { Global, Module } from '@nestjs/common';
import {
  AUDIT_REPOSITORY,
  DOCUMENT_REPOSITORY,
  IMAGE_STORAGE_SERVICE,
  OTP_REPOSITORY,
  PARCEL_REPOSITORY,
  PASSWORD_HASHER,
  REGISTRATION_REPOSITORY,
  SMS_SENDER,
  TENANT_REPOSITORY,
  TOTP_SERVICE,
  USER_REPOSITORY,
} from '../domain/interfaces/base-repository.interface';
import { RedisCacheService } from './cache/redis-cache.service';
import { TenantContextService } from './context/tenant-context.service';
import { RegistryPrismaService } from './prisma/registry-prisma.service';
import { TenantPrismaFactory } from './prisma/tenant-prisma.factory';
import { PrismaAuditRepository } from './repositories/audit.repository';
import { PrismaDocumentRepository } from './repositories/document.repository';
import { PrismaOtpRepository } from './repositories/otp.repository';
import { PrismaParcelRepository } from './repositories/parcel.repository';
import { PrismaRegistrationRepository } from './repositories/registration.repository';
import { PrismaTenantRepository } from './repositories/tenant.repository';
import { PrismaUserRepository } from './repositories/user.repository';
import { BcryptPasswordHasher } from './security/bcrypt-password.hasher';
import { OtplibTotpService } from './security/totp.service';
import { SmsProviderService } from './sms/sms-provider.service';
import { SupabaseStorageService } from './supabase/storage/supabase-storage.service';

/**
 * Binds every domain port to its concrete adapter. This is the only module that
 * knows Prisma, Supabase or bcrypt exist — the application layer sees symbols.
 *
 * Global because the tenant context and Prisma clients are genuinely
 * cross-cutting: every feature module would otherwise re-import the same set.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    RegistryPrismaService,
    TenantPrismaFactory,
    RedisCacheService,

    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: REGISTRATION_REPOSITORY, useClass: PrismaRegistrationRepository },
    { provide: PARCEL_REPOSITORY, useClass: PrismaParcelRepository },
    { provide: DOCUMENT_REPOSITORY, useClass: PrismaDocumentRepository },
    { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
    { provide: OTP_REPOSITORY, useClass: PrismaOtpRepository },

    { provide: IMAGE_STORAGE_SERVICE, useClass: SupabaseStorageService },
    { provide: SMS_SENDER, useClass: SmsProviderService },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    { provide: TOTP_SERVICE, useClass: OtplibTotpService },
  ],
  exports: [
    TenantContextService,
    RegistryPrismaService,
    TenantPrismaFactory,
    RedisCacheService,
    TENANT_REPOSITORY,
    USER_REPOSITORY,
    REGISTRATION_REPOSITORY,
    PARCEL_REPOSITORY,
    DOCUMENT_REPOSITORY,
    AUDIT_REPOSITORY,
    OTP_REPOSITORY,
    IMAGE_STORAGE_SERVICE,
    SMS_SENDER,
    PASSWORD_HASHER,
    TOTP_SERVICE,
  ],
})
export class InfrastructureModule {}
