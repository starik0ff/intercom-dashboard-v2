#!/usr/bin/env npx tsx

/**
 * Закрывает диалоги менеджера, которые сейчас open, но были закрыты до переноса.
 * Определяет это по наличию close/assignment паттерна в истории диалога.
 *
 * Использование:
 *   npx tsx scripts/close-reopened.ts --admin-id 10175875 --dry-run
 *   npx tsx scripts/close-reopened.ts --admin-id 10175875
 */

const API_TOKEN = process.env.INTERCOM_TOKEN;
if (!API_TOKEN) throw new Error('INTERCOM_TOKEN env var is required');
const BASE_URL = 'https://api.intercom.io';
const DRY_RUN = process.argv.includes('--dry-run');
const ADMIN_ID = process.argv.find((_, i, arr) => arr[i - 1] === '--admin-id');
const RATE_LIMIT_DELAY = 150;

if (!ADMIN_ID) {
  console.error('Укажите --admin-id <ID>');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Intercom-Version': '2.11',
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const delay = parseInt(res.headers.get('retry-after') || '5', 10);
        console.log(`  Rate limit, ждём ${delay}с...`);
        await sleep(delay * 1000);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(attempt * 3000);
    }
  }
  throw new Error('Max retries');
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== ВЫПОЛНЕНИЕ ===');
  console.log(`Менеджер: ${ADMIN_ID}\n`);

  // 1. Найти все открытые диалоги менеджера
  const openConvs: string[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    page++;
    const body = {
      query: {
        operator: 'AND',
        value: [
          { field: 'admin_assignee_id', operator: '=', value: ADMIN_ID },
          { field: 'state', operator: '=', value: 'open' },
        ],
      },
      pagination: { per_page: 150, ...(cursor ? { starting_after: cursor } : {}) },
    };

    const res = await fetchRetry(`${BASE_URL}/conversations/search`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await res.json();
    const convs = data.conversations || [];
    openConvs.push(...convs.map((c: { id: string }) => c.id));
    process.stdout.write(`Страница ${page}: найдено ${convs.length} открытых (всего: ${openConvs.length})\n`);

    const next = data.pages?.next?.starting_after;
    if (!next) break;
    cursor = next;
    await sleep(RATE_LIMIT_DELAY);
  }

  console.log(`\nВсего открытых диалогов: ${openConvs.length}`);

  if (openConvs.length === 0) {
    console.log('Нечего закрывать.');
    return;
  }

  // 2. Проверяем каждый — был ли он закрыт ранее (имеет close part до assign_and_reopen)
  const toClose: string[] = [];

  for (let i = 0; i < openConvs.length; i++) {
    const convId = openConvs[i];
    const res = await fetchRetry(`${BASE_URL}/conversations/${convId}`, { headers });
    if (!res.ok) continue;
    const conv = await res.json();

    const parts = conv.conversation_parts?.conversation_parts || [];
    // Ищем последний close и последний assign_and_reopen
    let lastCloseIdx = -1;
    let lastReopenIdx = -1;
    for (let j = 0; j < parts.length; j++) {
      if (parts[j].part_type === 'close') lastCloseIdx = j;
      if (parts[j].part_type === 'assign_and_reopen') lastReopenIdx = j;
    }

    // Если был close до assign_and_reopen — значит перенос его переоткрыл
    if (lastCloseIdx !== -1 && lastReopenIdx > lastCloseIdx) {
      toClose.push(convId);
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  Проверено: ${i + 1}/${openConvs.length}, к закрытию: ${toClose.length}`);
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  console.log(`\nК закрытию: ${toClose.length} из ${openConvs.length} открытых\n`);

  if (DRY_RUN || toClose.length === 0) {
    if (DRY_RUN && toClose.length > 0) console.log('DRY RUN — изменения не применены.');
    return;
  }

  // 3. Закрываем
  let closed = 0, errors = 0;
  for (const convId of toClose) {
    try {
      const res = await fetchRetry(`${BASE_URL}/conversations/${convId}/parts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message_type: 'close', type: 'admin', admin_id: ADMIN_ID, body: '' }),
      });
      if (res.ok) {
        closed++;
      } else {
        errors++;
        const err = await res.text();
        console.error(`  Ошибка ${convId}: ${err}`);
      }
    } catch (err) {
      errors++;
      console.error(`  Ошибка ${convId}: ${err}`);
    }
    if (closed % 20 === 0) console.log(`  Закрыто: ${closed}/${toClose.length}`);
    await sleep(RATE_LIMIT_DELAY);
  }

  console.log(`\n=== ИТОГИ ===`);
  console.log(`Закрыто: ${closed}`);
  if (errors) console.log(`Ошибки: ${errors}`);
}

main().catch(err => { console.error(err); process.exit(1); });
