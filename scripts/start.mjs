#!/usr/bin/env node
// Starts Docker (if needed), then Redis, then the backend, then — only once
// the backend is actually accepting requests — the frontend. Sequential on
// purpose: the frontend's first render fetches from the API, so starting it
// alongside the backend just means its first few requests fail while the
// backend is still compiling.
//
// Nest/Next print hundreds of lines of routine startup noise (route mapping,
// dependency init, pnpm banners). We filter both processes' output down to
// one "running on" line per service, and let real errors/warnings through
// unfiltered so problems are never hidden.
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const DOCKER_DESKTOP_PATH = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
const BACKEND_URL = 'http://localhost:4000/api/v1';
const ANSI_RE = /\x1b\[[0-9;]*m/g;

const GREEN = '\x1b[92m';
const BLUE = '\x1b[94m';
const RED = '\x1b[91m';
const YELLOW = '\x1b[93m';
const RESET = '\x1b[0m';

/** e.g. statusLine('docker', 'running on', 'Docker Desktop') */
function statusLine(label, verb, value) {
  return `${GREEN}> ${label.padEnd(9)} ${verb}${RESET} ${BLUE}${value}${RESET}`;
}

function colorize(line, color) {
  return `${color}${line}${RESET}`;
}

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function ensureDockerRunning() {
  if (dockerAvailable()) {
    console.log(statusLine('docker', 'running on', 'Docker Desktop'));
    return true;
  }

  if (process.platform !== 'win32' || !existsSync(DOCKER_DESKTOP_PATH)) {
    console.warn(colorize('! docker not running — skipping redis, app will fall through to Postgres', YELLOW));
    return false;
  }

  spawn(DOCKER_DESKTOP_PATH, { detached: true, stdio: 'ignore' }).unref();

  const timeoutMs = 90_000;
  const intervalMs = 3_000;
  for (let waited = 0; waited < timeoutMs; waited += intervalMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (dockerAvailable()) {
      console.log(statusLine('docker', 'running on', 'Docker Desktop'));
      return true;
    }
  }

  console.warn('! docker took too long to start — skipping redis, app will fall through to Postgres');
  return false;
}

if (await ensureDockerRunning()) {
  try {
    execSync('docker compose up -d redis', { stdio: 'ignore' });
    console.log(statusLine('redis', 'running on', 'redis://localhost:6379'));
  } catch {
    console.warn('! failed to start redis — continuing without cache (falls through to Postgres)');
  }
}

// Once a genuine ERROR/failure line matches, keep printing the lines right
// after it unfiltered too — that's where the actual stack trace lives, and
// dropping it (as this filter used to) means a real failure looks identical
// to silence. A routine WARN does NOT open this window: it prints itself and
// nothing else, so one warning at boot doesn't let the whole noisy dependency
// dump through behind it.
let errorTailLinesRemaining = 0;
const ERROR_TAIL_LINES = 30;
const ERROR_PATTERN = /\bERROR\b|Error:|EADDRINUSE|Cannot find module|Failed to compile|Failed to start/;
const WARN_PATTERN = /\bWARN\b/;

let backendReady = false;
let frontendLocalShown = false;
let frontendNetworkShown = false;

// Default-deny: only our own "running on" lines and genuine problems get
// through. Everything else (dependency graphs, route tables, pnpm banners)
// is routine noise and is dropped.
function handleLine(rawLine) {
  const line = rawLine.replace(ANSI_RE, '').trim();

  if (errorTailLinesRemaining > 0) {
    errorTailLinesRemaining -= 1;
    if (!line) return; // blank line ends the trace early
    console.log(line);
    return;
  }

  if (!line) return;

  if (!backendReady && /API listening on/.test(line)) {
    backendReady = true;
    console.log(statusLine('backend', 'running on', BACKEND_URL));
    return;
  }
  const localMatch = !frontendLocalShown && line.match(/-\s*Local:\s*(\S+)/);
  if (localMatch) {
    frontendLocalShown = true;
    const base = localMatch[1];
    console.log(statusLine('frontend', 'running on', `${base} (local)`));
    // Matches the seeded albazourieh tenant (seed.ts) — dev convenience only.
    console.log(statusLine('admin', 'login page at', `${base}/albazourieh/ar/admin-portal-a91f/login`));
    console.log(statusLine('citizens', 'page at', `${base}/albazourieh/ar/admin-portal-a91f/citizens/{id}`));
    return;
  }
  const networkMatch = !frontendNetworkShown && line.match(/-\s*Network:\s*(\S+)/);
  if (networkMatch) {
    frontendNetworkShown = true;
    console.log(statusLine('frontend', 'running on', `${networkMatch[1]} (network)`));
    return;
  }
  if (ERROR_PATTERN.test(line)) {
    console.log(line);
    errorTailLinesRemaining = ERROR_TAIL_LINES;
    return;
  }
  if (WARN_PATTERN.test(line)) {
    console.log(line);
  }
}

function pipeLines(stream) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      handleLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  });
}

function runDevProcess(filterName) {
  const child = spawn(`pnpm --filter ${filterName} dev`, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });
  pipeLines(child.stdout);
  pipeLines(child.stderr);
  return child;
}

const backend = runDevProcess('@mechanization/backend');
backend.on('exit', (code) => process.exit(code ?? 0));

// Frontend's first render fetches from the API — start it only once the
// backend is actually listening, rather than racing it and eating a burst of
// ECONNREFUSED on every dev-server restart.
await new Promise((resolve) => {
  const check = setInterval(() => {
    if (backendReady) {
      clearInterval(check);
      resolve();
    }
  }, 200);
});

const frontend = runDevProcess('@mechanization/frontend');
frontend.on('exit', (code) => process.exit(code ?? 0));
