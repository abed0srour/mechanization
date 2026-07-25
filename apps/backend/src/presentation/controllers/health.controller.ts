import { Controller, Get } from '@nestjs/common';
import { RegistryPrismaService } from '../../infrastructure/prisma/registry-prisma.service';
import { Public } from '../decorators/public.decorator';

/**
 * Platform-level, deliberately outside the `/t/:tenantSlug` prefix — it must
 * answer before any municipality is resolved, so a load balancer can tell the
 * process is alive even if the registry is unreachable.
 */
@Controller()
export class HealthController {
  constructor(private readonly registry: RegistryPrismaService) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('health/ready')
  async ready() {
    try {
      await this.registry.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      // No error detail: readiness probes are often reachable from further
      // afield than the rest of the API.
      return { status: 'degraded' };
    }
  }
}
