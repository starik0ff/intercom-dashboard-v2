// Reclassify all conversations in DB using current classifier rules.
// Pure SQL — no Intercom API calls. Safe to run repeatedly.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { getDb } from '../src/lib/db/client.js';
import { classifySource } from '../src/lib/classify/source.js';
import {
  classifyStatus,
  type StatusBucket,
} from '../src/lib/classify/status.js';

interface Row {
  id: string;
  team_assignee_id: string | null;
  first_team_assignee_id: string | null;
  source_type: string | null;
  source_url: string | null;
  source_delivered_as: string | null;
  open: number;
  state: string | null;
  user_messages_count: number;
  admin_messages_count: number;
  last_user_message_at: number | null;
  last_admin_message_at: number | null;
  first_admin_reply_at: number | null;
  source_bucket: string;
  status_bucket: string;
  status_source: string;
}

interface OverrideRow {
  conversation_id: string;
  status_bucket: StatusBucket;
}

async function main() {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, team_assignee_id, first_team_assignee_id,
              source_type, source_url, source_delivered_as,
              open, state,
              user_messages_count, admin_messages_count,
              last_user_message_at, last_admin_message_at, first_admin_reply_at,
              source_bucket, status_bucket, status_source
         FROM conversations`,
    )
    .all() as Row[];

  const overrides = new Map<string, StatusBucket>();
  for (const o of db
    .prepare(`SELECT conversation_id, status_bucket FROM conversation_status_overrides`)
    .all() as OverrideRow[]) {
    overrides.set(o.conversation_id, o.status_bucket);
  }

  // First user message body sample for keyword scan.
  const bodySampleStmt = db.prepare(
    `SELECT body FROM messages
       WHERE conversation_id = ? AND author_type IN ('user','lead','contact')
       ORDER BY created_at ASC
       LIMIT 3`,
  );

  const update = db.prepare(
    `UPDATE conversations
        SET source_bucket = ?, status_bucket = ?, status_source = ?
      WHERE id = ?`,
  );

  let changedSrc = 0;
  let changedStatus = 0;
  let processed = 0;

  const tx = db.transaction((batch: Row[]) => {
    for (const r of batch) {
      const src = classifySource({
        team_assignee_id: r.team_assignee_id,
        first_team_assignee_id: r.first_team_assignee_id,
        source: {
          type: r.source_type,
          delivered_as: r.source_delivered_as,
          url: r.source_url,
        },
      });

      const bodyRows = bodySampleStmt.all(r.id) as { body: string | null }[];
      const bodySample = bodyRows
        .map((b) => b.body || '')
        .join(' ')
        .slice(0, 2000);

      const stat = classifyStatus({
        open: !!r.open,
        state: r.state,
        user_messages_count: r.user_messages_count,
        admin_messages_count: r.admin_messages_count,
        last_user_message_at: r.last_user_message_at,
        last_admin_message_at: r.last_admin_message_at,
        first_admin_reply_at: r.first_admin_reply_at,
        body_sample: bodySample,
        manual_override: overrides.get(r.id) ?? null,
      });

      if (src.bucket !== r.source_bucket) changedSrc++;
      if (stat.bucket !== r.status_bucket) changedStatus++;

      update.run(src.bucket, stat.bucket, stat.source, r.id);
      processed++;
    }
  });

  // Batch in chunks of 1000 to keep transactions reasonable.
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    tx(rows.slice(i, i + CHUNK));
    process.stdout.write(`  reclassified ${Math.min(i + CHUNK, rows.length)}/${rows.length}\r`);
  }
  process.stdout.write('\n');

  console.log(`Done. processed=${processed} source_changed=${changedSrc} status_changed=${changedStatus}`);

  // Distribution after reclassify.
  const bySrc = db
    .prepare(`SELECT source_bucket, COUNT(*) AS n FROM conversations GROUP BY source_bucket ORDER BY n DESC`)
    .all() as { source_bucket: string; n: number }[];
  console.log('\nsource_bucket distribution:');
  for (const r of bySrc) console.log(`  ${r.source_bucket.padEnd(16)} ${r.n}`);

  const byStat = db
    .prepare(`SELECT status_bucket, COUNT(*) AS n FROM conversations GROUP BY status_bucket ORDER BY n DESC`)
    .all() as { status_bucket: string; n: number }[];
  console.log('\nstatus_bucket distribution:');
  for (const r of byStat) console.log(`  ${r.status_bucket.padEnd(16)} ${r.n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
