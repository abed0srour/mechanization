import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TENANT_REPOSITORY } from '../../domain/interfaces/base-repository.interface';
import { TenantRepository } from '../../domain/interfaces/tenant-repository.interface';
import { TenantContextService } from '../../infrastructure/context/tenant-context.service';
import { TenantPrismaFactory } from '../../infrastructure/prisma/tenant-prisma.factory';
import { FeesService } from '../features/fees/fees.service';

/**
 * Re-issues recurring fees for every municipality, once a day.
 *
 * Daily rather than monthly, and that is deliberate: a monthly schedule has to
 * fire on one specific day, and a deploy, restart or outage on that day would
 * silently skip a municipality's entire billing cycle. Running daily makes the
 * job idempotent-by-repetition — the unique (citizen, notice, period) index
 * turns every run after the first in a period into a no-op, so the only cost
 * of running it 30 times a month is 29 cheap queries, and the benefit is that
 * missing a day costs nothing at all.
 *
 * Like every cross-tenant job here, it has no HTTP request behind it and so no
 * tenant scope: it walks the registry and opens one per municipality.
 */
@Injectable()
export class RecurringBillingJob {
  private readonly logger = new Logger(RecurringBillingJob.name);

  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly tenantContext: TenantContextService,
    private readonly clients: TenantPrismaFactory,
    private readonly fees: FeesService,
  ) {}

  /**
   * 02:00 — after midnight so a fee due "on the 1st" is raised on the 1st, and
   * late enough that it is not competing with whatever else runs at exactly
   * midnight.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async issueDueFees(): Promise<void> {
    await this.runForAllTenants();
  }

  /**
   * Shared with the admin "run now" endpoint, so a clerk who has just created
   * a fee does not have to wait until tomorrow to see it applied.
   */
  async runForAllTenants(): Promise<{ tenants: number; invoicesCreated: number }> {
    const tenants = await this.tenants.listActive();
    let invoicesCreated = 0;

    for (const tenant of tenants) {
      const prisma = this.clients.forSchema(tenant.schemaName);

      try {
        const result = await this.tenantContext.run(
          {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            schemaName: tenant.schemaName,
            prisma,
          },
          () => this.fees.runRecurringBilling(),
        );
        invoicesCreated += result.invoicesCreated;
      } catch (error) {
        // One municipality's failure must not stop the rest: a schema mid
        // migration, or a transient pooler timeout, should cost that tenant a
        // day of billing rather than costing every tenant one.
        this.logger.error(
          `Recurring billing failed for '${tenant.slug}': ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    if (invoicesCreated > 0) {
      this.logger.log(
        `Recurring billing raised ${invoicesCreated} invoice(s) across ${tenants.length} municipality(ies)`,
      );
    }

    return { tenants: tenants.length, invoicesCreated };
  }
}
