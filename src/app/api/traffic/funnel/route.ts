import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere, whereClause } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface CountRow { n: number }

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters, { ignoreStatuses: true });
    const db = getDb();
    const where = whereClause(frag);

    // 5-step funnel from raw conv state — does not depend on status_bucket.
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM conversations ${where}`)
        .get(...frag.params) as CountRow
    ).n;

    const withFirstReply = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM conversations
             ${where} ${where ? 'AND' : 'WHERE'} first_admin_reply_at IS NOT NULL`,
        )
        .get(...frag.params) as CountRow
    ).n;

    const closed = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM conversations
             ${where} ${where ? 'AND' : 'WHERE'} (open = 0 OR state = 'closed')`,
        )
        .get(...frag.params) as CountRow
    ).n;

    const closedDeal = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM conversations
             ${where} ${where ? 'AND' : 'WHERE'} status_bucket = 'closed_deal'`,
        )
        .get(...frag.params) as CountRow
    ).n;

    const noReply = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM conversations
             ${where} ${where ? 'AND' : 'WHERE'} status_bucket = 'no_reply'`,
        )
        .get(...frag.params) as CountRow
    ).n;

    return Response.json({
      stages: [
        { key: 'total', label: 'Всего диалогов', value: total },
        { key: 'first_reply', label: 'С первым ответом', value: withFirstReply },
        { key: 'closed', label: 'Закрыто', value: closed },
        { key: 'closed_deal', label: 'Closed Deal', value: closedDeal },
      ],
      no_reply: noReply,
    });
  })) as Response;
}
