#!/usr/bin/env tsx
/**
 * Long-running daemon: invokes runIncremental() on a fixed interval.
 *
 * Single-instance lock: a flock-style file lock under data/worker.lock so
 * systemd restarts and accidental double-launches don't run two copies.
 *
 * Env:
 *   SYNC_INTERVAL_MINUTES   default 15
 *   WORKER_LOCK_FILE        default data/worker.lock
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import fs from 'node:fs';
import path from 'node:path';
import { runIncremental } from './incremental';
import { getDb } from '../src/lib/db/client';
import { setSyncState } from '../src/lib/db/sync';

const INTERVAL_MIN = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15', 10);
const LOCK_FILE = process.env.WORKER_LOCK_FILE || path.join(process.cwd(), 'data', 'worker.lock');

function acquireLock(): number {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  let fd: number;
  try {
    fd = fs.openSync(LOCK_FILE, 'wx'); // exclusive create
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EEXIST') {
      // Check if the holder is alive.
      try {
        const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
        if (pid && processAlive(pid)) {
          throw new Error(`Worker already running (pid ${pid}); lock at ${LOCK_FILE}`);
        }
      } catch {
        /* fallthrough — stale lock */
      }
      fs.rmSync(LOCK_FILE);
      fd = fs.openSync(LOCK_FILE, 'wx');
    } else {
      throw err;
    }
  }
  fs.writeSync(fd, String(process.pid));
  return fd;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(fd: number) {
  try {
    fs.closeSync(fd);
    fs.rmSync(LOCK_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

async function main() {
  console.log(`worker: starting, interval=${INTERVAL_MIN}m, lock=${LOCK_FILE}`);
  const fd = acquireLock();

  let stopping = false;
  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    console.log('\nworker: shutting down');
    releaseLock(fd);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (err) => {
    console.error('worker: uncaughtException', err);
  });

  // Mark process start in sync_state for observability.
  try {
    setSyncState(getDb(), 'worker_started_at', String(Math.floor(Date.now() / 1000)));
  } catch (e) {
    console.error('worker: failed to mark start', e);
  }

  while (!stopping) {
    const t0 = Date.now();
    try {
      const r = await runIncremental();
      console.log(
        `[${new Date().toISOString()}] processed=${r.processed} errors=${r.errors} elapsed=${(r.durationMs / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      console.error('worker: incremental run failed', err);
    }
    if (stopping) break;
    const elapsedMs = Date.now() - t0;
    const sleepMs = Math.max(5_000, INTERVAL_MIN * 60_000 - elapsedMs);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

main().catch((e) => {
  console.error('worker: fatal', e);
  process.exit(1);
});
