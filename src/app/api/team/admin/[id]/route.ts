import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere, whereClause } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return (await withAuth(async () => {
    const { id } = await params;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });

    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters, { alias: 'c' });
    const db = getDb();
    const where = whereClause(frag);
    const adminWhere = `${where} ${where ? 'AND' : 'WHERE'} c.admin_assignee_id = ?`;
    const p = [...frag.params, id];

    // Admin info.
    const admin = db
      .prepare(`SELECT id, name, email FROM admins WHERE id = ?`)
      .get(id) as { id: string; name: string | null; email: string | null } | undefined;

    // Daily breakdown.
    const daily = db
      .prepare(
        `SELECT date(c.created_at, 'unixepoch', '+3 hours') AS day,
                COUNT(*) AS n,
                AVG(c.first_response_seconds) AS avg_frt
           FROM conversations c
           ${adminWhere}
          GROUP BY day
          ORDER BY day`,
      )
      .all(...p) as { day: string; n: number; avg_frt: number | null }[];

    // Status mix.
    const byStatus = db
      .prepare(
        `SELECT c.status_bucket, COUNT(*) AS n
           FROM conversations c
           ${adminWhere}
          GROUP BY c.status_bucket
          ORDER BY n DESC`,
      )
      .all(...p) as { status_bucket: string; n: number }[];

    // Source mix.
    const bySource = db
      .prepare(
        `SELECT c.source_bucket, COUNT(*) AS n
           FROM conversations c
           ${adminWhere}
          GROUP BY c.source_bucket
          ORDER BY n DESC`,
      )
      .all(...p) as { source_bucket: string; n: number }[];

    // FRT distribution buckets (seconds).
    // 0-5m, 5-15m, 15-60m, 1-4h, 4-24h, >24h
    const frtBuckets = db
      .prepare(
        `SELECT
            SUM(CASE WHEN c.first_response_seconds < 300 THEN 1 ELSE 0 END)                              AS b1,
            SUM(CASE WHEN c.first_response_seconds >= 300 AND c.first_response_seconds < 900 THEN 1 ELSE 0 END)   AS b2,
            SUM(CASE WHEN c.first_response_seconds >= 900 AND c.first_response_seconds < 3600 THEN 1 ELSE 0 END)  AS b3,
            SUM(CASE WHEN c.first_response_seconds >= 3600 AND c.first_response_seconds < 14400 THEN 1 ELSE 0 END) AS b4,
            SUM(CASE WHEN c.first_response_seconds >= 14400 AND c.first_response_seconds < 86400 THEN 1 ELSE 0 END) AS b5,
            SUM(CASE WHEN c.first_response_seconds >= 86400 THEN 1 ELSE 0 END)                              AS b6
           FROM conversations c
           ${adminWhere} AND c.first_response_seconds IS NOT NULL`,
      )
      .get(...p) as Record<string, number>;

    // Totals.
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN c.open = 1 THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE WHEN c.open = 0 THEN 1 ELSE 0 END) AS closed_count,
                AVG(c.first_response_seconds) AS avg_frt
           FROM conversations c
           ${adminWhere}`,
      )
      .get(...p) as { total: number; open_count: number; closed_count: number; avg_frt: number | null };

    // Median FRT.
    const frtVals = (
      db
        .prepare(
          `SELECT c.first_response_seconds AS v FROM conversations c
             ${adminWhere} AND c.first_response_seconds IS NOT NULL
            ORDER BY c.first_response_seconds`,
        )
        .all(...p) as { v: number }[]
    ).map((x) => x.v);
    const medianFrt =
      frtVals.length === 0
        ? null
        : frtVals.length % 2 === 0
        ? Math.round((frtVals[frtVals.length / 2 - 1] + frtVals[frtVals.length / 2]) / 2)
        : frtVals[Math.floor(frtVals.length / 2)];

    return Response.json({
      admin: admin ?? { id, name: null, email: null },
      totals: {
        ...totals,
        avg_frt: totals.avg_frt != null ? Math.round(totals.avg_frt) : null,
        median_frt: medianFrt,
      },
      daily: daily.map((d) => ({
        day: d.day,
        n: d.n,
        avg_frt: d.avg_frt != null ? Math.round(d.avg_frt) : null,
      })),
      by_status: byStatus,
      by_source: bySource,
      frt_distribution: [
        { label: '<5 мин', n: frtBuckets.b1 ?? 0 },
        { label: '5–15 мин', n: frtBuckets.b2 ?? 0 },
        { label: '15–60 мин', n: frtBuckets.b3 ?? 0 },
        { label: '1–4 ч', n: frtBuckets.b4 ?? 0 },
        { label: '4–24 ч', n: frtBuckets.b5 ?? 0 },
        { label: '>24 ч', n: frtBuckets.b6 ?? 0 },
      ],
    });
  })) as Response;
}
