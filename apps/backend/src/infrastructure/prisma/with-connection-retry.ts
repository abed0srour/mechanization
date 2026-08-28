import { Prisma } from '../../generated/tenant-client';

/**
 * Delay before each retry, in milliseconds.
 *
 * Two retries rather than one, and backed off rather than fixed. The single
 * 300ms attempt this replaces was tuned for a hiccup; the failure actually seen
 * is the pooler being briefly unreachable for a second or more, which one
 * retry 300ms later lands squarely inside. Backing off past a second gives the
 * blip time to pass without making a genuinely dead server take long to
 * report — worst case here is roughly 1.2s of waiting before the error
 * surfaces, on top of however long the attempts themselves took.
 */
const RETRY_DELAYS_MS = [250, 900];

/**
 * Prisma's P1001: the TCP/TLS handshake to the pooler itself failed. Distinct
 * from a pool-timeout (P2024, "every connection is busy") — this is "couldn't
 * even reach the server", which on a hosted, remote Postgres is occasionally a
 * transient network blip rather than a real outage.
 *
 * Retrying this is safe for a write as well as a read, and that is not an
 * accident of the code: P1001 means the statement never reached the server, so
 * there is no half-applied effect to duplicate. A pool timeout or a statement
 * timeout would *not* be safe to retry blindly, which is why neither is matched
 * here.
 */
function isTransientConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.message.includes("Can't reach database server")
  );
}

/**
 * Retries a transient connection failure a couple of times before giving up.
 *
 * A single hiccup reaching the database is not worth surfacing as a 500 to a
 * citizen or a member of staff — particularly when the database is a long way
 * off and the round trip is already over a hundred milliseconds, which makes a
 * dropped connection a normal event rather than an exceptional one. Anything
 * that is not a connection failure propagates immediately and untouched.
 */
export async function withConnectionRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientConnectionError(error)) throw error;
      lastError = error;

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      // Jittered so a pooler that has just come back is not hit by every
      // in-flight request of every tab at the same instant.
      await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 150));
    }
  }

  throw lastError;
}
