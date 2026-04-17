// Shared export logic used by both the streaming API route and the background worker.

import { getDb } from '@/lib/db/client';
import { buildConversationsWhere } from '@/lib/filters/sql';
import { parseFiltersFromObj } from '@/lib/api-helpers';

export interface ExportFilters {
  period: string;
  from?: number | null;
  to?: number | null;
  sources?: string[];
  statuses?: string[];
  q?: string;
  admin_id?: string;
  date_field?: string;
}

export interface Row {
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

export interface MessageRow {
  conversation_id: string;
  created_at: number;
  author_type: string | null;
  author_id: string | null;
  body: string | null;
}

export const CSV_HEADER = [
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

const MAX_ROWS = 100_000;

export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\n';
}

export function intercomUrl(id: string): string {
  return `https://app.intercom.com/a/inbox/_/inbox/conversation/${id}`;
}

export function isoOrEmpty(unix: number | null): string {
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

export function resolveDateField(raw: string | undefined): 'created_at' | 'updated_at' | 'last_message_at' {
  if (raw === 'updated_at' || raw === 'last_message_at') return raw;
  return 'created_at';
}

/** Query all matching conversation rows for export. */
export function queryExportRows(filters: ExportFilters): Row[] {
  const dateField = resolveDateField(filters.date_field);
  const parsed = parseFiltersFromObj({
    period: filters.period,
    from: filters.from ?? null,
    to: filters.to ?? null,
    sources: filters.sources || [],
    statuses: filters.statuses || [],
  });
  const frag = buildConversationsWhere(parsed, { alias: 'c', timeColumn: dateField });

  const extraConds: string[] = [];
  const extraParams: unknown[] = [];
  if (filters.admin_id) {
    extraConds.push('c.admin_assignee_id = ?');
    extraParams.push(filters.admin_id);
  }
  if (filters.q?.trim()) {
    const ids = candidateIdsFromFts(filters.q);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    extraConds.push(`c.id IN (${placeholders})`);
    extraParams.push(...ids);
  }

  const where = [frag.where, extraConds.join(' AND ')]
    .filter(Boolean)
    .join(' AND ');
  const whereSql = where ? `WHERE ${where}` : '';

  const orderExpr = dateField === 'last_message_at'
    ? 'MAX(COALESCE(c.last_user_message_at, 0), COALESCE(c.last_admin_message_at, 0))'
    : `c.${dateField}`;

  const db = getDb();
  return db
    .prepare(
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
        ORDER BY ${orderExpr} DESC
        LIMIT ?`,
    )
    .all(...frag.params, ...extraParams, MAX_ROWS) as Row[];
}

/** Load messages for a batch of conversation IDs in one query. */
export function loadMessagesBatch(ids: string[]): Map<string, MessageRow[]> {
  const result = new Map<string, MessageRow[]>();
  for (const id of ids) result.set(id, []);
  if (ids.length === 0) return result;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT conversation_id, created_at, author_type, author_id, body
         FROM messages
        WHERE conversation_id IN (${placeholders})
          AND body IS NOT NULL AND body != ''
        ORDER BY conversation_id, created_at ASC`,
    )
    .all(...ids) as MessageRow[];
  for (const r of rows) {
    result.get(r.conversation_id)!.push(r);
  }
  return result;
}

/** Load admin names for message author resolution. */
export function loadAdminNames(): Map<string, string> {
  const db = getDb();
  const names = new Map<string, string>();
  const admins = db.prepare('SELECT id, name FROM admins').all() as { id: string; name: string }[];
  for (const a of admins) names.set(a.id, a.name);
  return names;
}

export function resolveRole(m: MessageRow, adminNames: Map<string, string>): string {
  let role = m.author_type || 'unknown';
  if ((role === 'admin' || role === 'bot') && m.author_id && adminNames.has(m.author_id)) {
    role = adminNames.get(m.author_id)!;
  } else if (role === 'user' || role === 'lead' || role === 'contact') {
    role = 'client';
  }
  return role;
}

export function formatMessageForCsv(m: MessageRow, adminNames: Map<string, string>): string {
  const time = isoOrEmpty(m.created_at);
  const role = resolveRole(m, adminNames);
  const text = (m.body || '').replace(/\r?\n/g, ' ');
  return `[${time}] ${role}: ${text}`;
}
