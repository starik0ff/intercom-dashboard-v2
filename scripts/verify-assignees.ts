#!/usr/bin/env npx tsx

/**
 * Проверяет, что у менеджеров не пропали диалоги после переноса.
 * Ищет диалоги в командных корзинах, где admin_assignee_id = null
 * (т.е. менеджер был потерян при переносе).
 */

const API_TOKEN = process.env.INTERCOM_TOKEN;
if (!API_TOKEN) throw new Error('INTERCOM_TOKEN env var is required');
const BASE_URL = 'https://api.intercom.io';
const RATE_LIMIT_DELAY = 150;

const TEAM_IDS = [
  '10204130', '10204133', '10204137', '10204141',
  '10204147', '10204158', '10204191', '10204195',
];

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
  console.log('Проверка потерянных assignee после переноса...\n');

  // Ищем диалоги в командных корзинах без admin_assignee
  let totalOrphaned = 0;
  const orphanedByTeam: Record<string, string[]> = {};

  for (const teamId of TEAM_IDS) {
    let cursor: string | undefined;
    let page = 0;
    const orphaned: string[] = [];

    while (true) {
      page++;
      const body = {
        query: {
          operator: 'AND',
          value: [
            { field: 'team_assignee_id', operator: '=', value: parseInt(teamId) },
            { field: 'admin_assignee_id', operator: '=', value: 0 }, // unassigned
          ],
        },
        pagination: { per_page: 150, ...(cursor ? { starting_after: cursor } : {}) },
      };

      const res = await fetchRetry(`${BASE_URL}/conversations/search`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      const data = await res.json();
      const convs = data.conversations || [];

      for (const c of convs) {
        if (!c.admin_assignee_id) {
          orphaned.push(c.id);
        }
      }

      process.stdout.write(`  Team ${teamId}: стр.${page}, проверено ${convs.length}\r`);

      const next = data.pages?.next?.starting_after;
      if (!next) break;
      cursor = next;
      await sleep(RATE_LIMIT_DELAY);
    }

    if (orphaned.length > 0) {
      orphanedByTeam[teamId] = orphaned;
      totalOrphaned += orphaned.length;
    }
    console.log(`  Team ${teamId}: ${orphaned.length} без assignee`);
  }

  console.log(`\n${'='.repeat(50)}`);

  if (totalOrphaned === 0) {
    console.log('Все диалоги имеют assignee. Потерь нет!');
  } else {
    console.log(`ВНИМАНИЕ: ${totalOrphaned} диалогов без admin assignee:\n`);
    for (const [teamId, ids] of Object.entries(orphanedByTeam)) {
      console.log(`  Team ${teamId}: ${ids.length} диалогов`);
      // Показать первые 5
      for (const id of ids.slice(0, 5)) {
        console.log(`    - ${id}`);
      }
      if (ids.length > 5) console.log(`    ... и ещё ${ids.length - 5}`);
    }
  }

  // Дополнительная проверка: ищем среди всех менеджеров диалоги, которые были, но пропали
  console.log('\nПроверка количества диалогов по менеджерам...');

  const adminsRes = await fetchRetry(`${BASE_URL}/admins`, { headers });
  const adminsData = await adminsRes.json();
  const admins = adminsData.admins.filter((a: { has_inbox_seat: boolean; name: string }) =>
    a.has_inbox_seat && /[Tt]eam[\s_']*[A-J]/i.test(a.name)
  );

  for (const admin of admins) {
    const body = {
      query: {
        operator: 'AND',
        value: [{ field: 'admin_assignee_id', operator: '=', value: admin.id }],
      },
      pagination: { per_page: 1 },
    };

    const res = await fetchRetry(`${BASE_URL}/conversations/search`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await res.json();
    const total = data.total_count ?? data.conversations?.length ?? '?';
    console.log(`  ${admin.name} (${admin.id}): ${total} диалогов`);
    await sleep(RATE_LIMIT_DELAY);
  }

  console.log('\nГотово.');
}

main().catch(err => { console.error(err); process.exit(1); });
