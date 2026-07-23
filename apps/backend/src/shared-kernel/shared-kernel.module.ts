import { Global, Module } from '@nestjs/common';
import { PrismaService } from './infrastructure/prisma.service';
import { TenantContextService } from './infrastructure/tenant-context.service';

@Global()
@Module({
  providers: [TenantContextService, PrismaService],
  exports: [TenantContextService, PrismaService],
})
export class SharedKernelModule {}
