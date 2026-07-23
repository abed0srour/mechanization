import { Module } from '@nestjs/common';
import { StaffIdentityModule } from '../staff-identity/staff-identity.module';
import { AUDIT_REPOSITORY } from './domain/audit-entry';
import { RecordActionListener } from './application/record-action.listener';
import { PrismaAuditRepository } from './infrastructure/prisma-audit.repository';
import { AuditController } from './presentation/audit.controller';

@Module({
  imports: [StaffIdentityModule],
  controllers: [AuditController],
  providers: [
    { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
    RecordActionListener,
  ],
  exports: [AUDIT_REPOSITORY],
})
export class AuditModule {}
