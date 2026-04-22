/**
 * GET /api/admin/telegram/log — Telegram bot registration log.
 * Returns merged view: every /start user + their email + connection status.
 */

import { getDb } from '@/lib/db/client';
import { requireRole, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireRole('admin');
    const db = getDb();

    // Ensure table exists (may not exist yet if bot hasn't run on this DB)
    db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_bot_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at INTEGER NOT NULL DEFAULT (unixepoch()),
        chat_id     TEXT NOT NULL,
        tg_username TEXT,
        event       TEXT NOT NULL,
        admin_id    TEXT,
        admin_email TEXT,
        detail      TEXT
      );
    `);

    // For each unique chat_id that pressed /start, show:
    //   - telegram username
    //   - email they entered (if any)
    //   - current connection status
    const rows = db.prepare(`
      SELECT
        s.chat_id,
        s.tg_username,
        s.occurred_at AS started_at,
        e.admin_email,
        e.admin_id,
        a.name AS admin_name,
        CASE
          WHEN at2.admin_id IS NOT NULL THEN 'connected'
          WHEN r.chat_id IS NOT NULL AND r.step = 'await_code' THEN 'awaiting_code'
          WHEN r.chat_id IS NOT NULL AND r.step = 'await_admin_id' THEN 'awaiting_email'
          WHEN e.detail = 'not_found' THEN 'email_not_found'
          ELSE 'started'
        END AS status
      FROM (
        SELECT chat_id, tg_username, occurred_at,
               ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY occurred_at DESC) AS rn
        FROM telegram_bot_log
        WHERE event = 'start'
      ) s
      LEFT JOIN (
        SELECT chat_id, admin_email, admin_id, detail,
               ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY occurred_at DESC) AS rn
        FROM telegram_bot_log
        WHERE event = 'email_entered'
      ) e ON e.chat_id = s.chat_id AND e.rn = 1
      LEFT JOIN admins a ON a.id = e.admin_id
      LEFT JOIN admin_telegram at2 ON at2.telegram_chat_id = s.chat_id
      LEFT JOIN telegram_reg r ON r.chat_id = s.chat_id
      WHERE s.rn = 1
      ORDER BY s.occurred_at DESC
    `).all();

    return Response.json({ rows });
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
