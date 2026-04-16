#!/usr/bin/env npx tsx
/**
 * Ретроактивное тегирование всех существующих разговоров
 * в соответствии с воркфлоу-тегами Intercom.
 *
 * Запуск:
 *   npx tsx scripts/retag-conversations.ts
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import Database from 'better-sqlite3';
import path from 'node:path';

const INTERCOM_TOKEN =
  process.env.INTERCOM_ACCESS_TOKEN ||
  process.env.INTERCOM_TOKEN ||
  '';
const ADMIN_ID = '9807662';
const API_BASE = 'https://api.intercom.io';
const HEADERS: Record<string, string> = {
  Authorization: `Bearer ${INTERCOM_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'Intercom-Version': '2.11',
};

// Tag ID → mapping
const TAG_RULES: Array<{
  tagId: string;
  tagName: string;
  where: string; // SQL WHERE clause
}> = [
  {
    tagId: '14169339',
    tagName: 'Telegram Bot: BoostyFi Team Bot',
    where: "source_bucket = 'telegram_boostyfi'",
  },
  {
    tagId: '14450858',
    tagName: 'Telegram Bot: Limitless Support Bot',
    where: "source_bucket = 'telegram_iamlimitless'",
  },
  {
    tagId: '13681172',
    tagName: 'JGGL_FB_NEW',
    where: "source_bucket = 'facebook' AND source_url = 'https://www.facebook.com/900992606431564'",
  },
  {
    tagId: '13681171',
    tagName: 'ATLA_FB_NEW',
    where: "source_bucket = 'facebook' AND source_url = 'https://www.facebook.com/990413554162384'",
  },
  {
    tagId: '14534995',
    tagName: 'ARTEKI_FB_NEW',
    where: "source_bucket = 'facebook' AND source_url = 'https://www.facebook.com/555314024322717'",
  },
  {
    tagId: '14545370',
    tagName: 'email-support',
    where: "source_bucket = 'email'",
  },
  {
    tagId: '14545375',
    tagName: 'intercom-modal',
    where: "source_bucket = 'website'",
  },
];

// Rate limiter: max ~80 requests per 10 seconds
const BATCH_SIZE = 80;
const BATCH_DELAY_MS = 11_000;

async function tagConversation(convId: string, tagId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/conversations/${convId}/tags`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ id: tagId, admin_id: ADMIN_ID }),
    });
    if (res.status === 429) {
      // Rate limited — wait and retry
      const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);
      console.log(`  Rate limited, waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      return tagConversation(convId, tagId);
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`  ERROR ${convId}: ${res.status} ${text}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`  ERROR ${convId}: ${e}`);
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!INTERCOM_TOKEN) {
    console.error('INTERCOM_TOKEN not set');
    process.exit(1);
  }

  const dbPath = path.resolve('data/dashboard.db');
  const db = new Database(dbPath, { readonly: true });

  for (const rule of TAG_RULES) {
    const rows = db
      .prepare(`SELECT id FROM conversations WHERE ${rule.where}`)
      .all() as { id: string }[];

    console.log(`\n=== ${rule.tagName} (${rows.length} conversations) ===`);

    let ok = 0;
    let fail = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((r) => tagConversation(r.id, rule.tagId)),
      );
      ok += results.filter(Boolean).length;
      fail += results.filter((r) => !r).length;

      const progress = Math.min(i + BATCH_SIZE, rows.length);
      console.log(
        `  ${progress}/${rows.length} (ok=${ok}, fail=${fail})`,
      );

      if (i + BATCH_SIZE < rows.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    console.log(`  Done: ${ok} tagged, ${fail} failed`);
  }

  db.close();
  console.log('\nAll done!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
