import { getDb } from '@/lib/db/client';
import { getSyncState } from '@/lib/db/sync';
import { requireUser, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

interface CountRow { n: number }
interface ErrRow { id: number; occurred_at: number; scope: string; conversation_id: string | null; status_code: number | null; message: string }

export async function GET() {
  try {
    await requireUser();
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const totalConvs = (db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as CountRow).n;
  const totalMessages = (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as CountRow).n;

  const errors24h = (
    db.prepare('SELECT COUNT(*) AS n FROM sync_errors WHERE occurred_at > ?').get(now - 86400) as CountRow
  ).n;
  const recentErrors = db
    .prepare('SELECT id, occurred_at, scope, conversation_id, status_code, message FROM sync_errors ORDER BY occurred_at DESC LIMIT 20')
    .all() as ErrRow[];

  const bootstrapCompletedAt = getSyncState(db, 'bootstrap_completed_at');
  const incrementalCursor = getSyncState(db, 'incremental_cursor');
  const incrementalLastRunAt = getSyncState(db, 'incremental_last_run_at');
  const incrementalLastProcessed = getSyncState(db, 'incremental_last_processed');
  const incrementalLastErrors = getSyncState(db, 'incremental_last_errors');
  const workerStartedAt = getSyncState(db, 'worker_started_at');

  const bySource = db
    .prepare('SELECT source_bucket, COUNT(*) AS n FROM conversations GROUP BY source_bucket ORDER BY n DESC')
    .all();
  const byStatus = db
    .prepare('SELECT status_bucket, COUNT(*) AS n FROM conversations GROUP BY status_bucket ORDER BY n DESC')
    .all();

  return Response.json({
    now,
    totals: { conversations: totalConvs, messages: totalMessages },
    bootstrap: {
      completed_at: bootstrapCompletedAt ? parseInt(bootstrapCompletedAt, 10) : null,
    },
    incremental: {
      cursor: incrementalCursor ? parseInt(incrementalCursor, 10) : null,
      last_run_at: incrementalLastRunAt ? parseInt(incrementalLastRunAt, 10) : null,
      last_processed: incrementalLastProcessed ? parseInt(incrementalLastProcessed, 10) : null,
      last_errors: incrementalLastErrors ? parseInt(incrementalLastErrors, 10) : null,
    },
    worker: {
      started_at: workerStartedAt ? parseInt(workerStartedAt, 10) : null,
    },
    errors: {
      last_24h: errors24h,
      recent: recentErrors,
    },
    by_source: bySource,
    by_status: byStatus,
  });
}
