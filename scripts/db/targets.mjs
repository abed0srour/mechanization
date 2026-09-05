/**
 * The three places this codebase's schema can land, and the checks that keep
 * them apart.
 *
 * The problem this file exists to solve: `DATABASE_URL` lives in a dotenv file,
 * migrations are run by hand (`docs/deploy-vercel.md` §5), and the difference
 * between staging and production is forty characters of hostname. Nothing about
 * `pnpm tenant:migrate-all` tells you which database it is about to rewrite —
 * it reads whatever `.env` happens to say. That is one careless `git stash`
 * away from applying an untested migration to live municipal records.
 *
 * So the refs are pinned *here*, in version control, and every script that
 * touches a database resolves its target through `resolveTarget` below. A
 * connection string that does not match the ref for the target you named is a
 * hard failure, not a warning. Editing a dotenv file can no longer change which
 * database a command hits; only naming a different target can, and naming
 * production additionally costs a typed confirmation.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * Project refs are not secrets — they are the public half of every Supabase
 * URL — so they belong in git, where a diff to one is reviewable. The passwords
 * and service-role keys they pair with stay in the ignored dotenv files.
 */
export const TARGETS = {
  /**
   * A developer's machine. Deliberately pointed at *staging*: Postgres is
   * hosted (there is no local stack — `docker-compose.yml` runs Redis alone),
   * so "local" describes where the process runs, not where the data is.
   *
   * The consequence worth stating plainly: `pnpm dev` writes to the staging
   * database. That is the trade this repository already made; what is new is
   * that it can no longer accidentally be the production one.
   */
  local: {
    ref: 'lzgbjcwtzqyrbeoolvdz',
    envFile: 'apps/backend/.env',
    nodeEnv: 'development',
    label: 'local dev → staging database',
  },
  staging: {
    ref: 'lzgbjcwtzqyrbeoolvdz',
    envFile: 'apps/backend/.env.staging',
    nodeEnv: 'production',
    label: 'staging',
  },
  production: {
    ref: 'thbgwfbcqdougbjvgvyw',
    envFile: 'apps/backend/.env.production',
    nodeEnv: 'production',
    label: 'PRODUCTION — live municipal records',
  },
};

export const PRODUCTION_REF = TARGETS.production.ref;

/**
 * Pulls the project ref out of either shape of Supabase connection string.
 *
 *   pooled:  postgresql://postgres.<ref>:pw@aws-1-<region>.pooler.supabase.com:6543/postgres
 *   direct:  postgresql://postgres:pw@db.<ref>.supabase.co:5432/postgres
 *
 * Returns null rather than throwing: the caller reports "could not identify a
 * project" more usefully than a URL parse error does.
 */
export function extractRef(connectionString) {
  if (!connectionString) return null;

  // Matched with a regex rather than `new URL()` on purpose: a password that is
  // still a `<PLACEHOLDER>`, or one holding a character the URL parser rejects,
  // must not make the ref unreadable. Knowing *which project* a half-finished
  // file names is exactly when this check earns its keep.

  // Pooled: the ref rides in the username, after the dot.
  const fromUser = /\/\/postgres\.([a-z]{20})[:@]/.exec(connectionString);
  if (fromUser) return fromUser[1];

  // Direct: the ref is the first hostname label.
  const fromHost = /@db\.([a-z]{20})\.supabase\.(?:co|com)\b/.exec(connectionString);
  if (fromHost) return fromHost[1];

  return null;
}

/** Values still carrying a `<FILL-ME>` marker from the template. */
function placeholderKeys(env) {
  return Object.entries(env)
    .filter(([, value]) => /<[A-Za-z0-9_ -]+>/.test(value))
    .map(([key]) => key);
}

/** Minimal dotenv reader. Enough for KEY=value with optional quotes; no interpolation. */
export function parseEnvFile(path) {
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1);
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export class TargetError extends Error {}

/**
 * Loads the dotenv file for `name` and refuses to hand it back unless every
 * connection string in it belongs to that target's project.
 *
 * The checks are ordered by how badly they end: wrong project first, then
 * production leaking into a non-production file, then the pooled/direct mix-up
 * that `.env.example` warns about.
 */
export function resolveTarget(name, { root = ROOT } = {}) {
  const target = TARGETS[name];
  if (!target) {
    throw new TargetError(
      `Unknown target '${name}'. Expected one of: ${Object.keys(TARGETS).join(', ')}`,
    );
  }

  const envPath = join(root, target.envFile);
  if (!existsSync(envPath)) {
    throw new TargetError(
      `No env file for '${name}' at ${target.envFile}\n` +
        `  Copy apps/backend/.env.example and fill in the ${name} credentials.`,
    );
  }

  const env = parseEnvFile(envPath);
  const problems = [];
  const warnings = [];

  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL']) {
    if (!env[key]) problems.push(`${key} is missing from ${target.envFile}`);
  }

  // Reported before the ref checks so an unfilled template says "fill this in"
  // rather than "this is not a Supabase connection string", which sends people
  // looking for the wrong problem.
  //
  // Only the three keys that decide *which database this is* can block. An
  // unfilled CORS_ORIGINS has nothing to do with whether a migration is safe to
  // run, and a guard that refuses work for unrelated reasons is a guard people
  // start passing flags to get around. The rest are reported and let through;
  // the app's own env schema fails at boot on anything it actually needs.
  const CONNECTION_KEYS = ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL'];
  const unfilled = placeholderKeys(env);
  const blockingUnfilled = unfilled.filter((key) => CONNECTION_KEYS.includes(key));
  const otherUnfilled = unfilled.filter((key) => !CONNECTION_KEYS.includes(key));

  if (blockingUnfilled.length > 0) {
    problems.push(
      `${target.envFile} still has template placeholders in: ${blockingUnfilled.join(', ')}\n` +
        `    Copy the real values from the ${target.ref} dashboard → Connect.`,
    );
  }
  if (otherUnfilled.length > 0) {
    warnings.push(`${target.envFile} still has placeholders in: ${otherUnfilled.join(', ')}`);
  }

  // ── The check this whole file exists for ────────────────────────────────
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    if (!env[key]) continue;
    const ref = extractRef(env[key]);
    if (ref === null) {
      problems.push(
        `${key} does not look like a Supabase connection string — no project ref found in it`,
      );
    } else if (ref !== target.ref) {
      // 'local' shares staging's ref, so name the *database* it belongs to —
      // "points at staging" is the useful sentence, "points at local" is not.
      const owner =
        Object.entries(TARGETS).find(([n, t]) => t.ref === ref && n !== 'local')?.[0] ??
        'an unknown project';
      problems.push(
        `${key} points at ${ref} (${owner}), but target '${name}' is pinned to ${target.ref}`,
      );
    }
  }

  if (env.SUPABASE_URL) {
    const host = (() => {
      try {
        return new URL(env.SUPABASE_URL).hostname;
      } catch {
        return '';
      }
    })();
    if (host !== `${target.ref}.supabase.co`) {
      problems.push(
        `SUPABASE_URL is ${host || env.SUPABASE_URL}, expected ${target.ref}.supabase.co`,
      );
    }
  }

  // A half-edited file — someone swapped DATABASE_URL but left the service-role
  // key or a stray comment from production behind — is caught here even when
  // the two URLs above happen to agree.
  if (name !== 'production') {
    const raw = readFileSync(envPath, 'utf8');
    if (raw.includes(PRODUCTION_REF)) {
      problems.push(
        `${target.envFile} mentions the production ref ${PRODUCTION_REF} somewhere. ` +
          `Nothing outside the production target may reference it.`,
      );
    }
  }

  // Pooled vs direct. Running DDL through the transaction pooler is the failure
  // `.env.example` calls out: it half-works, then breaks on schema creation.
  const directPort = (() => {
    try {
      return new URL(env.DIRECT_URL).port;
    } catch {
      return '';
    }
  })();
  if (directPort === '6543') {
    problems.push(
      'DIRECT_URL is on port 6543 (transaction pooler). Migrations and schema DDL need the ' +
        'session-mode connection on 5432 — provisioning creates schemas, types and triggers, ' +
        'which the transaction pooler cannot carry.',
    );
  }

  if (problems.length > 0) {
    throw new TargetError(
      `Refusing to run against '${name}':\n` + problems.map((p) => `  ✗ ${p}`).join('\n'),
    );
  }

  return { name, ...target, envPath, env, warnings };
}
