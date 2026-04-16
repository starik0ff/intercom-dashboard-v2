// Health checks for dashboard integrations and functionality.
// Each check returns { status, latency_ms, details } and is independently
// cheap enough to run on every request to /api/health/full.

import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db/client';
import { getSyncState } from '@/lib/db/sync';
import { listAdmins } from '@/lib/intercom/client';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  latency_ms: number;
  message: string;
  details?: Record<string, unknown>;
}

// Incremental worker runs every 15 min; warn if stale >30 min, fail >60 min.
const INCREMENTAL_WARN_SECS = 30 * 60;
const INCREMENTAL_FAIL_SECS = 60 * 60;
// Allow up to 100 sync errors / 24h before we warn; 500 → fail.
const SYNC_ERRORS_WARN = 100;
const SYNC_ERRORS_FAIL = 500;
// Max FTS row discrepancy (deleted messages can lag triggers briefly).
const FTS_DRIFT_WARN = 50;

async function timed<T>(fn: () => T | Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const r = await fn();
  return [r, Date.now() - t0];
}

export async function checkDatabase(): Promise<CheckResult> {
  try {
    const [row, ms] = await timed(() => {
      const db = getDb();
      return db.prepare('SELECT 1 AS ok').get() as { ok: number };
    });
    return {
      name: 'database',
      status: row?.ok === 1 ? 'ok' : 'fail',
      latency_ms: ms,
      message: row?.ok === 1 ? 'SQLite reachable' : 'unexpected response',
    };
  } catch (e) {
    return {
      name: 'database',
      status: 'fail',
      latency_ms: 0,
      message: `cannot open DB: ${(e as Error).message}`,
    };
  }
}

export async function checkTables(): Promise<CheckResult> {
  try {
    const [[convs, msgs, admins, teams], ms] = await timed(() => {
      const db = getDb();
      const convs = (db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n;
      const msgs = (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
      const admins = (db.prepare('SELECT COUNT(*) AS n FROM admins').get() as { n: number }).n;
      const teams = (db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n;
      return [convs, msgs, admins, teams] as const;
    });
    const status: CheckStatus =
      convs > 0 && msgs > 0 && admins > 0 ? 'ok' : convs > 0 ? 'warn' : 'fail';
    return {
      name: 'tables',
      status,
      latency_ms: ms,
      message: `conversations=${convs}, messages=${msgs}, admins=${admins}, teams=${teams}`,
      details: { conversations: convs, messages: msgs, admins, teams },
    };
  } catch (e) {
    return {
      name: 'tables',
      status: 'fail',
      latency_ms: 0,
      message: (e as Error).message,
    };
  }
}

export async function checkFts(): Promise<CheckResult> {
  try {
    const [[msgs, fts], ms] = await timed(() => {
      const db = getDb();
      const msgs = (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE body IS NOT NULL').get() as { n: number }).n;
      const fts = (db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n;
      return [msgs, fts] as const;
    });
    const drift = Math.abs(msgs - fts);
    const status: CheckStatus =
      drift === 0 ? 'ok' : drift <= FTS_DRIFT_WARN ? 'warn' : 'fail';
    return {
      name: 'fts',
      status,
      latency_ms: ms,
      message: `messages=${msgs}, fts=${fts}, drift=${drift}`,
      details: { messages: msgs, fts, drift },
    };
  } catch (e) {
    return {
      name: 'fts',
      status: 'fail',
      latency_ms: 0,
      message: (e as Error).message,
    };
  }
}

export async function checkBootstrap(): Promise<CheckResult> {
  try {
    const [raw, ms] = await timed(() => getSyncState(getDb(), 'bootstrap_completed_at'));
    if (!raw) {
      return {
        name: 'bootstrap',
        status: 'fail',
        latency_ms: ms,
        message: 'bootstrap_completed_at is not set — initial sync never finished',
      };
    }
    const completedAt = parseInt(raw, 10);
    return {
      name: 'bootstrap',
      status: 'ok',
      latency_ms: ms,
      message: `completed at ${new Date(completedAt * 1000).toISOString()}`,
      details: { completed_at: completedAt },
    };
  } catch (e) {
    return {
      name: 'bootstrap',
      status: 'fail',
      latency_ms: 0,
      message: (e as Error).message,
    };
  }
}

export async function checkIncremental(): Promise<CheckResult> {
  try {
    const [[lastRunRaw, lastErrorsRaw], ms] = await timed(() => {
      const db = getDb();
      return [
        getSyncState(db, 'incremental_last_run_at'),
        getSyncState(db, 'incremental_last_errors'),
      ] as const;
    });
    if (!lastRunRaw) {
      return {
        name: 'incremental',
        status: 'warn',
        latency_ms: ms,
        message: 'incremental worker has never run',
      };
    }
    const lastRun = parseInt(lastRunRaw, 10);
    const lastErrors = lastErrorsRaw ? parseInt(lastErrorsRaw, 10) : 0;
    const ageSec = Math.floor(Date.now() / 1000) - lastRun;
    let status: CheckStatus =
      ageSec > INCREMENTAL_FAIL_SECS ? 'fail' : ageSec > INCREMENTAL_WARN_SECS ? 'warn' : 'ok';
    if (lastErrors > 0 && status === 'ok') status = 'warn';
    return {
      name: 'incremental',
      status,
      latency_ms: ms,
      message: `last run ${Math.round(ageSec / 60)} min ago, errors=${lastErrors}`,
      details: { last_run_at: lastRun, age_sec: ageSec, last_errors: lastErrors },
    };
  } catch (e) {
    return {
      name: 'incremental',
      status: 'fail',
      latency_ms: 0,
      message: (e as Error).message,
    };
  }
}

export async function checkSyncErrors(): Promise<CheckResult> {
  try {
    const [count, ms] = await timed(() => {
      const db = getDb();
      const since = Math.floor(Date.now() / 1000) - 86400;
      return (db.prepare('SELECT COUNT(*) AS n FROM sync_errors WHERE occurred_at > ?').get(since) as { n: number }).n;
    });
    const status: CheckStatus =
      count >= SYNC_ERRORS_FAIL ? 'fail' : count >= SYNC_ERRORS_WARN ? 'warn' : 'ok';
    return {
      name: 'sync_errors_24h',
      status,
      latency_ms: ms,
      message: `${count} errors in last 24h`,
      details: { count },
    };
  } catch (e) {
    return {
      name: 'sync_errors_24h',
      status: 'fail',
      latency_ms: 0,
      message: (e as Error).message,
    };
  }
}

export async function checkEnv(): Promise<CheckResult> {
  const missing: string[] = [];
  if (!process.env.INTERCOM_TOKEN) missing.push('INTERCOM_TOKEN');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16)
    missing.push('SESSION_SECRET (≥16 chars)');
  return {
    name: 'env',
    status: missing.length === 0 ? 'ok' : 'fail',
    latency_ms: 0,
    message: missing.length === 0 ? 'all env vars set' : `missing: ${missing.join(', ')}`,
    details: { missing },
  };
}

export async function checkUsersFile(): Promise<CheckResult> {
  try {
    const [stat, ms] = await timed(() => {
      const p = path.resolve(process.cwd(), 'credentials', 'users.json');
      const buf = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(buf) as unknown;
      // users.json is an object { username: { hash, role, ... } }.
      const count =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.keys(parsed as Record<string, unknown>).length
          : Array.isArray(parsed)
          ? parsed.length
          : 0;
      return { count };
    });
    return {
      name: 'users_file',
      status: stat.count > 0 ? 'ok' : 'fail',
      latency_ms: ms,
      message: `${stat.count} users in credentials/users.json`,
      details: stat,
    };
  } catch (e) {
    return {
      name: 'users_file',
      status: 'fail',
      latency_ms: 0,
      message: `cannot read credentials/users.json: ${(e as Error).message}`,
    };
  }
}

// Worker process check: reads data/worker.lock (pidfile) and the
// worker_started_at sync_state row. Distinguishes "never started",
// "stale pid (crashed)", and "alive".
export async function checkWorkerProcess(): Promise<CheckResult> {
  const lockFile =
    process.env.WORKER_LOCK_FILE || path.join(process.cwd(), 'data', 'worker.lock');
  try {
    const startedAtRaw = getSyncState(getDb(), 'worker_started_at');
    const startedAt = startedAtRaw ? parseInt(startedAtRaw, 10) : null;

    let pidfileExists = false;
    let pid: number | null = null;
    let alive = false;
    try {
      const raw = fs.readFileSync(lockFile, 'utf-8').trim();
      pidfileExists = true;
      pid = parseInt(raw, 10) || null;
      if (pid) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
    } catch {
      pidfileExists = false;
    }

    if (!startedAt && !pidfileExists) {
      return {
        name: 'worker_process',
        status: 'fail',
        latency_ms: 0,
        message: 'worker has never been started (no pidfile, no worker_started_at)',
        details: { lock_file: lockFile, pid, alive, started_at: startedAt },
      };
    }
    if (!alive) {
      return {
        name: 'worker_process',
        status: 'fail',
        latency_ms: 0,
        message: pidfileExists
          ? `stale pidfile (pid ${pid} not alive) — worker crashed`
          : 'worker_started_at is set but pidfile missing — worker exited',
        details: { lock_file: lockFile, pid, alive, started_at: startedAt },
      };
    }
    const uptimeSec = startedAt
      ? Math.floor(Date.now() / 1000) - startedAt
      : null;
    return {
      name: 'worker_process',
      status: 'ok',
      latency_ms: 0,
      message:
        uptimeSec != null
          ? `alive (pid ${pid}), uptime ${Math.floor(uptimeSec / 60)}m`
          : `alive (pid ${pid})`,
      details: { lock_file: lockFile, pid, alive, started_at: startedAt, uptime_sec: uptimeSec },
    };
  } catch (e) {
    return {
      name: 'worker_process',
      status: 'fail',
      latency_ms: 0,
      message: (e as Error).message,
    };
  }
}

export async function checkIntercomApi(): Promise<CheckResult> {
  try {
    const [res, ms] = await timed(async () => {
      // listAdmins is the cheapest authenticated endpoint we already use.
      const r = await listAdmins<{ id: string }>();
      return r.admins?.length ?? 0;
    });
    return {
      name: 'intercom_api',
      status: res > 0 ? 'ok' : 'warn',
      latency_ms: ms,
      message: res > 0 ? `reachable, ${res} admins returned` : 'reachable but no admins returned',
      details: { admins_count: res },
    };
  } catch (e) {
    return {
      name: 'intercom_api',
      status: 'fail',
      latency_ms: 0,
      message: `Intercom API error: ${(e as Error).message}`,
    };
  }
}

export function overallStatus(checks: CheckResult[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'ok';
}
