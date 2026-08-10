import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from '../app.module';
import { APP_CONFIG } from './config/app.config';
import { AppLogger } from './config/app-logger';

/**
 * Boots the API: global prefix, security middleware, CORS, and the
 * shutdown hooks that let Prisma close its tenant clients cleanly.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    logger: new AppLogger(),
    /**
     * Keeps the untouched request bytes on `request.rawBody`.
     *
     * The Whish callback is authenticated by an HMAC over exactly what the
     * provider sent. Re-serialising the parsed object changes key order and
     * whitespace, so a signature computed over the bytes would never match one
     * computed over `JSON.stringify(req.body)` — this is the difference between
     * a verified webhook and one that always fails.
     */
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.setGlobalPrefix(APP_CONFIG.apiPrefix);
  app.use(helmet());
  app.use(compression());

  /**
   * Body limit, raised from body-parser's 100 KB default.
   *
   * The citizen import posts a batch of spreadsheet rows as JSON, and Arabic
   * text is two bytes a character in UTF-8 — a couple of hundred rows across
   * twenty-nine columns clears 100 KB comfortably, which surfaced as a 500
   * (`PayloadTooLargeError`) rather than as anything the clerk could act on.
   *
   * 1 MB rather than the "just make it big" 50 MB: the client sends the file
   * in fixed-size batches, so no single request needs more than a few hundred
   * KB, and an unbounded limit on every other route is a memory-exhaustion
   * surface bought for no benefit. `useBodyParser` is Nest's own API — reaching
   * for `express.json()` directly would mean importing a package this app does
   * not declare, which pnpm's strict linking is right to refuse.
   */
  app.useBodyParser('json', { limit: '1mb' });

  app.enableCors({
    origin: config.get<string[]>('CORS_ORIGINS') ?? ['http://localhost:3000'],
    credentials: true,
  });

  /**
   * No global ValidationPipe: validation is Zod's job, through
   * `ZodValidationPipe` with schemas shared with the frontend. Running
   * class-validator alongside it would mean two sources of truth for what a
   * valid submission is.
   */

  // Lets Prisma clients and the tenant client cache close cleanly on SIGTERM.
  app.enableShutdownHooks();

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);

  Logger.log(`API listening on http://localhost:${port}/${APP_CONFIG.apiPrefix}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error('Failed to start the API', error instanceof Error ? error.stack : error);
  process.exit(1);
});
