#!/usr/bin/env npx tsx

/**
 * Check how many Facebook conversations have been moved to team inboxes
 * vs still without a team assignment.
 */

const API_TOKEN = process.env.INTERCOM_TOKEN;
if (!API_TOKEN) throw new Error('INTERCOM_TOKEN env var is required');
const BASE_URL = 'https://api.intercom.io';
const RATE_LIMIT_DELAY = 150;

const TEAM_IDS = new Set([
  '10204130', '10204133', '10204137', '10204141',
  '10204147', '10204158', '10204191', '10204195',
]);

const headers: Record<string, string> = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Intercom-Version': '2.11',
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 5): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);
        console.log(`  Rate limited, waiting ${retryAfter}s (attempt ${attempt}/${retries})...`);
        await sleep(retryAfter * 1000);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = attempt * 3000;
      console.log(`  Network error, retrying in ${delay / 1000}s (attempt ${attempt}/${retries})...`);
      await sleep(delay);
    }
  }
  throw new Error('Max retries exceeded');
}

async function apiGet(path: string) {
  await sleep(RATE_LIMIT_DELAY);
  const res = await fetchWithRetry(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function apiPost(path: string, body: object) {
  await sleep(RATE_LIMIT_DELAY);
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

interface Admin {
  id: string;
  name: string;
  has_inbox_seat: boolean;
}

interface AdminStats {
  name: string;
  totalConvs: number;
  fbConvs: number;
  fbWithTeam: number;
  fbWithoutTeam: number;
}

function matchesTeamPattern(name: string): boolean {
  return /[Tt]eam[\s_']*[A-Ja-j]/i.test(name);
}

function isFacebookSource(source: any): boolean {
  if (!source) return false;
  const type = (source.type || '').toLowerCase();
  const deliveredAs = (source.delivered_as || '').toLowerCase();
  return type.includes('facebook') || deliveredAs.includes('facebook');
}

async function searchConversations(adminId: string, startingAfter?: string) {
  const body: Record<string, unknown> = {
    query: {
      operator: 'AND',
      value: [
        { field: 'admin_assignee_id', operator: '=', value: adminId },
      ],
    },
    pagination: {
      per_page: 150,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    },
  };

  const data = await apiPost('/conversations/search', body);
  return {
    conversations: data.conversations || [],
    hasMore: data.pages?.next?.starting_after != null,
    nextCursor: data.pages?.next?.starting_after as string | undefined,
    totalCount: data.total_count as number,
  };
}

async function main() {
  console.log('Fetching admins...');
  const adminsData = await apiGet('/admins');
  const allAdmins: Admin[] = adminsData.admins || [];

  const teamAdmins = allAdmins.filter(
    (a) => a.has_inbox_seat && matchesTeamPattern(a.name)
  );

  console.log(`Found ${teamAdmins.length} admins matching Team [A-J] pattern:`);
  teamAdmins.forEach((a) => console.log(`  - ${a.name} (id: ${a.id})`));
  console.log('');

  const stats: AdminStats[] = [];
  let grandTotalConvs = 0;
  let grandFb = 0;
  let grandFbWithTeam = 0;
  let grandFbWithoutTeam = 0;

  for (const admin of teamAdmins) {
    console.log(`Searching conversations for ${admin.name}...`);

    let totalConvs = 0;
    let fbConvs = 0;
    let fbWithTeam = 0;
    let fbWithoutTeam = 0;
    let cursor: string | undefined;
    let page = 0;

    do {
      page++;
      const result = await searchConversations(admin.id, cursor);
      const convs = result.conversations;
      totalConvs += convs.length;

      for (const conv of convs) {
        if (isFacebookSource(conv.source)) {
          fbConvs++;
          if (conv.team_assignee_id && TEAM_IDS.has(String(conv.team_assignee_id))) {
            fbWithTeam++;
          } else {
            fbWithoutTeam++;
          }
        }
      }

      if (page === 1) {
        console.log(`  total_count from API: ${result.totalCount}`);
      }
      console.log(`  page ${page}: ${convs.length} convs, ${fbConvs} FB so far`);

      cursor = result.hasMore ? result.nextCursor : undefined;
    } while (cursor);

    stats.push({ name: admin.name, totalConvs, fbConvs, fbWithTeam, fbWithoutTeam });
    grandTotalConvs += totalConvs;
    grandFb += fbConvs;
    grandFbWithTeam += fbWithTeam;
    grandFbWithoutTeam += fbWithoutTeam;

    console.log(`  => ${totalConvs} total, ${fbConvs} FB (${fbWithTeam} with team, ${fbWithoutTeam} without team)\n`);
  }

  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log(`${'Admin'.padEnd(30)} ${'Total'.padStart(7)} ${'FB'.padStart(7)} ${'w/Team'.padStart(7)} ${'no Team'.padStart(7)}`);
  console.log('-'.repeat(70));
  for (const s of stats) {
    console.log(
      `${s.name.padEnd(30)} ${String(s.totalConvs).padStart(7)} ${String(s.fbConvs).padStart(7)} ${String(s.fbWithTeam).padStart(7)} ${String(s.fbWithoutTeam).padStart(7)}`
    );
  }
  console.log('-'.repeat(70));
  console.log(
    `${'TOTAL'.padEnd(30)} ${String(grandTotalConvs).padStart(7)} ${String(grandFb).padStart(7)} ${String(grandFbWithTeam).padStart(7)} ${String(grandFbWithoutTeam).padStart(7)}`
  );
  console.log('');
  console.log(`Facebook conversations moved to team inbox: ${grandFbWithTeam}`);
  console.log(`Facebook conversations WITHOUT team assignment: ${grandFbWithoutTeam}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
