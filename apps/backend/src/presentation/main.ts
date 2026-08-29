import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createApiApp } from './bootstrap';
import { APP_CONFIG } from './config/app.config';

/**
 * Boots the API as a long-lived process. The configuration itself lives in
 * `bootstrap.ts`, shared with the serverless entry point.
 */
async function bootstrap(): Promise<void> {
  const app = await createApiApp();
  const port = app.get(ConfigService).get<number>('PORT') ?? 4000;

  await app.listen(port);

  Logger.log(`API listening on http://localhost:${port}/${APP_CONFIG.apiPrefix}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error('Failed to start the API', error instanceof Error ? error.stack : error);
  process.exit(1);
});
