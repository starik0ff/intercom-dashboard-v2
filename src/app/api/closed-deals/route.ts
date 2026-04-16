// List of conversations with status_bucket='closed_deal'.
// Ignores the `statuses` filter (always forces closed_deal).
// Honors period, sources, admin_id filters + pagination.

import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  created_at: number;
  updated_at: number;
  contact_name: string | null;
  contact_email: string | null;
  source_bucket: string;
  status_source: string;
  admin_assignee_id: string | null;
  admin_name: string | null;
  override_set_by: string | null;
  override_set_at: number | null;
  override_note: string | null;
}

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(sp.get('page_size') || '25', 10) || 25),
    );
    const adminId = sp.get('admin_id') || '';

    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters, {
      alias: 'c',
      ignoreStatuses: true,
    });

    const extraConds: string[] = [`c.status_bucket = 'closed_deal'`];
    const extraParams: unknown[] = [];
    if (adminId) {
      extraConds.push('c.admin_assignee_id = ?');
      extraParams.push(adminId);
    }

    const where = [frag.where, extraConds.join(' AND ')]
      .filter(Boolean)
      .join(' AND ');
    const whereSql = `WHERE ${where}`;
    const params = [...frag.params, ...extraParams];

    const db = getDb();

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM conversations c ${whereSql}`)
        .get(...params) as { n: number }
    ).n;

    const items = db
      .prepare(
        `SELECT c.id, c.created_at, c.updated_at,
                c.contact_name, c.contact_email,
                c.source_bucket, c.status_source,
                c.admin_assignee_id,
                a.name AS admin_name,
                o.set_by AS override_set_by,
                o.set_at AS override_set_at,
                o.note   AS override_note
           FROM conversations c
           LEFT JOIN admins a ON a.id = c.admin_assignee_id
           LEFT JOIN conversation_status_overrides o ON o.conversation_id = c.id
           ${whereSql}
          ORDER BY COALESCE(o.set_at, c.updated_at) DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as Row[];

    return Response.json({
      items: items.map((r) => ({
        conversation_id: r.id,
        created_at: r.created_at,
        updated_at: r.updated_at,
        contact_name: r.contact_name,
        contact_email: r.contact_email,
        source_bucket: r.source_bucket,
        status_source: r.status_source,
        admin_assignee_id: r.admin_assignee_id,
        admin_name: r.admin_name,
        override: r.override_set_by
          ? {
              set_by: r.override_set_by,
              set_at: r.override_set_at,
              note: r.override_note,
            }
          : null,
      })),
      total,
      page,
      page_size: pageSize,
    });
  })) as Response;
}
