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

    ScheduleModule.forRoot(),

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
