import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere, whereClause, andClause } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface Row {
  admin_id: string;
  name: string | null;
  email: string | null;
  total: number;
  open_count: number;
  closed_count: number;
  no_reply_count: number;
  avg_frt: number | null;
  median_frt: number | null;
}

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters, { alias: 'c' });
    const db = getDb();
    const where = whereClause(frag);

    // Per-admin aggregates over conversations in the period.
    // We use admin_assignee_id as the assignee.
    const rows = db
      .prepare(
        `SELECT
            c.admin_assignee_id           AS admin_id,
            a.name                        AS name,
            a.email                       AS email,
            COUNT(*)                      AS total,
            SUM(CASE WHEN c.open = 1 THEN 1 ELSE 0 END)            AS open_count,
            SUM(CASE WHEN c.open = 0 THEN 1 ELSE 0 END)            AS closed_count,
            SUM(CASE WHEN c.status_bucket = 'no_reply' THEN 1 ELSE 0 END) AS no_reply_count,
            AVG(c.first_response_seconds) AS avg_frt
           FROM conversations c
           LEFT JOIN admins a ON a.id = c.admin_assignee_id
           ${where}
           ${where ? 'AND' : 'WHERE'} c.admin_assignee_id IS NOT NULL
                                  AND c.admin_assignee_id != ''
                                  AND c.admin_assignee_id != '0'
          GROUP BY c.admin_assignee_id
          ORDER BY total DESC`,
      )
      .all(...frag.params) as Row[];

    // Compute median FRT per admin (separate query — keeps SQL simple).
    const medianStmt = db.prepare(
      `SELECT c.first_response_seconds AS v FROM conversations c
        ${where} ${where ? 'AND' : 'WHERE'} c.admin_assignee_id = ?
                                          AND c.first_response_seconds IS NOT NULL
        ORDER BY c.first_response_seconds`,
    );

    for (const r of rows) {
      const vals = (medianStmt.all(...frag.params, r.admin_id) as { v: number }[]).map(
        (x) => x.v,
      );
      if (vals.length === 0) {
        r.median_frt = null;
      } else {
        const mid = Math.floor(vals.length / 2);
        r.median_frt =
          vals.length % 2 === 0 ? Math.round((vals[mid - 1] + vals[mid]) / 2) : vals[mid];
      }
      r.avg_frt = r.avg_frt != null ? Math.round(r.avg_frt) : null;
    }

    // Unassigned bucket (admin_assignee_id IS NULL/0) — sometimes important.
    const unassigned = db
      .prepare(
        `SELECT COUNT(*) AS n FROM conversations c
           ${where} ${where ? 'AND' : 'WHERE'} (c.admin_assignee_id IS NULL OR c.admin_assignee_id = '' OR c.admin_assignee_id = '0')`,
      )
      .get(...frag.params) as { n: number };

    return Response.json({ items: rows, unassigned: unassigned.n });
  })) as Response;
}
