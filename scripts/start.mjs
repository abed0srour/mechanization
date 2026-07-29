#!/usr/bin/env node
// Starts Docker (if needed), then Redis, then runs backend + frontend together.
// Redis is an optional cache: if Docker can't be reached, we skip it and the
// app falls through to Postgres — this script never blocks dev on Docker.
//
// Nest/Next print hundreds of lines of routine startup noise (route mapping,
// dependency init, pnpm banners). We filter the dev process's output down to
// one "running on" line per service, and let real errors/warnings through
// unfiltered so problems are never hidden.
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const DOCKER_DESKTOP_PATH = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
const BACKEND_URL = 'http://localhost:4000/api/v1';
const ANSI_RE = /\x1b\[[0-9;]*m/g;

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
    console.log('> docker    running on Docker Desktop');
    return true;
  }

  if (process.platform !== 'win32' || !existsSync(DOCKER_DESKTOP_PATH)) {
    console.warn('! docker not running — skipping redis, app will fall through to Postgres');
    return false;
  }

  spawn(DOCKER_DESKTOP_PATH, { detached: true, stdio: 'ignore' }).unref();

  const timeoutMs = 90_000;
  const intervalMs = 3_000;
  for (let waited = 0; waited < timeoutMs; waited += intervalMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (dockerAvailable()) {
      console.log('> docker    running on Docker Desktop');
      return true;
    }
  }

  console.warn('! docker took too long to start — skipping redis, app will fall through to Postgres');
  return false;
}

if (await ensureDockerRunning()) {
  try {
    execSync('docker compose up -d redis', { stdio: 'ignore' });
    console.log('> redis     running on redis://localhost:6379');
  } catch {
    console.warn('! failed to start redis — continuing without cache (falls through to Postgres)');
  }
}

let backendReady = false;
let frontendLocalShown = false;
let frontendNetworkShown = false;

// Once an error/warning line matches, keep printing the lines right after it
// unfiltered too — that's where the actual stack trace lives, and dropping it
// (as this filter used to) means a real failure looks identical to silence.
let errorTailLinesRemaining = 0;
const ERROR_TAIL_LINES = 30;

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
    console.log(`> backend   running on ${BACKEND_URL}`);
    return;
  }
  const localMatch = !frontendLocalShown && line.match(/-\s*Local:\s*(\S+)/);
  if (localMatch) {
    frontendLocalShown = true;
    const base = localMatch[1];
    console.log(`> frontend  running on ${base} (local)`);
    // Matches the seeded albazourieh tenant (seed.ts) — dev convenience only.
    console.log(`> admin     login page at ${base}/albazourieh/ar/admin-portal-a91f/login`);
    console.log(`> citizens  page at ${base}/albazourieh/ar/admin-portal-a91f/citizens/{id}`);
    return;
  }
  const networkMatch = !frontendNetworkShown && line.match(/-\s*Network:\s*(\S+)/);
  if (networkMatch) {
    frontendNetworkShown = true;
    console.log(`> frontend  running on ${networkMatch[1]} (network)`);
    return;
  }
  if (/\bERROR\b|\bWARN\b|Error:|EADDRINUSE|Cannot find module|Failed to compile|Failed to start/.test(line)) {
    console.log(line);
    errorTailLinesRemaining = ERROR_TAIL_LINES;
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

const dev = spawn('pnpm dev', { stdio: ['inherit', 'pipe', 'pipe'], shell: true });
pipeLines(dev.stdout);
pipeLines(dev.stderr);
dev.on('exit', (code) => process.exit(code ?? 0));
