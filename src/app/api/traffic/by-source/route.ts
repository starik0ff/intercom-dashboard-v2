import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere, whereClause } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface Row { source_bucket: string; n: number }

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const filters = parseFilters(req);
    // For source pivot we ignore source filter (so user sees the full breakdown).
    const frag = buildConversationsWhere(filters, { ignoreSources: true });
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT source_bucket, COUNT(*) AS n
           FROM conversations
           ${whereClause(frag)}
          GROUP BY source_bucket
          ORDER BY n DESC`,
      )
      .all(...frag.params) as Row[];

    const total = rows.reduce((acc, r) => acc + r.n, 0);
    return Response.json({ total, items: rows });
  })) as Response;
}
