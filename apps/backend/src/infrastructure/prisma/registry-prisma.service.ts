import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient as RegistryPrismaClient } from '../../generated/registry-client';

/**
 * The single client for the shared `public` schema, which holds only the tenant
 * registry — no citizen data. Kept as its own generated client so the type
 * system will not let a registry query run against a tenant schema, or the
 * reverse.
 */
@Injectable()
export class RegistryPrismaService
  extends RegistryPrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
