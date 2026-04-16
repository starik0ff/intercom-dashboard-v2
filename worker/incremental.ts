#!/usr/bin/env tsx
/**
 * Incremental sync worker.
 *
 * Searches Intercom conversations updated since the last successful run,
 * fetches detail for each, and upserts via the shared sync helper.
 *
 * Variant C for first_team_assignee_id: the upsert SQL only overwrites the
 * stored first_team_assignee_id when a strictly earlier assignment timestamp
 * is observed (or when the existing value is null) — so re-reading the
 * detail of an old conversation never clobbers a known-good first assignment.
 *
 * Usage:
 *   npx tsx worker/incremental.ts                # one pass
 *   LOOKBACK_SECONDS=600 npx tsx worker/incremental.ts
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import { getDb } from '../src/lib/db/client';
import {
  iterateConversations,
  getConversation,
  listAdmins,
  listTeams,
} from '../src/lib/intercom/client';
import {
  upsertConversation,
  recordSyncError,
  setSyncState,
  getSyncState,
  type IcConv,
} from '../src/lib/db/sync';

const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;
// Re-fetch a small overlap window so we don't miss conversations whose
// updated_at is exactly equal to the cursor.
const OVERLAP_SECONDS = 30;
// On first run with no cursor, fall back to LOOKBACK_SECONDS or 1h.
const LOOKBACK_SECONDS = process.env.LOOKBACK_SECONDS
  ? parseInt(process.env.LOOKBACK_SECONDS, 10)
  : 3600;
const MAX_ERRORS = 200;

export interface IncrementalResult {
  processed: number;
  errors: number;
  fromTs: number;
  toTs: number;
  durationMs: number;
}

async function refreshAdminsTeams() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  try {
    const admins = await listAdmins<{ id: string; name?: string; email?: string; has_inbox_seat?: boolean; away_mode_enabled?: boolean }>();
    const upsertAdmin = db.prepare(
      `INSERT INTO admins (id, name, email, has_inbox_seat, away_mode, raw_json, updated_at)
       VALUES (@id,@name,@email,@has_inbox_seat,@away_mode,@raw_json,@updated_at)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, email=excluded.email,
         has_inbox_seat=excluded.has_inbox_seat, away_mode=excluded.away_mode,
         raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
    );
    for (const a of admins.admins || []) {
      upsertAdmin.run({
        id: String(a.id),
        name: a.name ?? null,
        email: a.email ?? null,
        has_inbox_seat: a.has_inbox_seat ? 1 : 0,
        away_mode: a.away_mode_enabled ? 1 : 0,
        raw_json: JSON.stringify(a),
        updated_at: now,
      });
    }
  } catch (err) {
    recordSyncError(db, 'admins', null, err);
  }

  try {
    const teams = await listTeams<{ id: string; name?: string }>();
    const upsertTeam = db.prepare(
      `INSERT INTO teams (id, name, raw_json, updated_at)
       VALUES (@id,@name,@raw_json,@updated_at)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
    );
    for (const t of teams.teams || []) {
      upsertTeam.run({
        id: String(t.id),
        name: t.name ?? null,
        raw_json: JSON.stringify(t),
        updated_at: now,
      });
    }
  } catch (err) {
    recordSyncError(db, 'teams', null, err);
  }
}

export async function runIncremental(): Promise<IncrementalResult> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const t0 = Date.now();

  await refreshAdminsTeams();

  const cursorRaw = getSyncState(db, 'incremental_cursor');
  const fromTs = cursorRaw
    ? Math.max(0, parseInt(cursorRaw, 10) - OVERLAP_SECONDS)
    : now - LOOKBACK_SECONDS;

  const query = {
    operator: 'AND',
    value: [{ field: 'updated_at', operator: '>', value: fromTs }],
  };

  let processed = 0;
  let errors = 0;
  const inflight = new Set<Promise<void>>();

  async function processOne(convId: string) {
    try {
      const conv = await getConversation<IcConv>(convId, 'plaintext');
      upsertConversation(db, conv, { fetchedAt: now });
      processed++;
    } catch (err) {
      errors++;
      recordSyncError(db, 'incremental', convId, err);
    }
  }

  function spawn(id: string) {
    const p = processOne(id).finally(() => inflight.delete(p));
    inflight.add(p);
  }

  for await (const summary of iterateConversations<{ id: string }>({
    query,
    per_page: 150,
  })) {
    if (errors > MAX_ERRORS) break;
    spawn(String(summary.id));
    while (inflight.size >= CONCURRENCY) {
      await Promise.race(inflight);
    }
  }
  await Promise.all(inflight);

  // Advance cursor only on success-ish runs (errors didn't trip the limit).
  if (errors <= MAX_ERRORS) {
    setSyncState(db, 'incremental_cursor', String(now));
    setSyncState(db, 'incremental_last_run_at', String(now));
    setSyncState(db, 'incremental_last_processed', String(processed));
    setSyncState(db, 'incremental_last_errors', String(errors));
  }

  return {
    processed,
    errors,
    fromTs,
    toTs: now,
    durationMs: Date.now() - t0,
  };
}

// Entry point when invoked directly. tsx may rewrite paths, so compare basenames.
const entryArg = process.argv[1] || '';
const isDirect =
  import.meta.url.endsWith('/worker/incremental.ts') &&
  (entryArg.endsWith('/worker/incremental.ts') || entryArg.endsWith('incremental.ts'));
if (isDirect) {
  runIncremental()
    .then((r) => {
      console.log(
        `incremental: processed=${r.processed} errors=${r.errors} from=${new Date(r.fromTs * 1000).toISOString()} to=${new Date(r.toTs * 1000).toISOString()} elapsed=${(r.durationMs / 1000).toFixed(1)}s`,
      );
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
