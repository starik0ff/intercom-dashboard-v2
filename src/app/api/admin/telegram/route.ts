/**
 * CRUD for admin → Telegram chat ID mappings.
 * Admin-only. Used to configure which managers receive Telegram notifications.
 */

import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { requireRole, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireRole('admin');
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT t.admin_id, t.telegram_chat_id, t.username, t.created_at,
                a.name AS admin_name, a.email AS admin_email
           FROM admin_telegram t
           LEFT JOIN admins a ON a.id = t.admin_id
          ORDER BY a.name`,
      )
      .all();
    return Response.json({ mappings: rows });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole('admin');
    const body = await req.json();
    const { admin_id, telegram_chat_id, username } = body as {
      admin_id?: string;
      telegram_chat_id?: string;
      username?: string;
    };
    if (!admin_id || !telegram_chat_id) {
      return Response.json(
        { error: 'admin_id and telegram_chat_id required' },
        { status: 400 },
      );
    }
    const db = getDb();
    db.prepare(
      `INSERT INTO admin_telegram (admin_id, telegram_chat_id, username)
       VALUES (?, ?, ?)
       ON CONFLICT(admin_id) DO UPDATE SET
         telegram_chat_id = excluded.telegram_chat_id,
         username = excluded.username`,
    ).run(String(admin_id), String(telegram_chat_id), username || null);
    return Response.json({ ok: true, admin_id, telegram_chat_id });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireRole('admin');
    const body = await req.json();
    const { admin_id } = body as { admin_id?: string };
    if (!admin_id) {
      return Response.json({ error: 'admin_id required' }, { status: 400 });
    }
    const db = getDb();
    db.prepare('DELETE FROM admin_telegram WHERE admin_id = ?').run(
      String(admin_id),
    );
    return Response.json({ ok: true, deleted: admin_id });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
