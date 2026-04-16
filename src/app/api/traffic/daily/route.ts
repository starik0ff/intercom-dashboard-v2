import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere, whereClause } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface Row { day: string; source_bucket: string; n: number }

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters);
    const db = getDb();
    // Bucket by Moscow-time day.
    const rows = db
      .prepare(
        `SELECT date(created_at, 'unixepoch', '+3 hours') AS day,
                source_bucket,
                COUNT(*) AS n
           FROM conversations
           ${whereClause(frag)}
          GROUP BY day, source_bucket
          ORDER BY day ASC`,
      )
      .all(...frag.params) as Row[];

    // Pivot into [{day, telegram_boostyfi:.., facebook:.., total:..}]
    const byDay = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      let entry = byDay.get(r.day);
      if (!entry) {
        entry = { day: r.day, total: 0 };
        byDay.set(r.day, entry);
      }
      entry[r.source_bucket] = r.n;
      entry.total = (entry.total as number) + r.n;
    }
    return Response.json({ items: Array.from(byDay.values()) });
  })) as Response;
}
