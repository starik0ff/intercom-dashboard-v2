// Shared upsert logic used by bootstrap + incremental workers.
// Both write through here so the schema/classification path stays in one place.

import type Database from 'better-sqlite3';
import { classifySource } from '../classify/source';
import { classifyStatus, type StatusBucket } from '../classify/status';

export interface IcContact {
  id?: string;
  type?: string;
  email?: string;
  name?: string;
  external_id?: string;
}

export interface IcPart {
  id?: string;
  part_type?: string;
  created_at?: number;
  body?: string;
  author?: { type?: string; id?: string };
  assigned_to?: { type?: string; id?: string };
}

export interface IcConv {
  id: string;
  created_at: number;
  updated_at: number;
  waiting_since?: number | null;
  snoozed_until?: number | null;
  open: boolean;
  state?: string;
  read?: boolean;
  priority?: string;
  contacts?: { contacts: IcContact[] };
  team_assignee_id?: number | string | null;
  admin_assignee_id?: number | string | null;
  source?: {
    type?: string;
    url?: string;
    subject?: string;
    delivered_as?: string;
    author?: { type?: string; id?: string };
    body?: string;
  };
  conversation_parts?: { conversation_parts: IcPart[]; total_count?: number };
  /** Intercom custom attributes dict, including the "Progress" field we use
   *  as the source-of-truth status. */
  custom_attributes?: Record<string, unknown> | null;
}

export function stripHtml(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export interface ConvMetrics {
  parts_count: number;
  user_messages_count: number;
  admin_messages_count: number;
  last_user_message_at: number | null;
  last_admin_message_at: number | null;
  first_admin_reply_at: number | null;
  first_response_seconds: number | null;
  first_team_assignee_id: string | null;
  first_team_assigned_at: number | null;
  body_sample: string;
}

export function computeMetrics(conv: IcConv): {
  metrics: ConvMetrics;
  messageRows: Array<Record<string, unknown>>;
} {
  const parts = conv.conversation_parts?.conversation_parts ?? [];
  let userCount = 0;
  let adminCount = 0;
  let lastUser: number | null = null;
  let lastAdmin: number | null = null;
  let firstAdmin: number | null = null;
  let firstTeam: string | null = null;
  let firstTeamAt: number | null = null;
  const bodyParts: string[] = [];

  const messageRows: Array<Record<string, unknown>> = [];
  if (conv.source?.body) {
    const text = stripHtml(conv.source.body);
    const authorType = conv.source.author?.type;
    if (authorType === 'user' || authorType === 'lead' || authorType === 'contact') {
      userCount++;
      lastUser = conv.created_at;
      if (bodyParts.length < 3) bodyParts.push(text);
    }
    messageRows.push({
      id: `${conv.id}:src`,
      conversation_id: conv.id,
      created_at: conv.created_at,
      part_type: 'source',
      author_type: authorType ?? null,
      author_id: conv.source.author?.id ?? null,
      body: text,
      body_html: conv.source.body,
    });
  }

  for (const p of parts) {
    const ts = p.created_at ?? 0;
    const at = p.author?.type;
    const text = stripHtml(p.body);

    messageRows.push({
      id: p.id ?? `${conv.id}:${ts}:${Math.random().toString(36).slice(2, 8)}`,
      conversation_id: conv.id,
      created_at: ts,
      part_type: p.part_type ?? null,
      author_type: at ?? null,
      author_id: p.author?.id ?? null,
      body: text,
      body_html: p.body ?? null,
    });

    if (
      p.part_type === 'assignment' &&
      p.assigned_to?.type === 'team' &&
      p.assigned_to.id &&
      !firstTeam
    ) {
      firstTeam = String(p.assigned_to.id);
      firstTeamAt = ts || null;
    }

    if (!text) continue;
    if (at === 'admin') {
      adminCount++;
      lastAdmin = ts;
      if (firstAdmin === null) firstAdmin = ts;
    } else if (at === 'user' || at === 'lead' || at === 'contact') {
      userCount++;
      lastUser = ts;
      if (bodyParts.length < 3) bodyParts.push(text);
    }
  }

  const firstResponseSeconds =
    firstAdmin && conv.created_at ? Math.max(0, firstAdmin - conv.created_at) : null;

  return {
    metrics: {
      parts_count: parts.length,
      user_messages_count: userCount,
      admin_messages_count: adminCount,
      last_user_message_at: lastUser,
      last_admin_message_at: lastAdmin,
      first_admin_reply_at: firstAdmin,
      first_response_seconds: firstResponseSeconds,
      first_team_assignee_id: firstTeam,
      first_team_assigned_at: firstTeamAt,
      body_sample: bodyParts.join(' \n ').slice(0, 4000),
    },
    messageRows,
  };
}

// Prepared statements are cached per-DB so we don't re-prepare on every call.
const stmtCache = new WeakMap<Database.Database, ReturnType<typeof prepareStatements>>();

function prepareStatements(db: Database.Database) {
  return {
    // Note: first_team_assignee_id is "set once" — never overwritten if already
    // populated and earlier. New value only wins if existing is null OR new
    // assigned_at is strictly earlier than existing.
    upsertConv: db.prepare(
      `INSERT INTO conversations (
         id, created_at, updated_at, waiting_since, snoozed_until, open, state, read, priority,
         contact_id, contact_email, contact_name, contact_external_id,
         team_assignee_id, admin_assignee_id, first_team_assignee_id, first_team_assigned_at,
         source_type, source_url, source_subject, source_delivered_as,
         source_bucket, status_bucket, status_source, progress_attribute,
         parts_count, user_messages_count, admin_messages_count,
         last_user_message_at, last_admin_message_at, first_admin_reply_at, first_response_seconds,
         raw_json, fetched_at, detail_fetched_at
       ) VALUES (
         @id,@created_at,@updated_at,@waiting_since,@snoozed_until,@open,@state,@read,@priority,
         @contact_id,@contact_email,@contact_name,@contact_external_id,
         @team_assignee_id,@admin_assignee_id,@first_team_assignee_id,@first_team_assigned_at,
         @source_type,@source_url,@source_subject,@source_delivered_as,
         @source_bucket,@status_bucket,@status_source,@progress_attribute,
         @parts_count,@user_messages_count,@admin_messages_count,
         @last_user_message_at,@last_admin_message_at,@first_admin_reply_at,@first_response_seconds,
         @raw_json,@fetched_at,@detail_fetched_at
       )
       ON CONFLICT(id) DO UPDATE SET
         updated_at=excluded.updated_at, waiting_since=excluded.waiting_since,
         snoozed_until=excluded.snoozed_until, open=excluded.open, state=excluded.state,
         read=excluded.read, priority=excluded.priority,
         contact_id=excluded.contact_id, contact_email=excluded.contact_email,
         contact_name=excluded.contact_name, contact_external_id=excluded.contact_external_id,
         team_assignee_id=excluded.team_assignee_id, admin_assignee_id=excluded.admin_assignee_id,
         first_team_assignee_id = CASE
           WHEN conversations.first_team_assignee_id IS NULL THEN excluded.first_team_assignee_id
           WHEN excluded.first_team_assigned_at IS NOT NULL
             AND (conversations.first_team_assigned_at IS NULL OR excluded.first_team_assigned_at < conversations.first_team_assigned_at)
             THEN excluded.first_team_assignee_id
           ELSE conversations.first_team_assignee_id
         END,
         first_team_assigned_at = CASE
           WHEN conversations.first_team_assigned_at IS NULL THEN excluded.first_team_assigned_at
           WHEN excluded.first_team_assigned_at IS NOT NULL
             AND excluded.first_team_assigned_at < conversations.first_team_assigned_at
             THEN excluded.first_team_assigned_at
           ELSE conversations.first_team_assigned_at
         END,
         source_type=excluded.source_type, source_url=excluded.source_url,
         source_subject=excluded.source_subject, source_delivered_as=excluded.source_delivered_as,
         source_bucket=excluded.source_bucket, status_bucket=excluded.status_bucket,
         status_source=excluded.status_source, progress_attribute=excluded.progress_attribute,
         parts_count=excluded.parts_count, user_messages_count=excluded.user_messages_count,
         admin_messages_count=excluded.admin_messages_count,
         last_user_message_at=excluded.last_user_message_at,
         last_admin_message_at=excluded.last_admin_message_at,
         first_admin_reply_at=excluded.first_admin_reply_at,
         first_response_seconds=excluded.first_response_seconds,
         raw_json=excluded.raw_json, fetched_at=excluded.fetched_at,
         detail_fetched_at=excluded.detail_fetched_at`,
    ),
    delMessages: db.prepare(`DELETE FROM messages WHERE conversation_id = ?`),
    insMessage: db.prepare(
      `INSERT OR REPLACE INTO messages (id, conversation_id, created_at, part_type, author_type, author_id, body, body_html)
       VALUES (@id,@conversation_id,@created_at,@part_type,@author_type,@author_id,@body,@body_html)`,
    ),
    insError: db.prepare(
      `INSERT INTO sync_errors (occurred_at, scope, conversation_id, status_code, message, payload)
       VALUES (?,?,?,?,?,?)`,
    ),
    overrideStmt: db.prepare(
      `SELECT status_bucket FROM conversation_status_overrides WHERE conversation_id = ?`,
    ),
    setSyncState: db.prepare(
      `INSERT INTO sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ),
    getSyncState: db.prepare(`SELECT value FROM sync_state WHERE key = ?`),
  };
}

function getStmts(db: Database.Database) {
  let s = stmtCache.get(db);
  if (!s) {
    s = prepareStatements(db);
    stmtCache.set(db, s);
  }
  return s;
}

export function upsertConversation(
  db: Database.Database,
  conv: IcConv,
  opts: { fetchedAt?: number } = {},
): { metrics: ConvMetrics; sourceBucket: string; statusBucket: StatusBucket } {
  const s = getStmts(db);
  const now = opts.fetchedAt ?? Math.floor(Date.now() / 1000);
  const convId = String(conv.id);

  const { metrics, messageRows } = computeMetrics(conv);

  const overrideRow = s.overrideStmt.get(convId) as { status_bucket?: StatusBucket } | undefined;
  const sourceClass = classifySource({
    team_assignee_id: conv.team_assignee_id != null ? String(conv.team_assignee_id) : null,
    first_team_assignee_id: metrics.first_team_assignee_id,
    source: conv.source ?? null,
  });
  const progressRaw =
    conv.custom_attributes && typeof conv.custom_attributes === 'object'
      ? (conv.custom_attributes['Progress'] as string | null | undefined) ?? null
      : null;
  const statusClass = classifyStatus({
    open: !!conv.open,
    state: conv.state,
    user_messages_count: metrics.user_messages_count,
    admin_messages_count: metrics.admin_messages_count,
    last_user_message_at: metrics.last_user_message_at,
    last_admin_message_at: metrics.last_admin_message_at,
    first_admin_reply_at: metrics.first_admin_reply_at,
    body_sample: metrics.body_sample,
    manual_override: overrideRow?.status_bucket ?? null,
    intercom_progress: typeof progressRaw === 'string' ? progressRaw : null,
  });

  const contact = conv.contacts?.contacts?.[0];

  const txn = db.transaction(() => {
    s.upsertConv.run({
      id: convId,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      waiting_since: conv.waiting_since ?? null,
      snoozed_until: conv.snoozed_until ?? null,
      open: conv.open ? 1 : 0,
      state: conv.state ?? null,
      read: conv.read == null ? null : conv.read ? 1 : 0,
      priority: conv.priority ?? null,
      contact_id: contact?.id ?? null,
      contact_email: contact?.email ?? null,
      contact_name: contact?.name ?? null,
      contact_external_id: contact?.external_id ?? null,
      team_assignee_id: conv.team_assignee_id != null ? String(conv.team_assignee_id) : null,
      admin_assignee_id: conv.admin_assignee_id != null ? String(conv.admin_assignee_id) : null,
      first_team_assignee_id: metrics.first_team_assignee_id,
      first_team_assigned_at: metrics.first_team_assigned_at,
      source_type: conv.source?.type ?? null,
      source_url: conv.source?.url ?? null,
      source_subject: conv.source?.subject ?? null,
      source_delivered_as: conv.source?.delivered_as ?? null,
      source_bucket: sourceClass.bucket,
      status_bucket: statusClass.bucket,
      status_source: statusClass.source,
      progress_attribute: typeof progressRaw === 'string' ? progressRaw : null,
      parts_count: metrics.parts_count,
      user_messages_count: metrics.user_messages_count,
      admin_messages_count: metrics.admin_messages_count,
      last_user_message_at: metrics.last_user_message_at,
      last_admin_message_at: metrics.last_admin_message_at,
      first_admin_reply_at: metrics.first_admin_reply_at,
      first_response_seconds: metrics.first_response_seconds,
      raw_json: null,
      fetched_at: now,
      detail_fetched_at: Math.floor(Date.now() / 1000),
    });
    s.delMessages.run(convId);
    for (const m of messageRows) s.insMessage.run(m);
  });
  txn();

  return {
    metrics,
    sourceBucket: sourceClass.bucket,
    statusBucket: statusClass.bucket,
  };
}

export function recordSyncError(
  db: Database.Database,
  scope: string,
  conversationId: string | null,
  err: unknown,
) {
  const s = getStmts(db);
  const e = err as { status?: number; message?: string };
  s.insError.run(
    Math.floor(Date.now() / 1000),
    scope,
    conversationId,
    e.status ?? null,
    e.message ?? String(err),
    null,
  );
}

export function setSyncState(db: Database.Database, key: string, value: string) {
  getStmts(db).setSyncState.run(key, value);
}

export function getSyncState(db: Database.Database, key: string): string | null {
  const row = getStmts(db).getSyncState.get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}
