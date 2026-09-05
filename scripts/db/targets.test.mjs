/**
 * The guard is the only thing standing between a mistyped command and live
 * municipal records, so it gets tests. Run with:
 *
 *   pnpm db:test        (node --test scripts/db/)
 *
 * Every case writes a dotenv file into a scratch directory and asserts that
 * `resolveTarget` either accepts it or refuses with the right reason. Nothing
 * here touches a network or the repository's own env files.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TARGETS, resolveTarget, extractRef } from './targets.mjs';

const STAGING = TARGETS.staging.ref;
const PROD = TARGETS.production.ref;

/** A complete, valid env file for `ref`. Individual tests corrupt one line. */
function envFor(ref) {
  return [
    'NODE_ENV=production',
    `DATABASE_URL="postgresql://postgres.${ref}:pw123@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"`,
    `DIRECT_URL="postgresql://postgres.${ref}:pw123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"`,
    `SUPABASE_URL="https://${ref}.supabase.co"`,
    'SUPABASE_SERVICE_ROLE_KEY="sbp_notarealkey00000000000000"',
    '',
  ].join('\n');
}

/** Writes `body` to the env file `target` expects, inside a throwaway root. */
function withEnv(targetName, body, fn) {
  const root = mkdtempSync(join(tmpdir(), 'mech-guard-'));
  const rel = TARGETS[targetName].envFile;
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Returns the refusal message, or null if the guard allowed it through. */
function refusalFor(targetName, body) {
  return withEnv(targetName, body, (root) => {
    try {
      resolveTarget(targetName, { root });
      return null;
    } catch (error) {
      return error.message;
    }
  });
}

describe('extractRef', () => {
  test('reads the ref from a pooled connection string', () => {
    assert.equal(
      extractRef(`postgresql://postgres.${STAGING}:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`),
      STAGING,
    );
  });

  test('reads the ref from a direct connection string', () => {
    assert.equal(extractRef(`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`), PROD);
  });

  test('still reads the ref when the password is an unfilled placeholder', () => {
    // The case that matters most: a half-finished file must not become
    // *unidentifiable*, or the guard silently stops guarding.
    assert.equal(
      extractRef(`postgresql://postgres.${PROD}:<PASSWORD>@aws-1-x.pooler.supabase.com:6543/postgres`),
      PROD,
    );
  });

  test('returns null for a non-Supabase database', () => {
    assert.equal(extractRef('postgresql://ci:ci@localhost:5432/ci'), null);
  });
});

describe('resolveTarget refuses', () => {
  test('a local env file pointed at production', () => {
    const message = refusalFor('local', envFor(PROD));
    assert.match(message ?? '', /points at .* \(production\)/);
  });

  test('a production env file pointed at staging', () => {
    const message = refusalFor('production', envFor(STAGING));
    assert.match(message ?? '', /points at .* \(staging\)/);
  });

  test('a staging file that names the production ref anywhere, comments included', () => {
    const message = refusalFor('staging', `${envFor(STAGING)}# was ${PROD}\n`);
    assert.match(message ?? '', /mentions the production ref/);
  });

  test('DIRECT_URL on the transaction pooler', () => {
    const message = refusalFor('staging', envFor(STAGING).replace(':5432/postgres"', ':6543/postgres"'));
    assert.match(message ?? '', /port 6543/);
  });

  test('a SUPABASE_URL belonging to a different project', () => {
    const message = refusalFor(
      'staging',
      envFor(STAGING).replace(`https://${STAGING}.supabase.co`, `https://${PROD}.supabase.co`),
    );
    assert.ok(message, 'expected a refusal');
  });

  test('an unfilled template in a connection string', () => {
    const message = refusalFor('staging', envFor(STAGING).replace('pw123', '<PASSWORD>'));
    assert.match(message ?? '', /template placeholders/);
  });

  test('but NOT an unfilled placeholder in an unrelated variable', () => {
    // A guard that blocks a migration over CORS_ORIGINS is a guard people start
    // passing --force to. It warns instead; the app's env schema catches this
    // one at boot, where it actually matters.
    const body = `${envFor(STAGING)}CORS_ORIGINS="<STAGING-WEB-ORIGIN>"\n`;
    assert.equal(refusalFor('staging', body), null);

    const warnings = withEnv('staging', body, (root) => resolveTarget('staging', { root }).warnings);
    assert.match(warnings.join(' '), /CORS_ORIGINS/);
  });

  test('a missing env file', () => {
    const root = mkdtempSync(join(tmpdir(), 'mech-guard-'));
    try {
      assert.throws(() => resolveTarget('staging', { root }), /No env file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unknown target name', () => {
    assert.throws(() => resolveTarget('prod'), /Unknown target/);
  });
});

describe('resolveTarget accepts', () => {
  test('a correct staging file', () => {
    assert.equal(refusalFor('staging', envFor(STAGING)), null);
  });

  test('a correct production file', () => {
    assert.equal(refusalFor('production', envFor(PROD)), null);
  });

  test('a correct local file, which points at the staging database', () => {
    assert.equal(refusalFor('local', envFor(STAGING)), null);
  });
});

describe('the pinned refs', () => {
  test('staging and production are different projects', () => {
    // A copy-paste slip here would disable every check above at once.
    assert.notEqual(STAGING, PROD);
  });

  test('local shares the staging database, never production', () => {
    assert.equal(TARGETS.local.ref, STAGING);
    assert.notEqual(TARGETS.local.ref, PROD);
  });
});
