import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './shared-kernel/infrastructure/config';
import { DomainExceptionFilter } from './shared-kernel/presentation/domain-exception.filter';

async function bootstrap(): Promise<void> {
  // Validate the environment before Nest starts: a municipality portal booting
  // without a JWT secret is worse than one that refuses to boot at all.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(compression());
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.PORT);
  Logger.log(`API listening on http://localhost:${config.PORT}/api/v1`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error('Failed to start the API', error);
  process.exit(1);
});
