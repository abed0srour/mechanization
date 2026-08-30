-- Session revocation, and TOTP replay protection.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.

-- ── tokenVersion ────────────────────────────────────────────────────────────
--
-- The system had no way to revoke an issued session. Role lives in the JWT and
-- `RolesGuard` authorises from the claim, never from a row; `isActive` and the
-- Supabase ban are both checked only at login. So dismissing a staff member,
-- or demoting a SUPER_ADMIN to AUDITOR, took effect when their token expired —
-- up to `JWT_STAFF_REMEMBER_TTL`, which shipped at 30 days.
--
-- This column is the revocation handle. It is stamped into every token and
-- compared on every authenticated request; bumping it invalidates every session
-- that account holds, at once. Deactivation, reactivation, a role change and a
-- password change all bump it.
--
-- An integer rather than a `revokedBefore` timestamp: clock skew between the
-- issuer and the checker cannot make a counter wrong, and there is no window
-- where a token issued in the same second as a revocation survives it.
ALTER TABLE "users"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- ── TOTP replay ─────────────────────────────────────────────────────────────
--
-- `otplib` is configured with `window: 1`, so a code stays valid for about
-- ninety seconds either side of its step. Within that window the same six
-- digits could be presented twice — which matters because the place they are
-- most likely to be observed is a shoulder, a shared screen, or a phishing
-- page that relays them.
--
-- Recording the step a code was accepted at makes each one single-use: a login
-- presenting a step at or below the last accepted one is refused, whatever the
-- digits say. Nullable because no account has used a code yet.
ALTER TABLE "users"
  ADD COLUMN "lastTotpStep" BIGINT;
