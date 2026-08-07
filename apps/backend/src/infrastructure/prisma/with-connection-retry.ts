import { Prisma } from '../../generated/tenant-client';

const RETRY_DELAY_MS = 300;

/**
 * Prisma's P1001: the TCP/TLS handshake to the pooler itself failed. Distinct
 * from a pool-timeout (P2024, "every connection is busy") — this is "couldn't
 * even reach the server", which on a hosted, remote Postgres is occasionally a
 * transient network blip rather than a real outage.
 */
function isTransientConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.message.includes("Can't reach database server")
  );
}

/**
 * One automatic retry for a transient connection failure, after a short
 * delay. A single hiccup reaching the database is not worth surfacing as a
 * 500 to a citizen or a member of staff; a second consecutive failure is
 * treated as real and propagates normally.
 */
export async function withConnectionRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isTransientConnectionError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fn();
  }
}
