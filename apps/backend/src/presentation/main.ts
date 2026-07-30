import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from '../app.module';
import { APP_CONFIG } from './config/app.config';
import { AppLogger } from './config/app-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    logger: new AppLogger(),
  });
  const config = app.get(ConfigService);

  app.setGlobalPrefix(APP_CONFIG.apiPrefix);
  app.use(helmet());
  app.use(compression());

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
