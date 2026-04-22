/** Telegram Bot API helper for sending notifications. */

const TELEGRAM_API = 'https://api.telegram.org';

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN env var is required');
  return t;
}

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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!json.ok) {
    console.error('telegram: sendMessage failed', json);
  }
  return {
    ok: json.ok,
    message_id: json.result?.message_id,
    description: json.description,
  };
}

export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<{ ok: boolean; description?: string }> {
  const url = `${TELEGRAM_API}/bot${botToken()}/editMessageText`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    console.error('telegram: editMessageText failed', json);
  }
  return json;
}

export async function deleteTelegramMessage(
  chatId: string,
  messageId: number,
): Promise<{ ok: boolean; description?: string }> {
  const url = `${TELEGRAM_API}/bot${botToken()}/deleteMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    console.error('telegram: deleteMessage failed', json);
  }
  return json;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
