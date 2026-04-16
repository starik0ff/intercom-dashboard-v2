// Manual status override for a conversation. Admin-only.
//
// POST  /api/conversation/{id}/status  { status_bucket, note? }
//   — upsert override, set conversations.status_bucket=<value>, status_source='manual'
//
// DELETE /api/conversation/{id}/status
//   — remove override, recompute heuristic status, set status_source='heuristic'

import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { requireRole, authErrorResponse } from '@/lib/auth-server';
import { classifyStatus } from '@/lib/classify/status';
import { STATUS_BUCKETS, type StatusBucket } from '@/lib/filters/types';

export const dynamic = 'force-dynamic';

interface ConvRow {
  id: string;
  open: number;
  state: string | null;
  user_messages_count: number;
  admin_messages_count: number;
  last_user_message_at: number | null;
  last_admin_message_at: number | null;
  first_admin_reply_at: number | null;
}

function isStatusBucket(v: unknown): v is StatusBucket {
  return typeof v === 'string' && (STATUS_BUCKETS as readonly string[]).includes(v);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRole('admin');
    const { id } = await params;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const statusBucket = b.status_bucket;
    const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;

    if (!isStatusBucket(statusBucket)) {
      return Response.json(
        { error: 'status_bucket must be one of ' + STATUS_BUCKETS.join(', ') },
        { status: 400 },
      );
    }

    const db = getDb();
    const exists = db
      .prepare(`SELECT id FROM conversations WHERE id = ?`)
      .get(id) as { id: string } | undefined;
    if (!exists) return Response.json({ error: 'not found' }, { status: 404 });

    const nowSec = Math.floor(Date.now() / 1000);
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO conversation_status_overrides
                 (conversation_id, status_bucket, set_by, set_at, note)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(conversation_id) DO UPDATE SET
            status_bucket = excluded.status_bucket,
            set_by        = excluded.set_by,
            set_at        = excluded.set_at,
            note          = excluded.note`,
      ).run(id, statusBucket, user.username, nowSec, note);

      db.prepare(
        `UPDATE conversations
            SET status_bucket = ?, status_source = 'manual'
          WHERE id = ?`,
      ).run(statusBucket, id);
    });
    tx();

    return Response.json({
      ok: true,
      conversation_id: id,
      status_bucket: statusBucket,
      status_source: 'manual',
      set_by: user.username,
      set_at: nowSec,
      note,
    });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole('admin');
    const { id } = await params;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });

    const db = getDb();
    const conv = db
      .prepare(
        `SELECT id, open, state,
                user_messages_count, admin_messages_count,
                last_user_message_at, last_admin_message_at, first_admin_reply_at
           FROM conversations
          WHERE id = ?`,
      )
      .get(id) as ConvRow | undefined;
    if (!conv) return Response.json({ error: 'not found' }, { status: 404 });

    // First user messages for keyword heuristic.
    const bodyRows = db
      .prepare(
        `SELECT body FROM messages
          WHERE conversation_id = ? AND author_type IN ('user','lead','contact')
          ORDER BY created_at ASC
          LIMIT 3`,
      )
      .all(id) as { body: string | null }[];
    const bodySample = bodyRows.map((b) => b.body || '').join(' ').slice(0, 2000);

    const stat = classifyStatus({
      open: !!conv.open,
      state: conv.state,
      user_messages_count: conv.user_messages_count,
      admin_messages_count: conv.admin_messages_count,
      last_user_message_at: conv.last_user_message_at,
      last_admin_message_at: conv.last_admin_message_at,
      first_admin_reply_at: conv.first_admin_reply_at,
      body_sample: bodySample,
      manual_override: null,
    });

    const tx = db.transaction(() => {
      db.prepare(
        `DELETE FROM conversation_status_overrides WHERE conversation_id = ?`,
      ).run(id);
      db.prepare(
        `UPDATE conversations
            SET status_bucket = ?, status_source = 'heuristic'
          WHERE id = ?`,
      ).run(stat.bucket, id);
    });
    tx();

    return Response.json({
      ok: true,
      conversation_id: id,
      status_bucket: stat.bucket,
      status_source: 'heuristic',
      reason: stat.reason,
    });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
