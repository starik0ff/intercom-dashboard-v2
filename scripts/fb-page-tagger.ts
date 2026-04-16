#!/usr/bin/env npx tsx
/**
 * Intercom Facebook Page Tagger
 * ==============================
 * Webhook-сервер, который слушает события новых разговоров из Intercom,
 * определяет с какой Facebook-страницы пришло сообщение,
 * и проставляет соответствующий тег + custom attribute на разговор.
 *
 * Запуск:
 *   INTERCOM_ACCESS_TOKEN=... npx tsx scripts/fb-page-tagger.ts
 *
 * Или через .env.local (проект подтягивает автоматически):
 *   npx tsx scripts/fb-page-tagger.ts
 *
 * Переменные окружения:
 *   INTERCOM_ACCESS_TOKEN / INTERCOM_TOKEN  — токен из Intercom Developer Hub
 *   WEBHOOK_SECRET         — секрет для верификации подписи (опционально)
 *   FB_TAGGER_PORT         — порт сервера (по умолчанию 5100)
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import http from 'node:http';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Конфигурация
// ---------------------------------------------------------------------------

const INTERCOM_TOKEN =
  process.env.INTERCOM_ACCESS_TOKEN ||
  process.env.INTERCOM_TOKEN ||
  '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const PORT = parseInt(process.env.FB_TAGGER_PORT || '5100', 10);
const ADMIN_ID = process.env.INTERCOM_ADMIN_ID || '9807662'; // Leo JGGL — для тегирования

if (!INTERCOM_TOKEN) {
  console.error(
    'INTERCOM_ACCESS_TOKEN / INTERCOM_TOKEN не задан.\n' +
      'Установите переменную окружения или добавьте в .env.local',
  );
  process.exit(1);
}

// ┌──────────────────────────────────────────────────────────────────────────┐
// │ МАППИНГ: Facebook Page ID → тег на разговор                            │
// │                                                                        │
// │ Чтобы узнать Page ID:                                                  │
// │   1. Откройте FB-страницу → Информация → ID страницы                   │
// │   2. Или через /debug/conversation/:id (см. ниже)                      │
// │                                                                        │
// │ ⚠ ЗАМЕНИТЕ примеры на реальные Page ID перед запуском!                 │
// └──────────────────────────────────────────────────────────────────────────┘
const PAGE_ID_TO_TAG: Record<string, string> = {
  '900992606431564': 'fb-jggl',         // JGGL (2421 разговор)
  '990413554162384': 'fb-atla',         // Atla (195 разговоров)
  '555314024322717': 'fb-arteki-public', // Arteki Studio (4 разговора)
  '986528271220596': 'fb-arteki-brad',  // Brad's Comics
};

// Запасной вариант — определение по имени страницы в тексте / subject / URL
const PAGE_NAME_TO_TAG: Record<string, string> = {
  JGGL: 'fb-jggl',
  Atla: 'fb-atla',
  'Arteki Studio': 'fb-arteki-public',
  "Brad's Comics": 'fb-arteki-brad',
};

// ---------------------------------------------------------------------------
// Intercom API helpers
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.intercom.io';
const API_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${INTERCOM_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'Intercom-Version': '2.11',
};

async function apiGet<T = Record<string, unknown>>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: API_HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiPut(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: API_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Получение данных о разговоре
// ---------------------------------------------------------------------------

interface IcConversation {
  id: string;
  source?: {
    type?: string;
    delivered_as?: string;
    body?: string;
    subject?: string;
    url?: string;
    author?: { type?: string; id?: string };
  };
  contacts?: { contacts: Array<{ id?: string }> };
  conversation_parts?: {
    conversation_parts: Array<{
      metadata?: Record<string, unknown>;
    }>;
  };
  custom_attributes?: Record<string, unknown>;
  [k: string]: unknown;
}

async function getConversation(id: string): Promise<IcConversation | null> {
  try {
    return await apiGet<IcConversation>(`/conversations/${id}`);
  } catch (e) {
    log('error', `Ошибка при получении разговора ${id}: ${e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Определение Facebook Page ID
// ---------------------------------------------------------------------------

function findFacebookPageId(conv: IcConversation): string | null {
  // Вариант 1: в conversation_parts metadata
  const parts = conv.conversation_parts?.conversation_parts ?? [];
  for (const part of parts) {
    const meta = part.metadata;
    if (meta && typeof meta === 'object') {
      if ('page_id' in meta) return String(meta.page_id);
      if ('facebook_page_id' in meta) return String(meta.facebook_page_id);
    }
  }

  // Вариант 2: в custom_attributes (любое поле с «page» или «facebook»)
  const attrs = conv.custom_attributes;
  if (attrs && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      const k = key.toLowerCase();
      if (k.includes('page') || k.includes('facebook')) {
        log('info', `Найден атрибут ${key} = ${value}`);
        return String(value);
      }
    }
  }

  // Вариант 3: из social profiles контакта
  const contacts = conv.contacts?.contacts ?? [];
  for (const c of contacts) {
    if (c.id) {
      const pageId = getPageIdFromContactSync(c.id);
      if (pageId) return pageId;
    }
  }

  return null;
}

// Кэш запросов контактов (чтобы не дёргать API повторно)
const contactCache = new Map<string, string | null>();

function getPageIdFromContactSync(contactId: string): string | null {
  if (contactCache.has(contactId)) return contactCache.get(contactId)!;
  return null; // async вариант ниже
}

async function getPageIdFromContact(contactId: string): Promise<string | null> {
  if (contactCache.has(contactId)) return contactCache.get(contactId)!;
  try {
    const contact = await apiGet<{
      social_profiles?: { data?: Array<{ name?: string; id?: string; url?: string }> };
    }>(`/contacts/${contactId}`);
    const profiles = contact.social_profiles?.data ?? [];
    for (const p of profiles) {
      if (p.name?.toLowerCase() === 'facebook') {
        const id = p.id || p.url || null;
        contactCache.set(contactId, id);
        return id;
      }
    }
  } catch (e) {
    log('error', `Ошибка при получении контакта ${contactId}: ${e}`);
  }
  contactCache.set(contactId, null);
  return null;
}

// ---------------------------------------------------------------------------
// Определение тега (основная логика)
// ---------------------------------------------------------------------------

async function determineTag(conv: IcConversation): Promise<string | null> {
  const cid = conv.id;

  // Стратегия 0 (основная): Page ID из source.url
  // Intercom хранит ссылку вида https://www.facebook.com/{PAGE_ID}
  const sourceUrl = conv.source?.url || '';
  const urlMatch = sourceUrl.match(/facebook\.com\/(\d+)/);
  if (urlMatch) {
    const urlPageId = urlMatch[1];
    if (PAGE_ID_TO_TAG[urlPageId]) {
      log('info', `[${cid}] Определена страница по source.url: ${urlPageId}`);
      return PAGE_ID_TO_TAG[urlPageId];
    }
    log('warn', `[${cid}] Page ID ${urlPageId} из source.url не найден в маппинге`);
  }

  // Стратегия 0b: Page ID из first_contact_reply.url (дублирует source.url)
  const firstReplyUrl = (conv as Record<string, unknown>).first_contact_reply as
    | { url?: string }
    | undefined;
  if (firstReplyUrl?.url) {
    const replyMatch = firstReplyUrl.url.match(/facebook\.com\/(\d+)/);
    if (replyMatch && PAGE_ID_TO_TAG[replyMatch[1]]) {
      log('info', `[${cid}] Определена страница по first_contact_reply.url: ${replyMatch[1]}`);
      return PAGE_ID_TO_TAG[replyMatch[1]];
    }
  }

  // Стратегия 1: по Page ID из метаданных разговора
  let pageId = findFacebookPageId(conv);

  // Стратегия 1b: async lookup через контакт API
  if (!pageId) {
    for (const c of conv.contacts?.contacts ?? []) {
      if (c.id) {
        pageId = await getPageIdFromContact(c.id);
        if (pageId) break;
      }
    }
  }

  if (pageId && PAGE_ID_TO_TAG[pageId]) {
    log('info', `[${cid}] Определена страница по Page ID: ${pageId}`);
    return PAGE_ID_TO_TAG[pageId];
  }

  // Стратегия 2: по содержимому source (body / subject / url)
  const source = conv.source;
  if (source) {
    const haystack = [source.body, source.subject, source.url]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    for (const [name, tag] of Object.entries(PAGE_NAME_TO_TAG)) {
      if (haystack.includes(name.toLowerCase())) {
        log('info', `[${cid}] Определена страница по source текст: ${name}`);
        return tag;
      }
    }
  }

  // Не удалось определить — логируем для отладки
  log(
    'warn',
    `[${cid}] Не удалось определить FB-страницу.\n` +
      `  source: ${JSON.stringify(source, null, 2)}\n` +
      `  custom_attributes: ${JSON.stringify(conv.custom_attributes)}`,
  );

  return null;
}

// ---------------------------------------------------------------------------
// Тегирование через Intercom API
// ---------------------------------------------------------------------------

let tagsCache: Map<string, string> | null = null;

async function findOrCreateTag(tagName: string): Promise<string | null> {
  // Один раз загружаем все теги
  if (!tagsCache) {
    tagsCache = new Map();
    try {
      const data = await apiGet<{ data?: Array<{ id: string; name: string }> }>('/tags');
      for (const t of data.data ?? []) tagsCache.set(t.name, t.id);
    } catch (e) {
      log('error', `Ошибка при загрузке тегов: ${e}`);
    }
  }

  if (tagsCache.has(tagName)) return tagsCache.get(tagName)!;

  // Создаём новый тег
  try {
    const created = await apiPost<{ id: string }>('/tags', { name: tagName });
    log('info', `Создан тег '${tagName}' id=${created.id}`);
    tagsCache.set(tagName, created.id);
    return created.id;
  } catch (e) {
    log('error', `Ошибка при создании тега '${tagName}': ${e}`);
    return null;
  }
}

async function tagConversation(convId: string, tagName: string): Promise<boolean> {
  const tagId = await findOrCreateTag(tagName);
  if (!tagId) return false;
  try {
    await apiPost(`/conversations/${convId}/tags`, { id: tagId, admin_id: ADMIN_ID });
    log('info', `Тег '${tagName}' проставлен на ${convId}`);
    return true;
  } catch (e) {
    log('error', `Ошибка при тегировании ${convId}: ${e}`);
    return false;
  }
}

async function setConversationAttribute(
  convId: string,
  attrName: string,
  attrValue: string,
): Promise<boolean> {
  try {
    await apiPut(`/conversations/${convId}`, {
      custom_attributes: { [attrName]: attrValue },
    });
    log('info', `Атрибут '${attrName}'='${attrValue}' на ${convId}`);
    return true;
  } catch (e) {
    log('error', `Ошибка при обновлении атрибута на ${convId}: ${e}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Верификация подписи
// ---------------------------------------------------------------------------

function verifySignature(payload: Buffer, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(signature),
  );
}

// ---------------------------------------------------------------------------
// Обработка webhook
// ---------------------------------------------------------------------------

const RELEVANT_TOPICS = new Set([
  'conversation.created',
  'conversation.user.created',
  'conversation_part.tag.created',
]);

async function handleWebhook(body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const topic = String(body.topic || '');
  log('info', `Webhook: ${topic}`);

  if (!RELEVANT_TOPICS.has(topic)) {
    return { status: 200, body: { status: 'ignored', topic } };
  }

  const item = (body.data as Record<string, unknown>)?.item as
    | Record<string, unknown>
    | undefined;
  const convId = item?.id as string | undefined;
  if (!convId) {
    return { status: 400, body: { error: 'no conversation_id' } };
  }

  const source = item?.source as Record<string, string> | undefined;
  const sourceType = source?.type || '';
  log(
    'info',
    `Разговор ${convId}: delivered_as=${source?.delivered_as}, type=${sourceType}`,
  );

  // Обрабатываем ТОЛЬКО Facebook-разговоры
  if (sourceType !== 'facebook') {
    log('info', `[${convId}] Пропускаем — не Facebook (type=${sourceType})`);
    return { status: 200, body: { status: 'ignored', reason: 'not_facebook' } };
  }

  // Получаем полные данные
  const conv = await getConversation(convId);
  if (!conv) {
    return { status: 500, body: { error: 'failed to fetch conversation' } };
  }

  // ========================================================================
  // ОТЛАДКА: раскомментируйте строку ниже при первом запуске, чтобы увидеть
  // полную структуру данных разговора в логах.
  // ========================================================================
  // log('info', `FULL DATA: ${JSON.stringify(conv, null, 2)}`);

  const tag = await determineTag(conv);

  if (tag) {
    await tagConversation(convId, tag);
    // Определяем человеко-читаемое имя страницы
    let pageName = tag.replace('fb-', '').toUpperCase();
    for (const [name, t] of Object.entries(PAGE_NAME_TO_TAG)) {
      if (t === tag) {
        pageName = name;
        break;
      }
    }
    await setConversationAttribute(convId, 'Facebook Page', pageName);
  } else {
    await tagConversation(convId, 'fb-unknown');
    log('warn', `Разговор ${convId}: страница не определена`);
  }

  return { status: 200, body: { status: 'processed', tag } };
}

// ---------------------------------------------------------------------------
// HTTP-сервер
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, obj: unknown) {
  const str = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(str),
  });
  res.end(str);
}

function log(level: string, msg: string) {
  const ts = new Date().toISOString();
  const prefix = level.toUpperCase().padEnd(5);
  console.log(`${ts} [${prefix}] ${msg}`);
}

// Счётчики для мониторинга
let statsProcessed = 0;
let statsTagged = 0;
let statsUnknown = 0;
let statsIgnored = 0;

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // Health check
  if (req.method === 'GET' && url === '/health') {
    return json(res, 200, {
      status: 'healthy',
      uptime: process.uptime(),
      stats: {
        processed: statsProcessed,
        tagged: statsTagged,
        unknown: statsUnknown,
        ignored: statsIgnored,
      },
    });
  }

  // GET /webhook/intercom — верификация при настройке
  if (req.method === 'GET' && url === '/webhook/intercom') {
    return json(res, 200, { status: 'ok' });
  }

  // Debug endpoint
  if (req.method === 'GET' && url.startsWith('/debug/conversation/')) {
    const convId = url.split('/debug/conversation/')[1];
    if (!convId) return json(res, 400, { error: 'missing id' });
    const conv = await getConversation(convId);
    if (!conv) return json(res, 404, { error: 'not found' });
    return json(res, 200, conv);
  }

  // POST /webhook/intercom — основной webhook
  if (req.method === 'POST' && url === '/webhook/intercom') {
    const raw = await readBody(req);
    const sig = (req.headers['x-hub-signature-256'] as string) || '';
    if (!verifySignature(raw, sig)) {
      log('warn', 'Невалидная подпись webhook');
      return json(res, 401, { error: 'invalid signature' });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(res, 400, { error: 'invalid json' });
    }

    const result = await handleWebhook(body);
    statsProcessed++;
    if (result.body.tag) statsTagged++;
    else if (result.body.status === 'ignored') statsIgnored++;
    else statsUnknown++;

    return json(res, result.status, result.body);
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  log('info', `FB Page Tagger запущен на порту ${PORT}`);
  log('info', `Webhook URL: http://YOUR_SERVER:${PORT}/webhook/intercom`);
  log('info', `Health:      http://localhost:${PORT}/health`);
  log('info', `Debug:       http://localhost:${PORT}/debug/conversation/:id`);
  log('info', `Настроено страниц: ${Object.keys(PAGE_ID_TO_TAG).length}`);
  log('info', `Секрет подписи: ${WEBHOOK_SECRET ? 'да' : 'нет (проверка отключена)'}`);
});
