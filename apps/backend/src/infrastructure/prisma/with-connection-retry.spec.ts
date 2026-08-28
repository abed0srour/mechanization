import { Prisma } from '../../generated/tenant-client';
import { withConnectionRetry } from './with-connection-retry';

/** The shape Prisma raises when the pooler cannot be reached at all. */
function unreachable(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "\nInvalid `this.db.zone.findMany()` invocation\nCan't reach database server at `aws-1-ap-south-1.pooler.supabase.com:5432`",
    { code: 'P1001', clientVersion: '5.22.0' },
  );
}

describe('withConnectionRetry', () => {
  // The helper sleeps between attempts; real timers would make this suite wait
  // over a second for something whose behaviour is entirely about counting.
  beforeEach(() => jest.useFakeTimers({ advanceTimers: true }));
  afterEach(() => jest.useRealTimers());

  it('returns the first result when nothing fails', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withConnectionRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /**
   * The case actually observed: the sector list and the map layer both failed
   * on one page load while the pooler was briefly unreachable, and the database
   * was fine a second later.
   */
  it('recovers from a transient connection failure', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(unreachable())
      .mockResolvedValue([{ id: 'zone-1' }]);

    await expect(withConnectionRetry(fn)).resolves.toEqual([{ id: 'zone-1' }]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries twice before giving up, then rethrows the last error', async () => {
    const fn = jest.fn().mockRejectedValue(unreachable());

    await expect(withConnectionRetry(fn)).rejects.toMatchObject({ code: 'P1001' });
    // One attempt plus two retries — not an unbounded loop against a server
    // that is genuinely down.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  /**
   * The important negative case. A unique-constraint violation, a pool timeout
   * or a statement timeout are all *answers* from the server, and retrying them
   * would at best waste time and at worst apply a write twice.
   */
  it('does not retry an error that is not a connection failure', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
    });
    const fn = jest.fn().mockRejectedValue(conflict);

    await expect(withConnectionRetry(fn)).rejects.toMatchObject({ code: 'P2002' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
