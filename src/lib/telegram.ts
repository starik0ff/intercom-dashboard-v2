/** Telegram Bot API helper with rate limiting and retry for 429 errors. */

const TELEGRAM_API = 'https://api.telegram.org';

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN env var is required');
  return t;
}

// --- Rate limiter: token bucket, 25 msg/sec with burst up to 30 ---
const RATE_LIMIT = 25;
let tokens = RATE_LIMIT;
let lastRefill = Date.now();

function acquireToken(): Promise<void> {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  tokens = Math.min(RATE_LIMIT, tokens + elapsed * RATE_LIMIT);
  lastRefill = now;

  if (tokens >= 1) {
    tokens -= 1;
    return Promise.resolve();
  }
  const waitMs = ((1 - tokens) / RATE_LIMIT) * 1000;
  tokens = 0;
  return new Promise((r) => setTimeout(r, waitMs));
}

// --- Retry wrapper for 429 (Too Many Requests) ---
async function tgFetch(url: string, body: Record<string, unknown>, retries = 3): Promise<Record<string, unknown>> {
  for (let i = 0; i <= retries; i++) {
    await acquireToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (res.status === 429 && i < retries) {
      const retryAfter = (json.parameters as { retry_after?: number })?.retry_after || 1;
      console.warn(`telegram: rate limited, retry in ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    return json;
  }
  return { ok: false, description: 'max retries exceeded' };
}

// --- Contact cache: avoid redundant Intercom API calls ---
const contactCache = new Map<string, { name: string; email: string; ts: number }>();
const CONTACT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function getCachedContact(contactId: string): { name: string; email: string } | null {
  const entry = contactCache.get(contactId);
  if (!entry) return null;
  if (Date.now() - entry.ts > CONTACT_CACHE_TTL) {
    contactCache.delete(contactId);
    return null;
  }
  return { name: entry.name, email: entry.email };
}

export function setCachedContact(contactId: string, name: string, email: string): void {
  contactCache.set(contactId, { name, email, ts: Date.now() });
  // Evict old entries periodically
  if (contactCache.size > 500) {
    const cutoff = Date.now() - CONTACT_CACHE_TTL;
    for (const [k, v] of contactCache) {
      if (v.ts < cutoff) contactCache.delete(k);
    }
  }
}

// --- Public API ---

interface TgSendResult {
  ok: boolean;
  message_id?: number;
  description?: string;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<TgSendResult> {
  const url = `${TELEGRAM_API}/bot${botToken()}/sendMessage`;
  const json = await tgFetch(url, {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
  if (!json.ok) {
    console.error('telegram: sendMessage failed', json);
  }
  return {
    ok: json.ok as boolean,
    message_id: (json.result as { message_id?: number })?.message_id,
    description: json.description as string | undefined,
  };
}

export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<{ ok: boolean; description?: string }> {
  const url = `${TELEGRAM_API}/bot${botToken()}/editMessageText`;
  const json = await tgFetch(url, {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
  if (!json.ok) {
    console.error('telegram: editMessageText failed', json);
  }
  return { ok: json.ok as boolean, description: json.description as string | undefined };
}

export async function deleteTelegramMessage(
  chatId: string,
  messageId: number,
): Promise<{ ok: boolean; description?: string }> {
  const url = `${TELEGRAM_API}/bot${botToken()}/deleteMessage`;
  const json = await tgFetch(url, {
    chat_id: chatId,
    message_id: messageId,
  });
  if (!json.ok) {
    console.error('telegram: deleteMessage failed', json);
  }
  return { ok: json.ok as boolean, description: json.description as string | undefined };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
