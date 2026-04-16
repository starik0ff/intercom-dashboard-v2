import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere, whereClause } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface Row { source_url: string; n: number }

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip query + hash, keep host + path. Trim trailing slash for grouping.
    let path = u.pathname.replace(/\/+$/, '');
    if (!path) path = '/';
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters);
    const db = getDb();
    const where = whereClause(frag);

    const rows = db
      .prepare(
        `SELECT source_url, COUNT(*) AS n
           FROM conversations
           ${where} ${where ? 'AND' : 'WHERE'} source_url IS NOT NULL AND source_url != ''
          GROUP BY source_url`,
      )
      .all(...frag.params) as Row[];

    // Normalize and re-aggregate.
    const agg = new Map<string, number>();
    for (const r of rows) {
      const k = normalizeUrl(r.source_url);
      agg.set(k, (agg.get(k) ?? 0) + r.n);
    }
    const items = Array.from(agg.entries())
      .map(([url, n]) => ({ url, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 20);

    return Response.json({ items });
  })) as Response;
}
