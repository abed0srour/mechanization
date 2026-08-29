import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { createApiApp } from './bootstrap';

/**
 * Serverless entry point (Vercel).
 *
 * The platform gives us one Node process per warm instance and a plain
 * (req, res) handler, so instead of `listen()` we `init()` the application and
 * hand back the Express instance the default adapter already created. Reaching
 * for `express()` ourselves would mean importing a package this workspace does
 * not declare — pnpm's strict linking refuses it, and rightly.
 */
type ExpressLike = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Module-scope, so the *promise* is shared: two requests arriving on a cold
 * instance before boot finishes must await the same NestFactory call. Caching
 * the resolved app instead would let the second request start a second full
 * bootstrap — two more Prisma pools against a connection budget that is already
 * the scarcest resource here.
 */
let app: Promise<ExpressLike> | null = null;

async function instance(): Promise<ExpressLike> {
  const nest = await createApiApp();
  await nest.init();
  return nest.getHttpAdapter().getInstance() as ExpressLike;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!app) {
    /**
     * A failed boot must not be cached. Env validation and the first registry
     * connection both happen in here; if either fails transiently, every later
     * request on this instance would otherwise replay the same rejected promise
     * until the instance is recycled.
     */
    app = instance().catch((error: unknown) => {
      app = null;
      throw error;
    });
  }

  try {
    (await app)(req, res);
  } catch (error: unknown) {
    Logger.error(
      'Failed to boot the API in the serverless handler',
      error instanceof Error ? error.stack : error,
    );
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ statusCode: 500, message: 'Service unavailable' }));
  }
}
