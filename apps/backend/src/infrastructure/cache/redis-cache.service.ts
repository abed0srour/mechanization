import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Thin read-through cache wrapper. `REDIS_URL` is optional (see env.schema.ts):
 * unset, every call is a no-op miss and reads fall straight through to
 * Postgres, so a dev environment without Redis still runs correctly — it just
 * does not get the cached fast path.
 *
 * Every method swallows its own errors rather than throwing: a cache is an
 * optimisation, and a Redis outage must degrade to "as fast as before", never
 * to "the dashboard is down".
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not set — dashboard caching disabled, reads go straight to Postgres');
      this.client = null;
      return;
    }

    this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.client.on('error', (error) => this.logger.error(`Redis error: ${error.message}`));
    this.client.connect().catch((error: Error) => {
      this.logger.error(`Redis connection failed: ${error.message}`);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`GET ${key} failed: ${(error as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`SET ${key} failed: ${(error as Error).message}`);
    }
  }

  /** Invalidates every key under a tenant's namespace — used when a write makes
   * cached dashboard projections stale, rather than tracking individual keys. */
  async invalidatePrefix(prefix: string): Promise<void> {
    if (!this.client) return;
    try {
      const keys = await this.client.keys(`${prefix}*`);
      if (keys.length > 0) await this.client.del(...keys);
    } catch (error) {
      this.logger.warn(`Invalidate ${prefix}* failed: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
