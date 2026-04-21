// Paginated list of conversations matching v2 global filters.
// Powers the "Экспорт диалогов" view on the monitoring page — same filter
// contract as /api/export so the export buttons act on exactly the rows the
// user is currently looking at.
//
//   GET /api/conversations?period=30d&sources=...&statuses=...&page=1&page_size=50

import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  created_at: number;
  updated_at: number;
  open: number;
  state: string | null;
  source_bucket: string;
  status_bucket: string;
  status_source: string;
  contact_name: string | null;
  contact_email: string | null;
  admin_assignee_id: string | null;
  admin_name: string | null;
  team_name: string | null;
  parts_count: number;
  user_messages_count: number;
  admin_messages_count: number;
  first_response_seconds: number | null;
  source_url: string | null;
  last_user_message_at: number | null;
  last_admin_message_at: number | null;
}

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(sp.get('page_size') || '50', 10) || 50),
    );
    const adminId = sp.get('admin_id') || '';
    const dfRaw = sp.get('date_field') || 'created_at';
    const dateField = (['updated_at', 'last_message_at'] as const).includes(dfRaw as never)
      ? (dfRaw as 'updated_at' | 'last_message_at')
      : 'created_at' as const;

    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters, { alias: 'c', timeColumn: dateField });

    const extraConds: string[] = [];
    const extraParams: unknown[] = [];
    if (adminId) {
      extraConds.push('c.admin_assignee_id = ?');
      extraParams.push(adminId);
    }

    const where = [frag.where, extraConds.join(' AND ')]
      .filter(Boolean)
      .join(' AND ');
    const whereSql = where ? `WHERE ${where}` : '';

    const db = getDb();
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM conversations c ${whereSql}`)
        .get(...frag.params, ...extraParams) as { n: number }
    ).n;

    const offset = (page - 1) * pageSize;
    const rows = db
      .prepare(
        `SELECT c.id, c.created_at, c.updated_at, c.open, c.state,
                c.source_bucket, c.status_bucket, c.status_source,
                c.contact_name, c.contact_email,
                c.admin_assignee_id, a.name AS admin_name, t.name AS team_name,
                c.parts_count, c.user_messages_count, c.admin_messages_count,
                c.first_response_seconds, c.source_url,
                c.last_user_message_at, c.last_admin_message_at
           FROM conversations c
           LEFT JOIN admins a ON a.id = c.admin_assignee_id
           LEFT JOIN teams  t ON t.id = c.team_assignee_id
           ${whereSql}
          ORDER BY ${dateField === 'last_message_at' ? 'MAX(COALESCE(c.last_user_message_at, 0), COALESCE(c.last_admin_message_at, 0))' : `c.${dateField}`} DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...frag.params, ...extraParams, pageSize, offset) as Row[];

    return Response.json({
      items: rows,
      total,
      page,
      page_size: pageSize,
    });
  })) as Response;
}
