/**
 * Vercel serverless entry point for the NestJS API.
 *
 * Deliberately plain CommonJS and deliberately thin. Vercel compiles files in
 * `api/` with esbuild, which strips types but does *not* emit the decorator
 * metadata Nest's dependency injection reads at runtime — pointing this file at
 * the TypeScript sources would produce an app whose every constructor parameter
 * resolves to `undefined`. So the real build is `nest build` (tsc, with
 * `emitDecoratorMetadata`) and this file only requires its output.
 *
 * The require path is a static string on purpose: that is what lets Vercel's
 * dependency tracer follow it into `dist/` and bundle the transitive imports.
 */
const handler = require('../dist/presentation/serverless');

module.exports = handler.default || handler;
