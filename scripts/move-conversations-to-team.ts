#!/usr/bin/env npx tsx

/**
 * Скрипт для переноса диалогов менеджеров в командные корзины (Team Inbox).
 *
 * Логика:
 * 1. Получает список админов и команд из Intercom API
 * 2. Определяет команду каждого менеджера по его имени (паттерн "Team X" в имени)
 * 3. Ищет все диалоги, назначенные на менеджера
 * 4. Переназначает каждый диалог в командную корзину, сохраняя assignee
 *
 * Использование:
 *   npx tsx scripts/move-conversations-to-team.ts --dry-run    # Только показать план
 *   npx tsx scripts/move-conversations-to-team.ts              # Выполнить перенос
 *   npx tsx scripts/move-conversations-to-team.ts --admin-id 9807578  # Для конкретного менеджера
 */

const API_TOKEN = process.env.INTERCOM_TOKEN;
if (!API_TOKEN) throw new Error('INTERCOM_TOKEN env var is required');
const BASE_URL = 'https://api.intercom.io';
const DRY_RUN = process.argv.includes('--dry-run');
const SPECIFIC_ADMIN = process.argv.find((_, i, arr) => arr[i - 1] === '--admin-id') || null;
const RATE_LIMIT_DELAY = 150; // ms between API calls

// Маппинг букв команд на Team ID
const TEAM_MAP: Record<string, { id: string; name: string }> = {
  'A': { id: '10204130', name: "Team 'A'" },
  'B': { id: '10204133', name: "Team 'B'" },
  'C': { id: '10204137', name: "Team 'C'" },
  'D': { id: '10204141', name: "Team 'D'" },
  'E': { id: '10204158', name: "Team 'E'" },
  'F': { id: '10204147', name: "Team 'F'" },
  'H': { id: '10204191', name: "Team 'H'" },
  'J': { id: '10204195', name: "Team 'J'" },
};

interface Admin {
  id: string;
  name: string;
  email: string;
  team_ids: number[];
  has_inbox_seat: boolean;
}

interface Conversation {
  id: string;
  title?: string;
  state: string;
  assignee?: { id: string; type: string };
  team_assignee_id?: string;
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

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
        console.log(`  Rate limit, ждём ${retryAfter}с (попытка ${attempt}/${retries})...`);
        await sleep(retryAfter * 1000);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = attempt * 3000;
      console.log(`  Ошибка сети, повтор через ${delay / 1000}с (попытка ${attempt}/${retries})...`);
      await sleep(delay);
    }
  }
  throw new Error('Max retries exceeded');
}

async function apiGet(path: string) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function apiPut(path: string, body: object) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function extractTeamLetter(name: string): string | null {
  // Matches patterns like "Team A", "Team B", "team_B", "Team 'A'", etc.
  const match = name.match(/[Tt]eam[\s_']*([A-J])/i);
  return match ? match[1].toUpperCase() : null;
}

async function getAdmins(): Promise<Admin[]> {
  const data = await apiGet('/admins');
  return data.admins;
}

async function searchConversations(adminId: string, startingAfter?: string): Promise<{
  conversations: Conversation[];
  hasMore: boolean;
  nextCursor?: string;
}> {
  const body: Record<string, unknown> = {
    query: {
      operator: 'AND',
      value: [
        {
          field: 'admin_assignee_id',
          operator: '=',
          value: adminId,
        },
      ],
    },
    pagination: {
      per_page: 150,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    },
  };

  const res = await fetchWithRetry(`${BASE_URL}/conversations/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Search failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    conversations: data.conversations || [],
    hasMore: data.pages?.next?.starting_after != null,
    nextCursor: data.pages?.next?.starting_after,
  };
}

async function getAllConversationsForAdmin(adminId: string): Promise<Conversation[]> {
  const all: Conversation[] = [];
  let cursor: string | undefined;
  let page = 1;

  while (true) {
    process.stdout.write(`  Страница ${page}...`);
    const result = await searchConversations(adminId, cursor);
    all.push(...result.conversations);
    process.stdout.write(` найдено ${result.conversations.length} (всего: ${all.length})\n`);

    if (!result.hasMore) break;
    cursor = result.nextCursor;
    page++;
    await sleep(RATE_LIMIT_DELAY);
  }

  return all;
}

async function apiPost(path: string, body: object) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function assignToTeam(conversationId: string, teamId: string, adminId: string, wasClosed: boolean) {
  // 1. Назначаем на команду
  await apiPost(`/conversations/${conversationId}/parts`, {
    message_type: 'assignment',
    type: 'team',
    assignee_id: teamId,
    admin_id: adminId,
    body: '',
  });
  await sleep(RATE_LIMIT_DELAY);
  // 2. Возвращаем менеджера как assignee
  await apiPost(`/conversations/${conversationId}/parts`, {
    message_type: 'assignment',
    type: 'admin',
    assignee_id: adminId,
    admin_id: adminId,
    body: '',
  });
  // 3. Если диалог был закрыт — закрываем обратно
  if (wasClosed) {
    await sleep(RATE_LIMIT_DELAY);
    await apiPost(`/conversations/${conversationId}/parts`, {
      message_type: 'close',
      type: 'admin',
      admin_id: adminId,
      body: '',
    });
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log(DRY_RUN
    ? '  РЕЖИМ ПРОСМОТРА (dry-run) — изменения НЕ будут применены'
    : '  РЕЖИМ ВЫПОЛНЕНИЯ — диалоги будут перенесены!');
  console.log('='.repeat(60));
  console.log();

  // 1. Получаем админов
  console.log('Загрузка списка менеджеров...');
  const admins = await getAdmins();

  // 2. Строим маппинг: admin -> team
  const adminTeamMap: { admin: Admin; teamLetter: string; teamInfo: { id: string; name: string } }[] = [];

  for (const admin of admins) {
    if (!admin.has_inbox_seat) continue;
    if (SPECIFIC_ADMIN && admin.id !== SPECIFIC_ADMIN) continue;

    const letter = extractTeamLetter(admin.name);
    if (!letter || !TEAM_MAP[letter]) continue;

    adminTeamMap.push({
      admin,
      teamLetter: letter,
      teamInfo: TEAM_MAP[letter],
    });
  }

  console.log(`\nНайдено ${adminTeamMap.length} менеджеров с привязкой к командам:\n`);
  for (const { admin, teamInfo } of adminTeamMap) {
    console.log(`  ${admin.name} (${admin.id}) → ${teamInfo.name}`);
  }
  console.log();

  // 3. Для каждого менеджера находим и переносим диалоги
  let totalMoved = 0;
  let totalErrors = 0;
  let totalSkipped = 0;
  let totalFbSkipped = 0;

  for (const { admin, teamInfo } of adminTeamMap) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Менеджер: ${admin.name} (${admin.id})`);
    console.log(`Целевая команда: ${teamInfo.name} (${teamInfo.id})`);
    console.log();

    // Получаем все диалоги
    const conversations = await getAllConversationsForAdmin(admin.id);

    if (conversations.length === 0) {
      console.log('  Нет диалогов для переноса.');
      continue;
    }

    // Фильтруем — пропускаем уже назначенные на нужную команду
    const toMove = conversations.filter(c => {
      const currentTeam = c.team_assignee_id?.toString();
      return currentTeam !== teamInfo.id;
    });

    const alreadyInTeam = conversations.length - toMove.length;
    if (alreadyInTeam > 0) {
      console.log(`  Уже в команде ${teamInfo.name}: ${alreadyInTeam} диалогов (пропуск)`);
    }

    console.log(`  К переносу: ${toMove.length} диалогов`);
    totalSkipped += alreadyInTeam;

    if (DRY_RUN) {
      totalMoved += toMove.length;
      continue;
    }

    // Переносим
    for (let i = 0; i < toMove.length; i++) {
      const conv = toMove[i];
      try {
        await assignToTeam(conv.id, teamInfo.id, admin.id, conv.state === 'closed');
        totalMoved++;
        if ((i + 1) % 50 === 0 || i === toMove.length - 1) {
          console.log(`  Прогресс: ${i + 1}/${toMove.length}`);
        }
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes('action_forbidden') || errMsg.includes('facebook')) {
          totalFbSkipped++;
        } else {
          totalErrors++;
          console.error(`  ОШИБКА для диалога ${conv.id}: ${err}`);
        }
      }
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  // Итоги
  console.log(`\n${'='.repeat(60)}`);
  console.log('  ИТОГИ');
  console.log('='.repeat(60));
  console.log(`  ${DRY_RUN ? 'Будет перенесено' : 'Перенесено'}: ${totalMoved}`);
  console.log(`  Уже в нужной команде: ${totalSkipped}`);
  if (totalFbSkipped > 0) console.log(`  Пропущено (Facebook 24h): ${totalFbSkipped}`);
  if (totalErrors > 0) console.log(`  Ошибки: ${totalErrors}`);
  console.log();
}

main().catch(err => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
