/**
 * Fetches channel status from Intercom API and caches in SQLite.
 * Called by the worker daemon on each sync cycle.
 */

import type Database from 'better-sqlite3';

const BASE_URL = 'https://api.intercom.io';

function getHeaders(): Record<string, string> {
  const token = process.env.INTERCOM_TOKEN;
  if (!token) throw new Error('INTERCOM_TOKEN env var is required');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Intercom-Version': '2.11',
  };
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const delay = parseInt(res.headers.get("retry-after") || "5", 10);
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error("Max retries");
}

async function searchCount(
  filters: Array<Record<string, unknown>>,
  afterTimestamp?: number,
  field: "created_at" | "statistics.last_contact_reply_at" = "created_at",
): Promise<{ totalCount: number; lastConv: Record<string, unknown> | null }> {
  const value = [...filters];
  if (afterTimestamp) {
    value.push({ field, operator: ">", value: afterTimestamp });
  }
  const sortField = field === "statistics.last_contact_reply_at" ? "updated_at" : field;

  const res = await fetchWithRetry(`${BASE_URL}/conversations/search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      query: { operator: "AND", value },
      pagination: { per_page: 1 },
      sort: { field: sortField, order: "desc" },
    }),
  });
  const data = await res.json() as { total_count?: number; conversations?: Record<string, unknown>[] };
  return {
    totalCount: data.total_count ?? 0,
    lastConv: data.conversations?.[0] || null,
  };
}

interface ChannelDef {
  key: string;
  label: string;
  filters: Array<Record<string, unknown>>;
  warningMinutes: number;
  errorMinutes: number;
}

const TELEGRAM_TAG_ID = "14197861";

const CHANNELS: ChannelDef[] = [
  {
    key: "facebook",
    label: "Facebook Messenger",
    filters: [{ field: "source.type", operator: "=", value: "facebook" }],
    warningMinutes: 120,
    errorMinutes: 360,
  },
  {
    key: "telegram",
    label: "Telegram (Interchat)",
    filters: [{ field: "tag_ids", operator: "IN", value: [TELEGRAM_TAG_ID] }],
    warningMinutes: 120,
    errorMinutes: 360,
  },
  {
    key: "conversation",
    label: "Виджет на сайте",
    filters: [{ field: "source.type", operator: "=", value: "conversation" }],
    warningMinutes: 60,
    errorMinutes: 180,
  },
  {
    key: "email",
    label: "Email",
    filters: [{ field: "source.type", operator: "=", value: "email" }],
    warningMinutes: 180,
    errorMinutes: 720,
  },
];

async function fetchChannelStatus(ch: ChannelDef): Promise<{
  channel: string; label: string;
  totalOpen: number; last1h: number; last24h: number;
  lastMessageAt: string | null; lastConvId: string | null;
  status: "ok" | "warning" | "error";
}> {
  const now = Math.floor(Date.now() / 1000);
  const oneHourAgo = now - 3600;
  const oneDayAgo = now - 86400;

  // Run 4 searches sequentially with 150ms gaps to stay within rate limits
  const total = await searchCount(ch.filters);
  await new Promise(r => setTimeout(r, 150));
  const newLast1h = await searchCount(ch.filters, oneHourAgo);
  await new Promise(r => setTimeout(r, 150));
  const newLast24h = await searchCount(ch.filters, oneDayAgo);
  await new Promise(r => setTimeout(r, 150));
  const activeLast1h = await searchCount(ch.filters, oneHourAgo, "statistics.last_contact_reply_at");

  const lastConv = total.lastConv as Record<string, unknown> | null;
  const lastCreatedAt = lastConv ? (lastConv.created_at as number) * 1000 : 0;

  const activeConv = activeLast1h.lastConv as Record<string, unknown> | null;
  const stats = activeConv?.statistics as Record<string, unknown> | undefined;
  const lastReplyAt = stats?.last_contact_reply_at
    ? (stats.last_contact_reply_at as number) * 1000
    : 0;

  const lastActivityTime = Math.max(lastCreatedAt, lastReplyAt);
  const lastMessageAt = lastActivityTime > 0 ? new Date(lastActivityTime).toISOString() : null;
  const lastConvId = lastReplyAt > lastCreatedAt
    ? (activeConv?.id as string) || null
    : (lastConv?.id as string) || null;

  let status: "ok" | "warning" | "error" = "ok";
  if (lastActivityTime > 0) {
    const minutesSinceLast = (Date.now() - lastActivityTime) / 60000;
    if (minutesSinceLast > ch.errorMinutes) status = "error";
    else if (minutesSinceLast > ch.warningMinutes) status = "warning";
  } else {
    status = "error";
  }

  return {
    channel: ch.key,
    label: ch.label,
    totalOpen: total.totalCount,
    last1h: newLast1h.totalCount,
    last24h: newLast24h.totalCount,
    lastMessageAt,
    lastConvId,
    status,
  };
}

export async function refreshChannelStatusCache(db: Database.Database): Promise<void> {
  const upsert = db.prepare(`
    INSERT INTO channel_status_cache (channel, label, total_open, last_1h, last_24h, last_message_at, last_conv_id, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel) DO UPDATE SET
      label = excluded.label,
      total_open = excluded.total_open,
      last_1h = excluded.last_1h,
      last_24h = excluded.last_24h,
      last_message_at = excluded.last_message_at,
      last_conv_id = excluded.last_conv_id,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  // Process channels sequentially to avoid Intercom rate limits
  for (const ch of CHANNELS) {
    try {
      const result = await fetchChannelStatus(ch);
      const now = Math.floor(Date.now() / 1000);
      upsert.run(
        result.channel, result.label, result.totalOpen,
        result.last1h, result.last24h, result.lastMessageAt,
        result.lastConvId, result.status, now,
      );
      console.log(`  channel-status: ${ch.key} ok (open=${result.totalOpen}, status=${result.status})`);
    } catch (err) {
      console.error(`  channel-status: ${ch.key} failed:`, err);
    }
    // 300ms between channels to be safe with rate limits
    await new Promise(r => setTimeout(r, 300));
  }
}
