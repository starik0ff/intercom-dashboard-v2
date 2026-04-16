// Export conversations matching v2 filters.
//
// Reuses the streaming CSV/JSON pattern from the legacy export but queries
// SQLite with the v2 filter contract (period/sources/statuses + optional q
// FTS + admin_id). One row per conversation.
//
//   GET /api/export?format=csv|json&q=...&admin_id=...&period=30d&...

import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere } from '@/lib/filters/sql';
import { requireUser, authErrorResponse } from '@/lib/auth-server';
import { parseFilters } from '@/lib/api-helpers';
import { logActivity } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Safety cap — same order of magnitude as legacy (100000) but SQLite has no
// real ceiling. Streaming keeps memory flat regardless.
const MAX_ROWS = 100_000;

interface Row {
  id: string;
  created_at: number;
  updated_at: number;
  state: string | null;
  open: number;
  source_bucket: string;
  status_bucket: string;
  status_source: string;
  source_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  admin_name: string | null;
  team_name: string | null;
  parts_count: number;
  user_messages_count: number;
  admin_messages_count: number;
  first_response_seconds: number | null;
}

interface MessageRow {
  created_at: number;
  author_type: string | null;
  author_id: string | null;
  body: string | null;
}

const CSV_HEADER = [
  'conversation_id',
  'created_at',
  'updated_at',
  'state',
  'source_bucket',
  'status_bucket',
  'status_source',
  'contact_name',
  'contact_email',
  'admin_name',
  'team_name',
  'parts_count',
  'user_messages',
  'admin_messages',
  'first_response_seconds',
  'source_url',
  'intercom_url',
  'messages',
];

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\n';
}

function intercomUrl(id: string): string {
  return `https://app.intercom.com/a/inbox/_/inbox/conversation/${id}`;
}

function isoOrEmpty(unix: number | null): string {
  return unix ? new Date(unix * 1000).toISOString() : '';
}

function buildFtsMatch(q: string): string | null {
  const cleaned = q.replace(/["()*:^]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

function candidateIdsFromFts(q: string): string[] {
  const match = buildFtsMatch(q);
  if (!match) return [];
  const db = getDb();
  // Two-stage like /api/search: FTS alone, then map rowids → conversation_id.
  const hits = db
    .prepare(
      `SELECT rowid FROM messages_fts WHERE body MATCH ? ORDER BY bm25(messages_fts) ASC LIMIT ?`,
    )
    .all(match, MAX_ROWS) as { rowid: number }[];
  if (hits.length === 0) return [];
  const rowids = hits.map((h) => h.rowid);
  const placeholders = rowids.map(() => '?').join(',');
  const msgs = db
    .prepare(`SELECT DISTINCT conversation_id FROM messages WHERE rowid IN (${placeholders})`)
    .all(...rowids) as { conversation_id: string }[];
  return msgs.map((m) => m.conversation_id);
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }

  const sp = req.nextUrl.searchParams;
  const format = (sp.get('format') || 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'json') {
    return Response.json({ error: 'format must be csv or json' }, { status: 400 });
  }
  const q = sp.get('q') || '';
  const adminId = sp.get('admin_id') || '';
  const dateField = sp.get('date_field') === 'updated_at' ? 'updated_at' as const : 'created_at' as const;

  const filters = parseFilters(req);
  const frag = buildConversationsWhere(filters, { alias: 'c', timeColumn: dateField });

  const extraConds: string[] = [];
  const extraParams: unknown[] = [];
  if (adminId) {
    extraConds.push('c.admin_assignee_id = ?');
    extraParams.push(adminId);
  }

  if (q.trim()) {
    const ids = candidateIdsFromFts(q);
    if (ids.length === 0) {
      // Nothing matches — return empty stream.
      return emptyStream(format);
    }
    const placeholders = ids.map(() => '?').join(',');
    extraConds.push(`c.id IN (${placeholders})`);
    extraParams.push(...ids);
  }

  const where = [frag.where, extraConds.join(' AND ')]
    .filter(Boolean)
    .join(' AND ');
  const whereSql = where ? `WHERE ${where}` : '';

  const db = getDb();
  const stmt = db.prepare(
    `SELECT c.id, c.created_at, c.updated_at, c.state, c.open,
            c.source_bucket, c.status_bucket, c.status_source, c.source_url,
            c.contact_name, c.contact_email,
            a.name AS admin_name, t.name AS team_name,
            c.parts_count, c.user_messages_count, c.admin_messages_count,
            c.first_response_seconds
       FROM conversations c
       LEFT JOIN admins a ON a.id = c.admin_assignee_id
       LEFT JOIN teams  t ON t.id = c.team_assignee_id
       ${whereSql}
      ORDER BY c.created_at DESC
      LIMIT ?`,
  );
  const iter = stmt.iterate(...frag.params, ...extraParams, MAX_ROWS) as IterableIterator<Row>;

  // Prepare messages query (for conversation transcript)
  const msgStmt = db.prepare(
    `SELECT created_at, author_type, author_id, body
       FROM messages
      WHERE conversation_id = ? AND body IS NOT NULL AND body != ''
      ORDER BY created_at ASC`,
  );

  // Admin name cache for message authors
  const adminNames = new Map<string, string>();
  const adminsAll = db
    .prepare('SELECT id, name FROM admins')
    .all() as { id: string; name: string }[];
  for (const a of adminsAll) adminNames.set(a.id, a.name);

  function getMessages(convId: string): MessageRow[] {
    return msgStmt.all(convId) as MessageRow[];
  }

  function formatMessageForCsv(m: MessageRow): string {
    const time = isoOrEmpty(m.created_at);
    let role = m.author_type || 'unknown';
    if ((role === 'admin' || role === 'bot') && m.author_id && adminNames.has(m.author_id)) {
      role = adminNames.get(m.author_id)!;
    } else if (role === 'user' || role === 'lead' || role === 'contact') {
      role = 'client';
    }
    const text = (m.body || '').replace(/\r?\n/g, ' ');
    return `[${time}] ${role}: ${text}`;
  }

  const encoder = new TextEncoder();
  const filename = `conversations_${filters.period}_${Date.now()}`;

  let count = 0;
  const stream = new ReadableStream({
    start(controller) {
      try {
        if (format === 'csv') {
          controller.enqueue(encoder.encode('\uFEFF' + csvRow(CSV_HEADER)));
          for (const r of iter) {
            count++;
            const msgs = getMessages(r.id);
            const transcript = msgs.map(formatMessageForCsv).join(' | ');
            controller.enqueue(
              encoder.encode(
                csvRow([
                  r.id,
                  isoOrEmpty(r.created_at),
                  isoOrEmpty(r.updated_at),
                  r.open ? 'open' : 'closed',
                  r.source_bucket,
                  r.status_bucket,
                  r.status_source,
                  r.contact_name,
                  r.contact_email,
                  r.admin_name,
                  r.team_name,
                  r.parts_count,
                  r.user_messages_count,
                  r.admin_messages_count,
                  r.first_response_seconds,
                  r.source_url,
                  intercomUrl(r.id),
                  transcript,
                ]),
              ),
            );
          }
        } else {
          controller.enqueue(encoder.encode('[\n'));
          let first = true;
          for (const r of iter) {
            count++;
            const msgs = getMessages(r.id);
            const obj = {
              conversation_id: r.id,
              created_at: isoOrEmpty(r.created_at),
              updated_at: isoOrEmpty(r.updated_at),
              state: r.open ? 'open' : 'closed',
              source_bucket: r.source_bucket,
              status_bucket: r.status_bucket,
              status_source: r.status_source,
              contact_name: r.contact_name,
              contact_email: r.contact_email,
              admin_name: r.admin_name,
              team_name: r.team_name,
              parts_count: r.parts_count,
              user_messages_count: r.user_messages_count,
              admin_messages_count: r.admin_messages_count,
              first_response_seconds: r.first_response_seconds,
              source_url: r.source_url,
              intercom_url: intercomUrl(r.id),
              messages: msgs.map((m) => ({
                timestamp: isoOrEmpty(m.created_at),
                role: (m.author_type === 'user' || m.author_type === 'lead' || m.author_type === 'contact')
                  ? 'client'
                  : (m.author_id && adminNames.has(m.author_id) ? adminNames.get(m.author_id) : m.author_type),
                text: m.body,
              })),
            };
            controller.enqueue(
              encoder.encode((first ? '' : ',\n') + JSON.stringify(obj)),
            );
            first = false;
          }
          controller.enqueue(encoder.encode('\n]\n'));
        }
        controller.close();
        logActivity(user.username, user.role, 'export', {
          format,
          q: q || null,
          admin_id: adminId || null,
          period: filters.period,
          sources: filters.sources,
          statuses: filters.statuses,
          count,
        });
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.${format}"`,
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-store',
    },
  });
}

function emptyStream(format: string): Response {
  const encoder = new TextEncoder();
  const body =
    format === 'csv'
      ? '\uFEFF' + CSV_HEADER.map((h) => `"${h}"`).join(',') + '\n'
      : '[]\n';
  return new Response(encoder.encode(body), {
    headers: {
      'Content-Type':
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="conversations_empty.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}
