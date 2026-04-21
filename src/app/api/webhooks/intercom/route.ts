/**
 * Intercom webhook receiver.
 * Sends Telegram notification to the assigned manager on every user reply.
 *
 * Intercom signs payloads with HMAC-SHA1 (X-Hub-Signature header).
 * Always returns 200 after signature check to prevent retry storms.
 */

import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getDb } from '@/lib/db/client';
import { sendTelegramMessage, escapeHtml } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.INTERCOM_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signature) return false;
  const expected =
    'sha1=' +
    crypto.createHmac('sha1', secret).update(body, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  twitter: 'Twitter',
  facebook: 'Facebook',
  push: 'Push',
  sms: 'SMS',
  conversation: 'Messenger',
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get('x-hub-signature');

  if (!verifySignature(rawBody, sig)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }

  // Always 200 from here to avoid Intercom retries
  try {
    const payload = JSON.parse(rawBody);
    const topic = payload.topic as string;

    if (
      topic !== 'conversation.user.replied' &&
      topic !== 'conversation.user.created'
    ) {
      return Response.json({ ok: true, skipped: topic });
    }

    const item = payload.data?.item;
    if (!item) return Response.json({ ok: true, skipped: 'no_item' });

    // Find assigned admin
    const adminId =
      item.admin_assignee_id?.toString() ||
      item.assigned_to?.id?.toString() ||
      null;

    if (!adminId) {
      return Response.json({ ok: true, skipped: 'no_assignee' });
    }

    // Look up telegram mapping
    const db = getDb();
    const mapping = db
      .prepare(
        'SELECT telegram_chat_id FROM admin_telegram WHERE admin_id = ?',
      )
      .get(adminId) as { telegram_chat_id: string } | undefined;

    if (!mapping) {
      return Response.json({ ok: true, skipped: 'no_telegram' });
    }

    // Extract message info
    const contactName =
      item.source?.author?.name || item.user?.name || 'Клиент';
    const contactEmail = item.source?.author?.email || item.user?.email || '';
    const convId = item.id;
    const channel =
      CHANNEL_LABELS[item.source?.delivered_as || ''] ||
      item.source?.delivered_as ||
      '';

    // Get latest reply text
    const parts = item.conversation_parts?.conversation_parts;
    const latestBody = parts?.length
      ? parts[parts.length - 1]?.body || ''
      : item.source?.body || '';

    const preview = latestBody
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    // Build Telegram message
    const lines = [`📩 <b>${escapeHtml(contactName)}</b>`];
    if (contactEmail) lines[0] += ` (${escapeHtml(contactEmail)})`;
    if (channel) lines.push(`Канал: ${escapeHtml(channel)}`);
    lines.push('');
    lines.push(preview ? escapeHtml(preview) : '<i>(вложение)</i>');
    lines.push('');
    lines.push(
      `<a href="https://app.intercom.com/a/inbox/_/inbox/conversation/${convId}">Открыть в Intercom</a>`,
    );

    await sendTelegramMessage(mapping.telegram_chat_id, lines.join('\n'));
    return Response.json({ ok: true, notified: adminId });
  } catch (err) {
    console.error('webhook/intercom: error', err);
    return Response.json({ ok: true, error: 'internal' });
  }
}
