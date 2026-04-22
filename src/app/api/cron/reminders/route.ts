/**
 * Cron endpoint: sends Telegram reminders for unread conversations.
 * Schedule: every 15 minutes via cron/pm2.
 *
 * Reminder levels: 1h, 4h, 8h, then every 8h after that.
 * Each reminder deletes the previous TG message and sends a new one
 * with all unread messages + a reminder badge.
 */

import { getDb } from '@/lib/db/client';
import { sendTelegramMessage, deleteTelegramMessage, escapeHtml } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const REMINDER_THRESHOLDS = [
  { hours: 1, level: 1 },
  { hours: 4, level: 4 },
  { hours: 8, level: 8 },
];

function getRequiredLevel(ageSeconds: number, currentLevel: number): number | null {
  const ageHours = ageSeconds / 3600;

  // After level 8, repeat every 8 hours: level 16, 24, 32...
  if (currentLevel >= 8) {
    const nextLevel = currentLevel + 8;
    if (ageHours >= nextLevel) return nextLevel;
    return null;
  }

  // Initial thresholds: 1h, 4h, 8h
  for (const t of REMINDER_THRESHOLDS) {
    if (ageHours >= t.hours && currentLevel < t.level) {
      return t.level;
    }
  }
  return null;
}

function formatHours(level: number): string {
  if (level < 24) return `${level}ч`;
  const days = Math.floor(level / 24);
  const hours = level % 24;
  return hours > 0 ? `${days}д ${hours}ч` : `${days}д`;
}

export async function GET() {
  const cronSecret = process.env.CRON_SECRET;
  // Allow without secret for now (internal network only)

  try {
    const db = getDb();

    // Ensure table has required columns
    const migrations = [
      'ALTER TABLE telegram_threads ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE telegram_threads ADD COLUMN reminder_level INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE telegram_threads ADD COLUMN contact_name TEXT',
      'ALTER TABLE telegram_threads ADD COLUMN contact_email TEXT',
      'ALTER TABLE telegram_threads ADD COLUMN channel TEXT',
    ];
    for (const sql of migrations) {
      try { db.exec(sql); } catch { /* already exists */ }
    }

    const now = Math.floor(Date.now() / 1000);

    // Get all active threads where last user message is older than 1 hour
    // updated_at = time of last user message in this thread
    const threads = db.prepare(
      `SELECT conversation_id, chat_id, message_id, messages_count,
              last_text, created_at, updated_at, reminder_level,
              contact_name, contact_email, channel
       FROM telegram_threads
       WHERE (? - updated_at) >= 3600`,
    ).all(now) as {
      conversation_id: string;
      chat_id: string;
      message_id: number;
      messages_count: number;
      last_text: string | null;
      created_at: number;
      updated_at: number;
      reminder_level: number;
      contact_name: string | null;
      contact_email: string | null;
      channel: string | null;
    }[];

    let sent = 0;

    for (const t of threads) {
      // Age counted from last user message (updated_at), not from thread creation
      const ageSeconds = now - t.updated_at;
      const newLevel = getRequiredLevel(ageSeconds, t.reminder_level);
      if (!newLevel) continue;

      // Delete old TG message
      await deleteTelegramMessage(t.chat_id, t.message_id);

      // Extract message lines from last_text (everything after header block)
      let msgLines = '';
      const oldText = t.last_text || '';
      const emptyLineIdx = oldText.indexOf('\n\n');
      if (emptyLineIdx !== -1) {
        msgLines = oldText.slice(emptyLineIdx + 2);
      }

      // Build reminder message — extract name from last_text header if not stored
      let name = t.contact_name || '';
      if (!name && oldText) {
        // Parse from "📩 <b>Name</b>" or "📩 <b>Name</b> (email)"
        const nameMatch = oldText.match(/📩 <b>([^<]+)<\/b>/);
        if (nameMatch) name = nameMatch[1];
      }
      if (!name) name = 'Посетитель';

      let email = t.contact_email || '';
      if (!email && oldText) {
        const emailMatch = oldText.match(/<\/b> \(([^)]+)\)/);
        if (emailMatch) email = emailMatch[1];
      }

      let channel = t.channel || '';
      if (!channel && oldText) {
        const chMatch = oldText.match(/Канал: ([^\n]+)/);
        if (chMatch) channel = chMatch[1];
      }

      const intercomUrl = `https://dashboard-intercom.atomgroup.dev/api/go/conversation/${t.conversation_id}`;

      const headerLines = [`🔔 <b>Напоминание (${formatHours(newLevel)})</b>`];
      headerLines.push(`📩 <b>${escapeHtml(name)}</b>`);
      if (email && email !== name) {
        headerLines[headerLines.length - 1] += ` (${escapeHtml(email)})`;
      }
      if (channel) headerLines.push(`Канал: ${escapeHtml(channel)}`);
      headerLines.push(`<a href="${intercomUrl}">Открыть в Intercom</a>`);
      headerLines.push('');
      if (msgLines) headerLines.push(msgLines);

      const fullText = headerLines.join('\n');
      const sendResult = await sendTelegramMessage(t.chat_id, fullText);

      if (sendResult.ok && sendResult.message_id) {
        db.prepare(
          `UPDATE telegram_threads
           SET message_id = ?, last_text = ?, reminder_level = ?, updated_at = ?
           WHERE conversation_id = ? AND chat_id = ?`,
        ).run(sendResult.message_id, fullText, newLevel, now, t.conversation_id, t.chat_id);
        sent++;
      }
    }

    return Response.json({ ok: true, checked: threads.length, sent });
  } catch (err) {
    console.error('cron/reminders: error', err);
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
