// Minimal Intercom REST client with rate-limit + retry handling.
// Used by background workers (and later by API routes that need fresh writes).

const BASE_URL = 'https://api.intercom.io';
const API_VERSION = '2.11';
const DEFAULT_DELAY_MS = 120; // ~8 req/s, well under 1000/min limit
const MAX_RETRIES = 5;

function token(): string {
  const t = process.env.INTERCOM_TOKEN;
  if (!t) throw new Error('INTERCOM_TOKEN env var is required');
  return t;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Intercom-Version': API_VERSION,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await sleep(1000 * attempt);
      continue;
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(1000 * attempt);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      const err: Error & { status?: number; body?: string } = new Error(
        `Intercom ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`,
      );
      err.status = res.status;
      err.body = text;
      throw err;
    }

    return (await res.json()) as T;
  }
}

// ---------- search conversations ----------

export interface SearchPage<T = unknown> {
  type?: string;
  total_count?: number;
  conversations: T[];
  pages?: {
    next?: { starting_after?: string } | null;
  };
}

export interface SearchQuery {
  // simplified — caller passes the full Intercom search query body
  query: unknown;
  per_page?: number;
}

export async function searchConversations<T = unknown>(
  q: SearchQuery,
  startingAfter?: string,
): Promise<SearchPage<T>> {
  const body = {
    query: q.query,
    pagination: {
      per_page: q.per_page ?? 150,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    },
  };
  return request<SearchPage<T>>('POST', '/conversations/search', body);
}

export async function* iterateConversations<T = unknown>(
  q: SearchQuery,
  delayMs: number = DEFAULT_DELAY_MS,
): AsyncGenerator<T> {
  let cursor: string | undefined;
  while (true) {
    const page = await searchConversations<T>(q, cursor);
    for (const c of page.conversations || []) yield c;
    const next = page.pages?.next?.starting_after;
    if (!next) break;
    cursor = next;
    await sleep(delayMs);
  }
}

// ---------- conversation detail (with parts) ----------

export async function getConversation<T = unknown>(
  id: string,
  displayAs: 'plaintext' | 'html' = 'plaintext',
): Promise<T> {
  return request<T>('GET', `/conversations/${id}?display_as=${displayAs}`);
}

// ---------- admins / teams ----------

export async function listAdmins<T = unknown>(): Promise<{ admins: T[] }> {
  return request<{ admins: T[] }>('GET', '/admins');
}

export async function listTeams<T = unknown>(): Promise<{ teams: T[] }> {
  return request<{ teams: T[] }>('GET', '/teams');
}
