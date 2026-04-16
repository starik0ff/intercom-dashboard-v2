import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

interface ChannelStatus {
  channel: string;
  label: string;
  totalOpen: number;
  last1h: number;
  last24h: number;
  lastMessageAt: string | null;
  lastConvId: string | null;
  status: "ok" | "warning" | "error";
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

async function searchConversations(
  filters: Array<Record<string, unknown>>,
  afterTimestamp?: number,
  field: "created_at" | "statistics.last_contact_reply_at" = "created_at",
) {
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
  const data = await res.json();
  return {
    totalCount: data.total_count ?? 0,
    lastConv: data.conversations?.[0] || null,
  };
}

function sourceFilter(sourceType: string): Array<Record<string, unknown>> {
  return [{ field: "source.type", operator: "=", value: sourceType }];
}

// Telegram via Interchat: tagged with "Telegram" tag
const TELEGRAM_TAG_ID = "14197861";
function telegramFilter(): Array<Record<string, unknown>> {
  return [{ field: "tag_ids", operator: "IN", value: [TELEGRAM_TAG_ID] }];
}

async function getChannelStatus(
  channelKey: string,
  label: string,
  filters: Array<Record<string, unknown>>,
  warningMinutes: number,
  errorMinutes: number,
): Promise<ChannelStatus> {
  const now = Math.floor(Date.now() / 1000);
  const oneHourAgo = now - 3600;
  const oneDayAgo = now - 86400;

  const [total, newLast1h, newLast24h, activeLast1h] = await Promise.all([
    searchConversations(filters),
    searchConversations(filters, oneHourAgo),
    searchConversations(filters, oneDayAgo),
    searchConversations(filters, oneHourAgo, "statistics.last_contact_reply_at"),
  ]);

  const lastConv = total.lastConv;
  const lastCreatedAt = lastConv ? lastConv.created_at * 1000 : 0;

  const activeConv = activeLast1h.lastConv;
  const lastReplyAt = activeConv?.statistics?.last_contact_reply_at
    ? activeConv.statistics.last_contact_reply_at * 1000
    : 0;

  const lastActivityTime = Math.max(lastCreatedAt, lastReplyAt);
  const lastMessageAt = lastActivityTime > 0 ? new Date(lastActivityTime).toISOString() : null;
  const lastConvId = lastReplyAt > lastCreatedAt ? activeConv?.id : lastConv?.id || null;

  let status: "ok" | "warning" | "error" = "ok";
  if (lastActivityTime > 0) {
    const minutesSinceLast = (Date.now() - lastActivityTime) / 60000;
    if (minutesSinceLast > errorMinutes) status = "error";
    else if (minutesSinceLast > warningMinutes) status = "warning";
  } else {
    status = "error";
  }

  return {
    channel: channelKey,
    label,
    totalOpen: total.totalCount,
    last1h: newLast1h.totalCount,
    last24h: newLast24h.totalCount,
    lastMessageAt,
    lastConvId,
    status,
  };
}

export async function GET() {
  try {
    const channels = await Promise.all([
      getChannelStatus("facebook", "Facebook Messenger", sourceFilter("facebook"), 120, 360),
      getChannelStatus("telegram", "Telegram (Interchat)", telegramFilter(), 120, 360),
      getChannelStatus("conversation", "Виджет на сайте", sourceFilter("conversation"), 60, 180),
      getChannelStatus("email", "Email", sourceFilter("email"), 180, 720),
    ]);

    return NextResponse.json({
      channels,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
