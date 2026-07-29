#!/usr/bin/env node
// Starts Redis (if Docker is available) then runs backend + frontend together.
// Redis is an optional cache: if Docker isn't running, we skip it and the app
// falls through to Postgres — this script never blocks dev on Docker.
import { execSync, spawn } from 'node:child_process';

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (dockerAvailable()) {
  console.log('> starting redis (docker compose up -d redis)');
  try {
    execSync('docker compose up -d redis', { stdio: 'inherit' });
  } catch {
    console.warn('! failed to start redis — continuing without cache (falls through to Postgres)');
  }
} else {
  console.warn('! docker not running — skipping redis, app will fall through to Postgres');
}

console.log('> starting backend + frontend (pnpm dev)');
const dev = spawn('pnpm dev', { stdio: 'inherit', shell: true });
dev.on('exit', (code) => process.exit(code ?? 0));
