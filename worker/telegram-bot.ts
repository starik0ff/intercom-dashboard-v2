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
  CREATE TABLE IF NOT EXISTS telegram_bot_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at INTEGER NOT NULL DEFAULT (unixepoch()),
    chat_id     TEXT NOT NULL,
    tg_username TEXT,
    event       TEXT NOT NULL,
    admin_id    TEXT,
    admin_email TEXT,
    detail      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tglog_time ON telegram_bot_log(occurred_at);
`);

// Track verification conversation IDs for auto-close after successful verification
const verificationConvIds = new Map<string, string>(); // chatId → intercom conversation id

function logEvent(
  chatId: string,
  event: string,
  opts?: { tgUsername?: string; adminId?: string; adminEmail?: string; detail?: string },
): void {
  db.prepare(
    `INSERT INTO telegram_bot_log (chat_id, tg_username, event, admin_id, admin_email, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(chatId, opts?.tgUsername || null, event, opts?.adminId || null, opts?.adminEmail || null, opts?.detail || null);
}

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

function findAdmin(input: string): AdminRow | undefined {
  // Try by ID first, then by email
  const byId = db.prepare('SELECT id, name, email FROM admins WHERE id = ?').get(input) as AdminRow | undefined;
  if (byId) return byId;
  const byEmail = db.prepare('SELECT id, name, email FROM admins WHERE LOWER(email) = LOWER(?)').get(input) as AdminRow | undefined;
  return byEmail;
}

async function sendIntercomVerification(adminId: string, adminEmail: string, code: string): Promise<{ ok: boolean; convId?: string }> {
  // Create a contact-initiated conversation from a dedicated verification contact.
  // This appears as a NEW separate conversation in the admin's inbox.

  const contactId = await getOrCreateVerificationContact();
  if (!contactId) {
    console.error('telegram-bot: could not find/create verification contact');
    return { ok: false };
  }

  // Step 1: Create contact-initiated conversation
  // Intercom API expects type:"user" (not "contact") for POST /conversations
  const createRes = await fetch(`${INTERCOM_API}/conversations`, {
    method: 'POST',
    headers: intercomHeaders(),
    body: JSON.stringify({
      from: { type: 'user', id: contactId },
      body: `🔐 Код подтверждения Telegram\n\nВаш код: ${code}\n\nВведите этот код в Telegram-бот для привязки уведомлений.\nКод действует 10 минут.`,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error(`telegram-bot: create conversation failed (${createRes.status}):`, err);
    return { ok: false };
  }

  const conv = (await createRes.json()) as { conversation_id?: string; id?: string };
  const convId = conv.conversation_id || conv.id;
  if (!convId) {
    console.error('telegram-bot: no conversation id in response');
    return { ok: false };
  }

  // Step 2: Assign conversation to the admin so it appears in their inbox
  const OWNER_ADMIN_ID = '9086168';
  const assignRes = await fetch(`${INTERCOM_API}/conversations/${convId}/parts`, {
    method: 'POST',
    headers: intercomHeaders(),
    body: JSON.stringify({
      message_type: 'assignment',
      type: 'admin',
      admin_id: OWNER_ADMIN_ID,
      assignee_id: adminId,
      body: '',
    }),
  });

  return { ok: true, convId };
}

async function closeVerificationConversation(convId: string, adminId: string): Promise<void> {
  const res = await fetch(`${INTERCOM_API}/conversations/${convId}/parts`, {
    method: 'POST',
    headers: intercomHeaders(),
    body: JSON.stringify({
      message_type: 'close',
      type: 'admin',
      admin_id: adminId,
      body: 'Привязка Telegram подтверждена.',
    }),
  });
  if (!res.ok) {
    console.error(`telegram-bot: close conv ${convId} failed (${res.status})`);
  }
}

async function getOrCreateVerificationContact(): Promise<string | null> {
  const VERIFICATION_EMAIL = 'telegram-verify@atomgroup.dev';

  const searchRes = await fetch(`${INTERCOM_API}/contacts/search`, {
    method: 'POST',
    headers: intercomHeaders(),
    body: JSON.stringify({
      query: { field: 'email', operator: '=', value: VERIFICATION_EMAIL },
    }),
  });

  if (searchRes.ok) {
    const data = (await searchRes.json()) as { data: { id: string }[] };
    if (data.data?.length > 0) return data.data[0].id;
  }
  const createRes = await fetch(`${INTERCOM_API}/contacts`, {
    method: 'POST',
    headers: intercomHeaders(),
    body: JSON.stringify({
      role: 'user',
      email: VERIFICATION_EMAIL,
      name: 'Telegram Verification',
    }),
  });

  if (createRes.ok) {
    const contact = (await createRes.json()) as { id: string };
    return contact.id;
  }

  console.error('telegram-bot: failed to create verification contact');
  return null;
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
    logEvent(chatId, 'start', { tgUsername });

    if (isRegistered(chatId)) {
      await tgSend(chatId,
        '✅ Вы уже зарегистрированы и получаете уведомления.\n\n' +
        'Чтобы перепривязать аккаунт, введите /reset');
      return;
    }

    setState(chatId, { step: 'await_admin_id', expires_at: now + CODE_TTL });
    await tgSend(chatId,
      '👋 Привет! Я бот уведомлений Intercom.\n\n' +
      'Введите ваш <b>рабочий email</b>, который используется в Intercom:');
    return;
  }

  // /reset — unregister
  if (text === '/reset') {
    logEvent(chatId, 'reset', { tgUsername });
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
    const input = text.trim();
    const admin = findAdmin(input);

    if (!admin) {
      logEvent(chatId, 'email_entered', { tgUsername, adminEmail: input, detail: 'not_found' });
      await tgSend(chatId,
        '❌ Аккаунт не найден.\n\n' +
        'Убедитесь, что вводите email, привязанный к Intercom.\n' +
        'Попробуйте ещё раз:');
      return;
    }

    // Check if this admin is already linked to another telegram
    const existing = db.prepare('SELECT telegram_chat_id FROM admin_telegram WHERE admin_id = ?')
      .get(admin.id) as { telegram_chat_id: string } | undefined;
    if (existing && existing.telegram_chat_id !== chatId) {
      await tgSend(chatId, '⚠️ Этот аккаунт уже привязан к другому Telegram. Обратитесь к администратору.');
      clearState(chatId);
      return;
    }

    const code = generateCode();
    logEvent(chatId, 'email_entered', { tgUsername, adminId: admin.id, adminEmail: admin.email || input });

    await tgSend(chatId,
      `✅ Найден: <b>${admin.name || admin.id}</b>${admin.email ? ` (${admin.email})` : ''}\n\n` +
      '🔐 Отправляю код подтверждения в Intercom...');

    const result = await sendIntercomVerification(admin.id, admin.email || input, code);

    if (!result.ok) {
      console.log(`telegram-bot: no conversations for ${admin.id}, using direct code flow`);
      logEvent(chatId, 'code_sent', { tgUsername, adminId: admin.id, adminEmail: admin.email || input, detail: 'fallback_no_conversations' });
      await tgSend(chatId,
        '⚠️ Не удалось отправить код через Intercom (нет диалогов).\n\n' +
        'Альтернативная проверка: попросите администратора подтвердить привязку ' +
        'через панель управления, или обратитесь к коллеге с доступом к Intercom — ' +
        `пусть найдёт заметку с кодом <b>${code}</b> и подтвердит.\n\n` +
        'Или введите /start для повторной попытки.');
      setState(chatId, {
        step: 'await_code',
        admin_id: admin.id,
        admin_name: admin.name,
        code,
        expires_at: now + CODE_TTL,
      });
      return;
    }

    logEvent(chatId, 'code_sent', { tgUsername, adminId: admin.id, adminEmail: admin.email || input });
    if (result.convId) verificationConvIds.set(chatId, result.convId);

    setState(chatId, {
      step: 'await_code',
      admin_id: admin.id,
      admin_name: admin.name,
      code,
      expires_at: now + CODE_TTL,
    });

    await tgSend(chatId,
      '📨 Код отправлен в Intercom!\n\n' +
      'Откройте Intercom → найдите диалог с "Telegram Verification Bot" в списке.\n\n' +
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

    logEvent(chatId, 'verified', { tgUsername, adminId: state.admin_id || undefined, adminEmail: undefined, detail: state.admin_name || undefined });

    // Close verification conversation in Intercom
    const vcId = verificationConvIds.get(chatId);
    if (vcId && state.admin_id) {
      await closeVerificationConversation(vcId, state.admin_id);
      verificationConvIds.delete(chatId);
    }

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
            console.log(`telegram-bot: msg from ${chatId}: ${text.slice(0, 50)}`);
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
