import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface MemoryCacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Fast multi-tier cache service:
 * - L1: In-memory Map cache with TTL and prefix invalidation (always active, ~0ms).
 * - L2: Redis (optional, active when `REDIS_URL` is provided).
 *
 * When Redis is unset or offline, L1 in-memory caching ensures that tenant lookups,
 * dashboard metrics, settings, and queries are fast and cached.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis | null;
  private readonly memoryCache = new Map<string, MemoryCacheEntry>();
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.log('REDIS_URL not set — using high-performance in-memory cache');
      this.client = null;
    } else {
      this.client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        enableReadyCheck: false,
        tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      });
      this.client.on('error', (error) => this.logger.error(`Redis error: ${error.message}`));
      this.client.connect().catch((error: Error) => {
        this.logger.error(`Redis connection failed: ${error.message}`);
      });
    }

    // Periodically prune expired items every 60 seconds
    this.pruneTimer = setInterval(() => this.pruneExpired(), 60_000);
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expiresAt <= now) {
        this.memoryCache.delete(key);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const now = Date.now();
    const mem = this.memoryCache.get(key);
    if (mem) {
      if (mem.expiresAt > now) {
        return mem.value as T;
      }
      this.memoryCache.delete(key);
    }

    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as T;
      // Populate L1 memory with remaining TTL (default 30s)
      this.memoryCache.set(key, { value: parsed, expiresAt: now + 30_000 });
      return parsed;
    } catch (error) {
      this.logger.warn(`GET ${key} failed: ${(error as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryCache.set(key, { value, expiresAt });

    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`SET ${key} failed: ${(error as Error).message}`);
    }
  }

  /**
   * Invalidates every key under a prefix across both L1 in-memory cache and Redis.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    // Invalidate L1 memory
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
      }
    }

    if (!this.client) return;
    try {
      const keys = await this.client.keys(`${prefix}*`);
      if (keys.length > 0) await this.client.del(...keys);
    } catch (error) {
      this.logger.warn(`Invalidate ${prefix}* failed: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.pruneTimer);
    this.memoryCache.clear();
    this.client?.disconnect();
  }
}
