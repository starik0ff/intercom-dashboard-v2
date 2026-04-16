#!/usr/bin/env tsx
/**
 * Bootstrap worker — one-shot full sync of Intercom conversations into SQLite.
 *
 * Idempotent: rerunning continues from `sync_state.bootstrap_cursor` and
 * upserts (REPLACE INTO) — safe to interrupt and resume.
 *
 * Usage:
 *   npx tsx worker/bootstrap.ts            # full sync
 *   npx tsx worker/bootstrap.ts --reset    # restart from scratch
 *   LIMIT=100 npx tsx worker/bootstrap.ts  # smoke test
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv(); // also load .env if present
import { getDb } from '../src/lib/db/client';
import {
  iterateConversations,
  getConversation,
  listAdmins,
  listTeams,
} from '../src/lib/intercom/client';
import { classifySource } from '../src/lib/classify/source';
import { classifyStatus } from '../src/lib/classify/status';

const RESET = process.argv.includes('--reset');
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0;
const PROGRESS_EVERY = 25;
const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;

interface IcContact { id?: string; type?: string; email?: string; name?: string; external_id?: string }
interface IcPart {
  id?: string;
  part_type?: string;
  created_at?: number;
  body?: string;
  author?: { type?: string; id?: string };
  assigned_to?: { type?: string; id?: string };
}
interface IcConv {
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
  source?: { type?: string; url?: string; subject?: string; delivered_as?: string; author?: { type?: string; id?: string }; body?: string };
  conversation_parts?: { conversation_parts: IcPart[]; total_count?: number };
  custom_attributes?: Record<string, unknown> | null;
}

function stripHtml(s: string | undefined): string {
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

async function syncAdminsTeams() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const admins = await listAdmins<{ id: string; name?: string; email?: string; has_inbox_seat?: boolean; away_mode_enabled?: boolean }>();
  const upsertAdmin = db.prepare(
    `INSERT INTO admins (id, name, email, has_inbox_seat, away_mode, raw_json, updated_at)
     VALUES (@id,@name,@email,@has_inbox_seat,@away_mode,@raw_json,@updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, email=excluded.email,
       has_inbox_seat=excluded.has_inbox_seat, away_mode=excluded.away_mode,
       raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
  );
  for (const a of admins.admins || []) {
    upsertAdmin.run({
      id: String(a.id),
      name: a.name ?? null,
      email: a.email ?? null,
      has_inbox_seat: a.has_inbox_seat ? 1 : 0,
      away_mode: a.away_mode_enabled ? 1 : 0,
      raw_json: JSON.stringify(a),
      updated_at: now,
    });
  }
  console.log(`  admins: ${admins.admins?.length ?? 0}`);

  const teams = await listTeams<{ id: string; name?: string }>();
  const upsertTeam = db.prepare(
    `INSERT INTO teams (id, name, raw_json, updated_at)
     VALUES (@id,@name,@raw_json,@updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
  );
  for (const t of teams.teams || []) {
    upsertTeam.run({
      id: String(t.id),
      name: t.name ?? null,
      raw_json: JSON.stringify(t),
      updated_at: now,
    });
  }
  console.log(`  teams:  ${teams.teams?.length ?? 0}`);
}

interface ConvMetrics {
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

function computeMetrics(conv: IcConv): { metrics: ConvMetrics; messageRows: Array<Record<string, unknown>> } {
  const parts = conv.conversation_parts?.conversation_parts ?? [];
  let userCount = 0;
  let adminCount = 0;
  let lastUser: number | null = null;
  let lastAdmin: number | null = null;
  let firstAdmin: number | null = null;
  let firstTeam: string | null = null;
  let firstTeamAt: number | null = null;
  const bodyParts: string[] = [];

  // Count source.body as user message #1 if user-authored.
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

    // Assignment tracking.
    if (p.part_type === 'assignment' && p.assigned_to?.type === 'team' && p.assigned_to.id && !firstTeam) {
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

async function main() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  if (RESET) {
    console.log('--reset: clearing sync_state.bootstrap_cursor');
    db.prepare(`DELETE FROM sync_state WHERE key='bootstrap_cursor'`).run();
  }

  console.log('Syncing admins + teams…');
  await syncAdminsTeams();

  // Search query: every conversation, oldest-first stable order.
  // Note: Intercom search supports created_at / updated_at sort.
  const query = {
    operator: 'AND',
    value: [
      // Always-true filter: created_at > 0
      { field: 'created_at', operator: '>', value: 0 },
    ],
  };

  const upsertConv = db.prepare(
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
       first_team_assignee_id=excluded.first_team_assignee_id,
       first_team_assigned_at=excluded.first_team_assigned_at,
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
  );

  const delMessages = db.prepare(`DELETE FROM messages WHERE conversation_id = ?`);
  const insMessage = db.prepare(
    `INSERT OR REPLACE INTO messages (id, conversation_id, created_at, part_type, author_type, author_id, body, body_html)
     VALUES (@id,@conversation_id,@created_at,@part_type,@author_type,@author_id,@body,@body_html)`,
  );
  const insError = db.prepare(
    `INSERT INTO sync_errors (occurred_at, scope, conversation_id, status_code, message, payload)
     VALUES (?,?,?,?,?,?)`,
  );
  const overrideStmt = db.prepare(
    `SELECT status_bucket FROM conversation_status_overrides WHERE conversation_id = ?`,
  );

  let processed = 0;
  let errors = 0;
  const t0 = Date.now();

  async function processOne(convId: string) {
    try {
      const conv = await getConversation<IcConv>(convId, 'plaintext');
      const { metrics, messageRows } = computeMetrics(conv);

      const overrideRow = overrideStmt.get(convId) as { status_bucket?: string } | undefined;
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
        manual_override: (overrideRow?.status_bucket as never) ?? null,
        intercom_progress: typeof progressRaw === 'string' ? progressRaw : null,
      });

      const contact = conv.contacts?.contacts?.[0];

      const txn = db.transaction(() => {
        upsertConv.run({
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
          raw_json: null, // skip — saves ~50% disk; re-fetchable via API
          fetched_at: now,
          detail_fetched_at: Math.floor(Date.now() / 1000),
        });
        delMessages.run(convId);
        for (const m of messageRows) insMessage.run(m);
      });
      txn();

      processed++;
      if (processed % PROGRESS_EVERY === 0) {
        const rate = processed / ((Date.now() - t0) / 1000);
        const eta = rate > 0 ? ((14000 - processed) / rate / 60).toFixed(1) : '?';
        process.stdout.write(
          `  processed=${processed}  errors=${errors}  rate=${rate.toFixed(1)}/s  eta≈${eta}m\r`,
        );
      }
    } catch (err) {
      errors++;
      const e = err as { status?: number; message?: string };
      insError.run(
        Math.floor(Date.now() / 1000),
        'bootstrap',
        convId,
        e.status ?? null,
        e.message ?? String(err),
        null,
      );
    }
  }

  console.log(`Iterating conversations search… (concurrency=${CONCURRENCY})`);
  // Bounded concurrency: maintain a pool of in-flight processOne promises.
  const inflight = new Set<Promise<void>>();
  function spawn(id: string) {
    const p = processOne(id).finally(() => inflight.delete(p));
    inflight.add(p);
  }

  let scheduled = 0;
  let aborted = false;
  for await (const summary of iterateConversations<{ id: string; updated_at: number }>({ query, per_page: 150 })) {
    if (LIMIT && scheduled >= LIMIT) break;
    if (errors > 200) { aborted = true; break; }
    spawn(String(summary.id));
    scheduled++;
    while (inflight.size >= CONCURRENCY) {
      await Promise.race(inflight);
    }
  }
  await Promise.all(inflight);
  if (aborted) console.error('\nToo many errors, aborted iteration.');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nBootstrap done. processed=${processed} errors=${errors} elapsed=${elapsed}s`,
  );

  // Stash bootstrap completion.
  db.prepare(
    `INSERT INTO sync_state (key, value) VALUES ('bootstrap_completed_at', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(String(Math.floor(Date.now() / 1000)));

  // Quick sanity totals.
  const totals = db
    .prepare(
      `SELECT source_bucket, COUNT(*) AS n FROM conversations GROUP BY source_bucket ORDER BY n DESC`,
    )
    .all();
  console.log('\nBy source_bucket:');
  for (const r of totals) console.log('  ', r);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
