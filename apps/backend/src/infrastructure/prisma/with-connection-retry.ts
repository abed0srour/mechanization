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
 * there is no half-applied effect to duplicate.
 *
 * **P2024 is deliberately not matched.** "Timed out fetching a new connection
 * from the pool" means the pool is already saturated, and the one thing that
 * cannot help a saturated pool is the same request asking it again — a retry
 * there converts a slow minute into a stampede. It has to surface as an error
 * so the queue drains.
 */
export function isTransientConnectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };

  /*
   * Matched structurally, not with `instanceof`.
   *
   * This app generates two Prisma clients — `registry-client` and
   * `tenant-client` — and each ships its own error classes. An
   * `instanceof Prisma.PrismaClientKnownRequestError` imported from one of them
   * is simply false for an error thrown by the other, silently and with no type
   * error to catch it. That is not hypothetical: the tenant lookup in
   * `TenantMiddleware` runs on the registry client, so the check this replaces
   * would have declined to retry the single most important query in the system
   * while appearing to cover it.
   */
  if (candidate.code === 'P1001') return true;
  if (candidate.name === 'PrismaClientInitializationError') return true;
  return (
    typeof candidate.message === 'string' &&
    candidate.message.includes("Can't reach database server")
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
