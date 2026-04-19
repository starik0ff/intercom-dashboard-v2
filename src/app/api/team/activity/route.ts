import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { withAuth, parseFilters } from '@/lib/api-helpers';
import { resolveFilters } from '@/lib/filters/url';

export const dynamic = 'force-dynamic';

const GAP_THRESHOLD = 600;  // 10 minutes in seconds
const SESSION_BUFFER = 300; // 5 minutes per session
const MIN_SINGLE_MSG = 300; // 5 minutes for a lone message

interface MsgRow {
  author_id: string;
  created_at: number;
}

interface AdminRow {
  id: string;
  name: string | null;
  email: string | null;
}

/** Format unix timestamp to HH:MM in Moscow (UTC+3). */
function toMoscowTime(ts: number): string {
  const d = new Date((ts + 3 * 3600) * 1000);
  return d.toISOString().slice(11, 16);
}

/** Compute active minutes from sorted timestamps using session algorithm. */
function computeActiveMinutes(timestamps: number[]): number {
  if (timestamps.length === 0) return 0;
  if (timestamps.length === 1) return MIN_SINGLE_MSG / 60;

  let totalSeconds = 0;
  let sessionStart = timestamps[0];
  let sessionEnd = timestamps[0];

  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - sessionEnd;
    if (gap <= GAP_THRESHOLD) {
      sessionEnd = timestamps[i];
    } else {
      // Close previous session
      const duration = sessionEnd - sessionStart + SESSION_BUFFER;
      totalSeconds += Math.max(duration, MIN_SINGLE_MSG);
      sessionStart = timestamps[i];
      sessionEnd = timestamps[i];
    }
  }
  // Close last session
  const duration = sessionEnd - sessionStart + SESSION_BUFFER;
  totalSeconds += Math.max(duration, MIN_SINGLE_MSG);

  return Math.round(totalSeconds / 60);
}

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const filters = parseFilters(req);
    const { from, to } = resolveFilters(filters);
    const db = getDb();

    // Build time filter for messages table
    const conds: string[] = ["m.author_type = 'admin'", "m.part_type = 'comment'"];
    const params: unknown[] = [];

    if (from != null) {
      conds.push('m.created_at >= ?');
      params.push(from);
    }
    if (to != null) {
      conds.push('m.created_at <= ?');
      params.push(to);
    }

    const where = `WHERE ${conds.join(' AND ')}`;

    // Today bounds (Moscow UTC+3)
    const nowMs = Date.now();
    const moscowOffset = 3 * 3600;
    const todayStartUtc = Math.floor(nowMs / 1000) - ((Math.floor(nowMs / 1000) + moscowOffset) % 86400);
    const todayEndUtc = todayStartUtc + 86400 - 1;

    // All admin messages in period, ordered by author + time
    const messages = db
      .prepare(
        `SELECT m.author_id, m.created_at
           FROM messages m
           ${where}
          ORDER BY m.author_id, m.created_at`,
      )
      .all(...params) as MsgRow[];

    // Today's messages for count, active minutes, and working hours
    const todayMsgs = db
      .prepare(
        `SELECT m.author_id, m.created_at
           FROM messages m
          WHERE m.author_type = 'admin' AND m.part_type = 'comment'
            AND m.created_at >= ? AND m.created_at <= ?
          ORDER BY m.author_id, m.created_at`,
      )
      .all(todayStartUtc, todayEndUtc) as MsgRow[];

    // Group today messages by admin
    const todayByAdmin = new Map<string, number[]>();
    for (const m of todayMsgs) {
      let arr = todayByAdmin.get(m.author_id);
      if (!arr) {
        arr = [];
        todayByAdmin.set(m.author_id, arr);
      }
      arr.push(m.created_at);
    }

    // Group period messages by admin
    const byAdmin = new Map<string, number[]>();
    for (const m of messages) {
      let arr = byAdmin.get(m.author_id);
      if (!arr) {
        arr = [];
        byAdmin.set(m.author_id, arr);
      }
      arr.push(m.created_at);
    }

    // Count distinct active days per admin
    const activeDaysRows = db
      .prepare(
        `SELECT m.author_id,
                COUNT(DISTINCT date(m.created_at, 'unixepoch', '+3 hours')) AS active_days
           FROM messages m
           ${where}
          GROUP BY m.author_id`,
      )
      .all(...params) as { author_id: string; active_days: number }[];

    const activeDaysMap = new Map(activeDaysRows.map((r) => [r.author_id, r.active_days]));

    // Get admin info
    const adminIds = [...byAdmin.keys()];
    const admins = adminIds.length
      ? (db
          .prepare(
            `SELECT id, name, email FROM admins WHERE id IN (${adminIds.map(() => '?').join(',')})`,
          )
          .all(...adminIds) as AdminRow[])
      : [];
    const adminMap = new Map(admins.map((a) => [a.id, a]));

    // Build result
    const items = adminIds.map((adminId) => {
      const timestamps = byAdmin.get(adminId)!;
      const totalMessages = timestamps.length;
      const activeDays = activeDaysMap.get(adminId) || 1;

      const todayTs = todayByAdmin.get(adminId) || [];

      return {
        admin_id: adminId,
        name: adminMap.get(adminId)?.name || null,
        today_messages: todayTs.length,
        today_active_minutes: computeActiveMinutes(todayTs),
        today_work_start: todayTs.length ? toMoscowTime(todayTs[0]) : null,
        today_work_end: todayTs.length ? toMoscowTime(todayTs[todayTs.length - 1]) : null,
        period_messages: totalMessages,
        period_active_minutes: computeActiveMinutes(timestamps),
        avg_daily_messages: Math.round((totalMessages / activeDays) * 10) / 10,
      };
    });

    // Sort by period_messages desc
    items.sort((a, b) => b.period_messages - a.period_messages);

    return Response.json({ items });
  })) as Response;
}
