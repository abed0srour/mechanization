import { Module } from '@nestjs/common';

/**
 * The domain layer is pure TypeScript — entities, value objects and ports with
 * no providers to register. This module exists so the dependency graph in
 * `app.module.ts` reads the same as the architecture diagram, and so that a
 * future domain service has an obvious home rather than drifting into
 * `application/`.
 *
 * If this module ever gains an import of `@nestjs/config`, Prisma, or anything
 * under `infrastructure/`, the layer rule has been broken.
 */
@Module({})
export class DomainModule {}
