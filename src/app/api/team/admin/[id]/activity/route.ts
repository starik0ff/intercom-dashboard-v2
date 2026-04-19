import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { withAuth, parseFilters } from '@/lib/api-helpers';
import { resolveFilters } from '@/lib/filters/url';

export const dynamic = 'force-dynamic';

const GAP_THRESHOLD = 600;  // 10 minutes
const SESSION_BUFFER = 300; // 5 minutes per session
const MIN_SINGLE_MSG = 300; // 5 minutes for a lone message

interface MsgRow {
  created_at: number;
}


/** Compute active minutes from sorted timestamps. */
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
      const duration = sessionEnd - sessionStart + SESSION_BUFFER;
      totalSeconds += Math.max(duration, MIN_SINGLE_MSG);
      sessionStart = timestamps[i];
      sessionEnd = timestamps[i];
    }
  }
  const duration = sessionEnd - sessionStart + SESSION_BUFFER;
  totalSeconds += Math.max(duration, MIN_SINGLE_MSG);

  return Math.round(totalSeconds / 60);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return (await withAuth(async () => {
    const { id } = await params;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });

    const filters = parseFilters(req);
    const { from, to } = resolveFilters(filters);
    const db = getDb();

    // Build time filter for messages
    const conds: string[] = [
      "m.author_type = 'admin'",
      "m.part_type = 'comment'",
      'm.author_id = ?',
    ];
    const baseParams: unknown[] = [id];

    if (from != null) {
      conds.push('m.created_at >= ?');
      baseParams.push(from);
    }
    if (to != null) {
      conds.push('m.created_at <= ?');
      baseParams.push(to);
    }

    const where = `WHERE ${conds.join(' AND ')}`;

    // Admin info
    const admin = db
      .prepare('SELECT id, name, email FROM admins WHERE id = ?')
      .get(id) as { id: string; name: string | null; email: string | null } | undefined;

    // All messages for this admin in period (sorted by time)
    const allMessages = db
      .prepare(
        `SELECT m.created_at FROM messages m ${where} ORDER BY m.created_at`,
      )
      .all(...baseParams) as MsgRow[];

    const timestamps = allMessages.map((r) => r.created_at);

    // Daily breakdown: messages + active minutes per day
    const dailyMsgRows = db
      .prepare(
        `SELECT date(m.created_at, 'unixepoch', '+3 hours') AS day,
                COUNT(*) AS messages
           FROM messages m
           ${where}
          GROUP BY day
          ORDER BY day`,
      )
      .all(...baseParams) as { day: string; messages: number }[];

    // For active minutes per day, group timestamps by day
    const byDay = new Map<string, number[]>();
    for (const ts of timestamps) {
      // Convert to Moscow date
      const d = new Date((ts + 3 * 3600) * 1000);
      const day = d.toISOString().slice(0, 10);
      let arr = byDay.get(day);
      if (!arr) {
        arr = [];
        byDay.set(day, arr);
      }
      arr.push(ts);
    }

    const daily = dailyMsgRows.map((r) => {
      const dayTs = byDay.get(r.day) || [];
      return {
        day: r.day,
        messages: r.messages,
        active_minutes: computeActiveMinutes(dayTs),
        work_start: dayTs.length ? dayTs[0] : null,
        work_end: dayTs.length ? dayTs[dayTs.length - 1] : null,
      };
    });

    // Hourly distribution (Moscow time, 0-23)
    const hourlyRows = db
      .prepare(
        `SELECT CAST(strftime('%H', m.created_at, 'unixepoch', '+3 hours') AS INTEGER) AS hour,
                COUNT(*) AS messages
           FROM messages m
           ${where}
          GROUP BY hour
          ORDER BY hour`,
      )
      .all(...baseParams) as { hour: number; messages: number }[];

    // Fill all 24 hours
    const hourlyMap = new Map(hourlyRows.map((r) => [r.hour, r.messages]));
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      messages: hourlyMap.get(h) || 0,
    }));

    // Totals
    const activeDays = dailyMsgRows.length;
    const totalMessages = timestamps.length;
    const totalActiveMinutes = computeActiveMinutes(timestamps);

    return Response.json({
      admin: admin ?? { id, name: null, email: null },
      daily,
      hourly,
      totals: {
        messages: totalMessages,
        active_minutes: totalActiveMinutes,
        active_days: activeDays,
        avg_daily_messages:
          activeDays > 0
            ? Math.round((totalMessages / activeDays) * 10) / 10
            : 0,
      },
    });
  })) as Response;
}
