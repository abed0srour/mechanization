import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApplicationModule } from './application/application.module';
import { DomainModule } from './domain/domain.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { PresentationModule } from './presentation/presentation.module';
import { validateEnv } from './presentation/config/env.schema';

/**
 * Root composition. The four imports are the four layers, in dependency order —
 * if this list ever needs a fifth, something has escaped its layer.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Boot fails on a missing secret rather than surfacing it as a 500 on the
      // first request that happens to need it.
      validate: validateEnv,
    }),

    /**
     * Synchronous emit, deliberately: listeners run inside the emitting
     * request's AsyncLocalStorage scope, which is how the audit subscriber
     * reaches the right municipality's Prisma client without being handed one.
     * Switching this to a queue would silently break that and start writing
     * audit rows to whichever tenant happened to be current.
     */
    EventEmitterModule.forRoot({ global: true }),

    /**
     * In-process timers, only where a process outlives the request.
     *
     * On Vercel the instance is torn down moments after the response, so a
     * registered `@Cron` would never fire — and worse, it would *look* like it
     * had, because `ScheduleModule` boots without complaint. The schedule moves
     * to Vercel Cron (`vercel.json`), which calls the same job classes over
     * HTTP through `InternalCronController`. Docker and `pnpm dev` keep the
     * in-process schedule.
     */
    ...(process.env.VERCEL ? [] : [ScheduleModule.forRoot()]),

    /**
     * In-memory storage — correct for a single instance, which matches the
     * expected deployment. This is the one component that needs Redis back the
     * moment a second replica exists: per-instance counters make the effective
     * limit N times what is configured.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),

    DomainModule,
    InfrastructureModule,
    ApplicationModule,
    PresentationModule,
  ],
})
export class AppModule {}
