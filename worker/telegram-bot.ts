#!/usr/bin/env tsx
/**
 * Telegram bot for manager self-registration.
 *
 * Flow:
 *   /start → ask for Intercom Admin ID → verify via code sent to Intercom → save mapping
 *
 * Runs as a separate pm2 process with long-polling (getUpdates).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DASHBOARD_DB_PATH || path.join(process.cwd(), 'data', 'dashboard.db');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;

if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN required'); process.exit(1); }
if (!INTERCOM_TOKEN) { console.error('INTERCOM_TOKEN required'); process.exit(1); }

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const INTERCOM_API = 'https://api.intercom.io';
const CODE_TTL = 600; // 10 minutes

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ensure tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_reg (
    chat_id     TEXT PRIMARY KEY,
    admin_id    TEXT,
    admin_name  TEXT,
    code        TEXT,
    step        TEXT NOT NULL DEFAULT 'await_admin_id',
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// ─── Telegram API helpers ─────────────────────────────────────────────

async function tgSend(chatId: string, text: string): Promise<void> {
  await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
}

interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { username?: string; first_name?: string };
    text?: string;
  };
}

async function getUpdates(offset: number): Promise<TgUpdate[]> {
  const res = await fetch(`${TG_API}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`);
  const data = (await res.json()) as { ok: boolean; result: TgUpdate[] };
  return data.ok ? data.result : [];
}

// ─── Intercom helpers ─────────────────────────────────────────────────

function intercomHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${INTERCOM_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Intercom-Version': '2.11',
  };
}

interface AdminRow {
  id: string;
  name: string | null;
  email: string | null;
}

function findAdmin(adminId: string): AdminRow | undefined {
  return db.prepare('SELECT id, name, email FROM admins WHERE id = ?').get(adminId) as AdminRow | undefined;
}

async function sendIntercomVerification(adminId: string, code: string): Promise<boolean> {
  // Find a recent conversation assigned to this admin to post a note
  let convId: string | undefined;

  const openConv = db.prepare(
    `SELECT id FROM conversations
      WHERE admin_assignee_id = ? AND state = 'open'
      ORDER BY updated_at DESC LIMIT 1`,
  ).get(adminId) as { id: string } | undefined;

  if (openConv) {
    convId = openConv.id;
  } else {
    // Fallback: any conversation for this admin
    const anyConv = db.prepare(
      `SELECT id FROM conversations WHERE admin_assignee_id = ? ORDER BY updated_at DESC LIMIT 1`,
    ).get(adminId) as { id: string } | undefined;
    if (anyConv) convId = anyConv.id;
  }

  if (!convId) return false;
  return await postNote(convId, adminId, code);
}

async function postNote(convId: string, adminId: string, code: string): Promise<boolean> {
  const body = `🔐 <b>Код подтверждения Telegram</b><br><br>Ваш код: <b>${code}</b><br><br>Введите этот код в Telegram-бот для привязки уведомлений.<br>Код действует 10 минут.`;

  const res = await fetch(`${INTERCOM_API}/conversations/${convId}/reply`, {
    method: 'POST',
    headers: intercomHeaders(),
    body: JSON.stringify({
      message_type: 'note',
      type: 'admin',
      admin_id: adminId,
      body,
    }),
  });

  return res.ok;
}

// ─── Registration flow ────────────────────────────────────────────────

function generateCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

interface RegState {
  chat_id: string;
  admin_id: string | null;
  admin_name: string | null;
  code: string | null;
  step: string;
  expires_at: number;
}

function getState(chatId: string): RegState | undefined {
  return db.prepare('SELECT * FROM telegram_reg WHERE chat_id = ?').get(chatId) as RegState | undefined;
}

function setState(chatId: string, updates: Partial<RegState>): void {
  const existing = getState(chatId);
  if (existing) {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
    params.push(chatId);
    db.prepare(`UPDATE telegram_reg SET ${sets.join(', ')} WHERE chat_id = ?`).run(...params);
  } else {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO telegram_reg (chat_id, step, expires_at, admin_id, admin_name, code)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      chatId,
      updates.step || 'await_admin_id',
      updates.expires_at || now + CODE_TTL,
      updates.admin_id || null,
      updates.admin_name || null,
      updates.code || null,
    );
  }
}

function clearState(chatId: string): void {
  db.prepare('DELETE FROM telegram_reg WHERE chat_id = ?').run(chatId);
}

function isRegistered(chatId: string): boolean {
  const row = db.prepare('SELECT 1 FROM admin_telegram WHERE telegram_chat_id = ?').get(chatId);
  return !!row;
}

async function handleMessage(chatId: string, text: string, tgUsername?: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // /start — always restart flow
  if (text === '/start') {
    clearState(chatId);

    if (isRegistered(chatId)) {
      await tgSend(chatId,
        '✅ Вы уже зарегистрированы и получаете уведомления.\n\n' +
        'Чтобы перепривязать аккаунт, введите /reset');
      return;
    }

    setState(chatId, { step: 'await_admin_id', expires_at: now + CODE_TTL });
    await tgSend(chatId,
      '👋 Привет! Я бот уведомлений Intercom.\n\n' +
      'Для привязки мне нужен ваш <b>Admin ID</b> из Intercom.\n\n' +
      '📍 Где найти:\n' +
      'Intercom → Settings → Your profile → скопируйте ID из URL\n' +
      '<code>app.intercom.com/a/apps/.../admins/XXXXXXX</code>\n\n' +
      'Введите ваш Admin ID:');
    return;
  }

  // /reset — unregister
  if (text === '/reset') {
    db.prepare('DELETE FROM admin_telegram WHERE telegram_chat_id = ?').run(chatId);
    clearState(chatId);
    await tgSend(chatId, '🔄 Привязка удалена. Введите /start для повторной регистрации.');
    return;
  }

  // /status
  if (text === '/status') {
    const mapping = db.prepare(
      `SELECT t.admin_id, a.name FROM admin_telegram t
       LEFT JOIN admins a ON a.id = t.admin_id
       WHERE t.telegram_chat_id = ?`,
    ).get(chatId) as { admin_id: string; name: string | null } | undefined;

    if (mapping) {
      await tgSend(chatId, `✅ Привязан к: <b>${mapping.name || mapping.admin_id}</b>`);
    } else {
      await tgSend(chatId, '❌ Не привязан. Введите /start');
    }
    return;
  }

  const state = getState(chatId);

  // No active registration
  if (!state) {
    await tgSend(chatId, 'Введите /start для начала регистрации.');
    return;
  }

  // Expired
  if (now > state.expires_at) {
    clearState(chatId);
    await tgSend(chatId, '⏰ Время истекло. Введите /start для повторной попытки.');
    return;
  }

  // Step 1: waiting for admin ID
  if (state.step === 'await_admin_id') {
    const adminId = text.trim();
    const admin = findAdmin(adminId);

    if (!admin) {
      await tgSend(chatId,
        '❌ Admin ID не найден в системе.\n\n' +
        'Убедитесь, что вводите числовой ID из URL профиля Intercom.\n' +
        'Попробуйте ещё раз:');
      return;
    }

    // Check if this admin is already linked to another telegram
    const existing = db.prepare('SELECT telegram_chat_id FROM admin_telegram WHERE admin_id = ?')
      .get(adminId) as { telegram_chat_id: string } | undefined;
    if (existing && existing.telegram_chat_id !== chatId) {
      await tgSend(chatId, '⚠️ Этот аккаунт уже привязан к другому Telegram. Обратитесь к администратору.');
      clearState(chatId);
      return;
    }

    const code = generateCode();

    await tgSend(chatId,
      `✅ Найден: <b>${admin.name || adminId}</b>${admin.email ? ` (${admin.email})` : ''}\n\n` +
      '🔐 Отправляю код подтверждения в Intercom...');

    const sent = await sendIntercomVerification(adminId, code);

    if (!sent) {
      await tgSend(chatId,
        '❌ Не удалось отправить код в Intercom (нет диалогов на вашем аккаунте).\n' +
        'Обратитесь к администратору для ручной привязки.');
      clearState(chatId);
      return;
    }

    setState(chatId, {
      step: 'await_code',
      admin_id: adminId,
      admin_name: admin.name,
      code,
      expires_at: now + CODE_TTL,
    });

    await tgSend(chatId,
      '📨 Код отправлен в Intercom!\n\n' +
      'Откройте Intercom → найдите заметку с кодом в последнем диалоге.\n\n' +
      'Введите 6-значный код:');
    return;
  }

  // Step 2: waiting for verification code
  if (state.step === 'await_code') {
    const input = text.trim();

    if (input !== state.code) {
      await tgSend(chatId, '❌ Неверный код. Попробуйте ещё раз:');
      return;
    }

    // Success — save mapping
    db.prepare(
      `INSERT INTO admin_telegram (admin_id, telegram_chat_id, username)
       VALUES (?, ?, ?)
       ON CONFLICT(admin_id) DO UPDATE SET
         telegram_chat_id = excluded.telegram_chat_id,
         username = excluded.username`,
    ).run(state.admin_id, chatId, tgUsername || null);

    clearState(chatId);

    await tgSend(chatId,
      `✅ Готово! Привязка подтверждена.\n\n` +
      `Вы будете получать уведомления о новых сообщениях в диалогах, назначенных на <b>${state.admin_name || state.admin_id}</b>.\n\n` +
      'Команды:\n' +
      '/status — проверить привязку\n' +
      '/reset — отвязать аккаунт');
    return;
  }
}

// ─── Main polling loop ────────────────────────────────────────────────

async function main() {
  console.log('telegram-bot: starting long-polling...');
  let offset = 0;

  // Clean up expired registrations
  db.prepare('DELETE FROM telegram_reg WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));

  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message?.text) {
          const chatId = String(u.message.chat.id);
          const text = u.message.text;
          const username = u.message.from?.username;
          try {
            await handleMessage(chatId, text, username);
          } catch (err) {
            console.error(`telegram-bot: error handling message from ${chatId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('telegram-bot: polling error', err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => {
  console.error('telegram-bot: fatal', e);
  process.exit(1);
});
