import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContextService } from './tenant-context.service';

/** Tables that are NOT tenant-scoped and are therefore exempt from auto-scoping. */
const GLOBAL_MODELS = new Set<string>(['Tenant']);

/** Operations whose `args.where` we can safely narrow with a tenant filter. */
const SCOPED_READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly tenantContext: TenantContextService) {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `work` inside a transaction that has the Postgres session variable
   * `app.current_tenant_id` set, which is what every RLS policy checks.
   *
   * RLS is the real boundary; the Prisma extension below is a second net that
   * catches developer mistakes earlier and with a clearer error.
   */
  async withTenant<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // set_config with is_local=true scopes the setting to this transaction.
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, true)`;
      return work(tx);
    });
  }

  /**
   * Client scoped to the current request's tenant. Read/aggregate queries get a
   * tenantId filter injected; creates get tenantId stamped on.
   */
  forCurrentTenant() {
    const tenantId = this.tenantContext.tenantId;
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (model && GLOBAL_MODELS.has(model)) return query(args);

            const typedArgs = args as Record<string, unknown>;

            if (SCOPED_READ_OPS.has(operation)) {
              typedArgs.where = { ...(typedArgs.where as object), tenantId };
            } else if (operation === 'create') {
              typedArgs.data = { tenantId, ...(typedArgs.data as object) };
            } else if (operation === 'createMany') {
              const data = typedArgs.data;
              typedArgs.data = Array.isArray(data)
                ? data.map((row) => ({ tenantId, ...(row as object) }))
                : { tenantId, ...(data as object) };
            }

            return query(typedArgs);
          },
        },
      },
    });
  }
}

export type TenantScopedPrisma = ReturnType<PrismaService['forCurrentTenant']>;
