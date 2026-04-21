/** Telegram Bot API helper for sending notifications. */

const TELEGRAM_API = 'https://api.telegram.org';

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN env var is required');
  return t;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<{ ok: boolean; description?: string }> {
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
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    console.error('telegram: sendMessage failed', json);
  }
  return json;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
