import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { SessionRevocationService } from './session-revocation.service';

/**
 * Revoking a session that has already been issued.
 *
 * Until `tokenVersion` there was no way to do it at all. `role` travels inside
 * the JWT and `RolesGuard` authorises from that claim; `isActive` and the
 * Supabase ban are both consulted only at login. So a dismissed staff member,
 * or a demoted SUPER_ADMIN, kept exactly the access they had until their token
 * expired — up to thirty days with "تذكّرني على هذا الجهاز", with nothing in
 * the UI or the audit trail to suggest the account was still live.
 */
function build(row: { tokenVersion: number; isActive: boolean } | null) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const store = new Map<string, unknown>();

  const cache = {
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    invalidatePrefix: jest.fn(async (prefix: string) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    }),
  } as unknown as RedisCacheService;

  const service = new SessionRevocationService(
    {
      tenantSlug: 'albazourieh',
      prisma: { user: { findUnique } },
    } as unknown as TenantContextService,
    cache,
  );

  return { service, findUnique, cache };
}

describe('SessionRevocationService', () => {
  it('accepts a token stamped with the current version', async () => {
    const { service } = build({ tokenVersion: 3, isActive: true });
    await expect(service.isCurrent('staff-1', 3)).resolves.toBe(true);
  });

  it('rejects a token stamped with a superseded version', async () => {
    // The dismissal case: the row moved on, the token did not.
    const { service } = build({ tokenVersion: 4, isActive: true });
    await expect(service.isCurrent('staff-1', 3)).resolves.toBe(false);
  });

  it('rejects a token for a deactivated account', async () => {
    // Belt and braces: `setStaffActive` bumps the version too, so this only
    // matters if a future write path forgets to.
    const { service } = build({ tokenVersion: 3, isActive: false });
    await expect(service.isCurrent('staff-1', 3)).resolves.toBe(false);
  });

  it('rejects a token whose subject no longer exists', async () => {
    // "Cannot find them" must not read as "carry on".
    const { service } = build(null);
    await expect(service.isCurrent('ghost', 0)).resolves.toBe(false);
  });

  it('accepts a token minted before the column existed', async () => {
    // Those carry no `tokenVersion` at all. Reading a missing claim as 0 — the
    // starting value of every account — is what lets existing sessions survive
    // the deploy; the first revocation of any kind then invalidates them.
    const { service } = build({ tokenVersion: 0, isActive: true });
    await expect(service.isCurrent('staff-1', undefined)).resolves.toBe(true);
  });

  it('rejects a legacy token once the account has been revoked once', async () => {
    const { service } = build({ tokenVersion: 1, isActive: true });
    await expect(service.isCurrent('staff-1', undefined)).resolves.toBe(false);
  });

  it('does not hit the database on every request', async () => {
    // The check runs on every authenticated request, against a pooler this
    // system already works to keep off the hot path.
    const { service, findUnique } = build({ tokenVersion: 2, isActive: true });

    await service.isCurrent('staff-1', 2);
    await service.isCurrent('staff-1', 2);
    await service.isCurrent('staff-1', 2);

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('re-reads after a revocation drops the cached version', async () => {
    const { service, findUnique } = build({ tokenVersion: 2, isActive: true });
    await expect(service.isCurrent('staff-1', 2)).resolves.toBe(true);

    // What `StaffService` calls after bumping, so the revocation takes effect
    // on this instance immediately rather than at the end of the TTL.
    findUnique.mockResolvedValue({ tokenVersion: 3, isActive: true });
    await service.forget('staff-1');

    await expect(service.isCurrent('staff-1', 2)).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not cache a missing account as a version', async () => {
    // Caching "not found" as a number would make a deleted account's token
    // start working again.
    const { service, cache } = build(null);
    await service.isCurrent('ghost', 0);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('scopes the cache key to the municipality', async () => {
    const { service, cache } = build({ tokenVersion: 1, isActive: true });
    await service.isCurrent('staff-1', 1);

    expect(cache.set).toHaveBeenCalledWith(
      'session:albazourieh:tokenVersion:staff-1',
      1,
      expect.any(Number),
    );
  });
});
