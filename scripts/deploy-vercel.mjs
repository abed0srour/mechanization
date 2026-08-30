#!/usr/bin/env node
/**
 * One-command Vercel setup for this monorepo.
 *
 *   VERCEL_TOKEN=xxx node scripts/deploy-vercel.mjs
 *
 * Creates (or updates) the two projects, uploads every environment variable,
 * deploys both, and then re-points them at each other's real URLs.
 *
 * Why a script rather than the dashboard: the two projects have to know each
 * other's origins — the API's CORS_ORIGINS and the portal's
 * NEXT_PUBLIC_API_URL — and neither URL exists until the other side has been
 * created. Doing that by hand means deploying, copying a URL, editing a
 * variable, redeploying, twice. This does the same loop and gets the second
 * pass right by construction.
 *
 * Secrets are read from apps/backend/.env and apps/frontend/.env.local on this
 * machine and sent straight to Vercel. They are never written to a new file.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const API_PROJECT = process.env.VERCEL_API_PROJECT ?? 'mechanization-api';
const WEB_PROJECT = process.env.VERCEL_WEB_PROJECT ?? 'mechanization-web';
const TARGETS = ['production', 'preview'];

const token = process.env.VERCEL_TOKEN;
if (!token) {
  die(
    'VERCEL_TOKEN is not set.\n\n' +
      'Create one at https://vercel.com/account/tokens (scope: your personal\n' +
      'account or the team that should own these projects), then:\n\n' +
      '  PowerShell:  $env:VERCEL_TOKEN="..."; node scripts/deploy-vercel.mjs\n' +
      '  bash:        VERCEL_TOKEN=... node scripts/deploy-vercel.mjs\n',
  );
}

// ── Vercel REST ───────────────────────────────────────────────────────

/**
 * Every call carries the team scope explicitly. A token created for a team but
 * used without `teamId` silently operates on the personal account instead,
 * which is how you end up with two projects nobody on the team can see.
 */
let teamId = process.env.VERCEL_TEAM_ID ?? null;

async function api(method, path, body) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set('teamId', teamId);

  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = new Error(
      `${method} ${path} → ${response.status} ${parsed?.error?.message ?? text}`,
    );
    err.status = response.status;
    err.code = parsed?.error?.code;
    throw err;
  }
  return parsed;
}

// ── .env parsing ──────────────────────────────────────────────────────

/** Deliberately minimal: KEY=VALUE, optional quotes, `#` comments, no expansion. */
function readEnvFile(path) {
  if (!existsSync(path)) die(`Missing ${path} — this script reads your real values from it.`);

  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/s, '$2');
  }
  return out;
}

// ── Steps ─────────────────────────────────────────────────────────────

async function resolveScope() {
  const user = await api('GET', '/v2/user');
  if (teamId) {
    log(`Token belongs to ${user.user.username}; scoped to team ${teamId}`);
    return;
  }

  const { teams = [] } = await api('GET', '/v2/teams');
  if (teams.length === 0) {
    log(`Deploying to the personal account of ${user.user.username}`);
    return;
  }
  if (teams.length === 1) {
    teamId = teams[0].id;
    log(`Deploying to team "${teams[0].slug}"`);
    return;
  }

  die(
    'This token can see more than one team, so the target is ambiguous.\n' +
      'Re-run with the one you want:\n\n' +
      teams.map((t) => `  VERCEL_TEAM_ID=${t.id} ... # ${t.slug}`).join('\n'),
  );
}

/**
 * `rootDirectory` is the whole reason this cannot be done with the CLI alone:
 * it has no command for it, and without it Vercel builds the repository root
 * and finds neither app.
 */
async function ensureProject(name, rootDirectory, framework) {
  let project;
  try {
    project = await api('GET', `/v9/projects/${name}`);
    log(`Project "${name}" already exists`);
  } catch (error) {
    if (error.status !== 404) throw error;
    project = await api('POST', '/v10/projects', { name, framework, rootDirectory });
    log(`Created project "${name}"`);
  }

  /**
   * Patched even when the project already existed, and the build commands are
   * left null on purpose: each app's own vercel.json supplies them, and a value
   * set here would shadow the file that is actually reviewed in pull requests.
   */
  await api('PATCH', `/v9/projects/${project.id}`, {
    rootDirectory,
    framework,
    buildCommand: null,
    installCommand: null,
    outputDirectory: null,
  });

  return project;
}

async function setEnv(project, vars) {
  const body = Object.entries(vars)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ({
      key,
      value: String(value),
      target: TARGETS,
      // Everything encrypted, including the NEXT_PUBLIC_* pair. They end up in
      // the browser bundle either way; there is no reason for them to also be
      // readable in the dashboard by anyone with project access.
      type: 'encrypted',
    }));

  await api('POST', `/v10/projects/${project.id}/env?upsert=true`, body);
  log(`  set ${body.length} variable(s) on ${project.name}`);
}

/**
 * The CLI does the upload, because the REST deployment endpoint wants every
 * file inlined and this repository is thousands of them.
 *
 * `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` target the project without a
 * `.vercel/project.json`, which matters here: two projects share one working
 * directory, and a link file can only point at one of them.
 */
function deploy(project, label) {
  log(`Deploying ${label}…`);

  const env = {
    ...process.env,
    VERCEL_ORG_ID: project.accountId,
    VERCEL_PROJECT_ID: project.id,
  };

  const args = ['--yes', 'vercel@latest', 'deploy', '--prod', '--yes', '--token', token];
  if (teamId) args.push('--scope', teamId);

  let output;
  try {
    output = execFileSync('npx', args, { cwd: REPO, env, encoding: 'utf8', stdio: 'pipe', shell: true });
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    die(`Deploy of ${label} failed:\n\n${detail}`);
  }

  const url = output.trim().split(/\s+/).filter((line) => line.startsWith('https://')).pop();
  log(`  ${label} → ${url}`);
  return url;
}

/** The stable `<project>.vercel.app` alias, not the per-deployment URL. */
async function productionUrl(project, fallback) {
  const fresh = await api('GET', `/v9/projects/${project.id}`);
  const alias = fresh.targets?.production?.alias?.find((a) => a.endsWith('.vercel.app'));
  return alias ? `https://${alias}` : fallback;
}

/**
 * Persisted back into .env rather than regenerated per run: rotating it every
 * deploy would leave the previous deployment's cron calls failing until the
 * next one, and the value is wanted locally anyway for testing the endpoints.
 */
function cronSecret(backendEnvPath, existing) {
  if (existing?.length >= 16) return existing;

  const generated = randomBytes(32).toString('hex');
  appendFileSync(
    backendEnvPath,
    `\n# Generated by scripts/deploy-vercel.mjs — shared with Vercel Cron.\nCRON_SECRET="${generated}"\n`,
    'utf8',
  );
  log('Generated CRON_SECRET and appended it to apps/backend/.env');
  return generated;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function die(message) {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

// ── Run ───────────────────────────────────────────────────────────────

const backendEnvPath = join(REPO, 'apps', 'backend', '.env');
const backend = readEnvFile(backendEnvPath);
const frontend = readEnvFile(join(REPO, 'apps', 'frontend', '.env.local'));

await resolveScope();

const apiProject = await ensureProject(API_PROJECT, 'apps/backend', null);
const webProject = await ensureProject(WEB_PROJECT, 'apps/frontend', 'nextjs');

/**
 * First pass uses the names Vercel will almost certainly assign. If either is
 * taken and Vercel picks a suffixed alias instead, the second pass below
 * corrects both sides — so a collision costs a redeploy, not a broken portal.
 */
let apiUrl = `https://${API_PROJECT}.vercel.app`;
let webUrl = `https://${WEB_PROJECT}.vercel.app`;

async function pushEnv() {
  await setEnv(apiProject, {
    ...backend,
    /**
     * NODE_ENV=development is a deliberate choice for this deployment, not an
     * oversight: apps/backend/.env has OTP disabled and no SMS provider, and
     * env.schema.ts refuses to boot in production in that state — correctly,
     * since a phone number alone would then open a citizen record. Setting
     * this to `production` is the last step before real citizens are pointed
     * at it, and it requires SMS keys first.
     */
    NODE_ENV: 'development',
    // Meaningless on a platform that assigns the port.
    PORT: undefined,
    // Only drop localhost Redis; allow cloud/serverless Redis (e.g. Upstash rediss://).
    REDIS_URL:
      backend.REDIS_URL && !backend.REDIS_URL.includes('localhost') && !backend.REDIS_URL.includes('127.0.0.1')
        ? backend.REDIS_URL
        : undefined,
    CORS_ORIGINS: webUrl,
    PUBLIC_API_URL: `${apiUrl}/api/v1`,
    PUBLIC_PORTAL_URL: webUrl,
    CRON_SECRET: cronSecret(backendEnvPath, backend.CRON_SECRET),
  });

  await setEnv(webProject, {
    NEXT_PUBLIC_API_URL: `${apiUrl}/api/v1`,
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: frontend.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  });
}

await pushEnv();
deploy(apiProject, API_PROJECT);
deploy(webProject, WEB_PROJECT);

const realApiUrl = await productionUrl(apiProject, apiUrl);
const realWebUrl = await productionUrl(webProject, webUrl);

if (realApiUrl !== apiUrl || realWebUrl !== webUrl) {
  log('\nAssigned URLs differ from the assumed ones — correcting and redeploying.');
  apiUrl = realApiUrl;
  webUrl = realWebUrl;
  await pushEnv();
  deploy(apiProject, API_PROJECT);
  deploy(webProject, WEB_PROJECT);
}

// ── Verify ────────────────────────────────────────────────────────────

log('\nChecking the API is actually up…');
for (const path of ['/api/v1/health', '/api/v1/health/ready']) {
  try {
    const response = await fetch(`${apiUrl}${path}`);
    log(`  ${path} → ${response.status} ${(await response.text()).slice(0, 80)}`);
  } catch (error) {
    log(`  ${path} → unreachable (${error.message})`);
  }
}

log(
  `\nDone.\n  Portal: ${webUrl}\n  API:    ${apiUrl}/api/v1\n\n` +
    'If /health/ready says "degraded", the database is unreachable from the\n' +
    'function — check DATABASE_URL uses the pooled host on port 6543.\n' +
    'Read docs/deploy-vercel.md §5 before pointing anyone real at this.\n',
);
