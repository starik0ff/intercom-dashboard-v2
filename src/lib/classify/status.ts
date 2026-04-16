// Status classification.
// Priority of inputs: manual_override (dashboard admin) → intercom_progress
// (Intercom custom attribute "Progress") → heuristic (keywords, state, reply
// timing). `closed_deal` is set ONLY via the first two — the heuristic never
// infers a won sale on its own.

export type StatusBucket =
  | 'new'
  | 'in_progress'
  | 'negotiation'
  | 'tech_q'
  | 'no_reply'
  | 'closed_deal'
  | 'closed'
  | 'unknown';

export const NO_REPLY_THRESHOLD_HOURS = 24;

export const TECH_Q_KEYWORDS_RU = [
  'не работает',
  'ошибка',
  'баг',
  'не приходит',
  'не открывается',
  'не загружается',
  'не отображается',
  'не получается',
  'не могу',
  'проблема',
  'зависает',
  'падает',
  'crash',
];

export const TECH_Q_KEYWORDS_EN = [
  'not working',
  'broken',
  'bug',
  'error',
  'issue',
  'problem',
  'crash',
  'cannot',
  "can't",
  'fails',
  'failing',
  'stuck',
  "doesn't work",
  'does not work',
];

const NEGOTIATION_KEYWORDS = [
  'price',
  'pricing',
  'cost',
  'discount',
  'plan',
  'tariff',
  'invoice',
  'payment',
  'цена',
  'стоимость',
  'тариф',
  'оплата',
  'счет',
  'скидка',
];

export interface StatusInput {
  open: boolean;
  state?: string | null;
  user_messages_count: number;
  admin_messages_count: number;
  last_user_message_at?: number | null;
  last_admin_message_at?: number | null;
  first_admin_reply_at?: number | null;
  body_sample?: string; // concatenated first ~few user messages
  manual_override?: StatusBucket | null;
  /** Raw value of Intercom custom attribute "Progress" (if any). */
  intercom_progress?: string | null;
}

// Mapping from normalized Intercom Progress value → our bucket.
// Keys are lowercased with Cyrillic "С" normalized to Latin "C" — some
// entries in Intercom were created with a Cyrillic capital С and look
// identical to the user. See normalizeProgress() below.
const PROGRESS_MAP: Record<string, StatusBucket> = {
  'closed deal': 'closed_deal',
  'negotiation': 'negotiation',
  'no reply': 'no_reply',
  'tech q': 'tech_q',
  'duplicate': 'closed',
  'rejection': 'closed',
};

export function normalizeProgress(
  raw: string | null | undefined,
): StatusBucket | null {
  if (!raw) return null;
  // Replace all Cyrillic letters that look like Latin ones with their
  // Latin equivalents — С→C, с→c, О→O, о→o, Е→E, е→e, А→A, а→a, Р→P,
  // р→p, Т→T, Н→H, К→K, М→M, В→B, Х→X. This defensively covers typos.
  const latinized = raw
    .replace(/С/g, 'C').replace(/с/g, 'c')
    .replace(/О/g, 'O').replace(/о/g, 'o')
    .replace(/Е/g, 'E').replace(/е/g, 'e')
    .replace(/А/g, 'A').replace(/а/g, 'a')
    .replace(/Р/g, 'P').replace(/р/g, 'p')
    .replace(/Т/g, 'T').replace(/Н/g, 'H')
    .replace(/К/g, 'K').replace(/М/g, 'M')
    .replace(/В/g, 'B').replace(/Х/g, 'X').replace(/х/g, 'x');
  const key = latinized.trim().toLowerCase().replace(/\s+/g, ' ');
  return PROGRESS_MAP[key] ?? null;
}

export function classifyStatus(s: StatusInput): {
  bucket: StatusBucket;
  source: 'manual' | 'intercom' | 'heuristic';
  reason: string;
} {
  if (s.manual_override) {
    return {
      bucket: s.manual_override,
      source: 'manual',
      reason: 'manual_override',
    };
  }

  const fromProgress = normalizeProgress(s.intercom_progress);
  if (fromProgress) {
    return {
      bucket: fromProgress,
      source: 'intercom',
      reason: `intercom_progress:${s.intercom_progress}`,
    };
  }

  // Closed conversations.
  if (!s.open || s.state === 'closed') {
    return { bucket: 'closed', source: 'heuristic', reason: 'state_closed' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const lastUser = s.last_user_message_at || 0;
  const lastAdmin = s.last_admin_message_at || 0;
  const ageHoursSinceUser = lastUser
    ? (nowSec - lastUser) / 3600
    : Number.POSITIVE_INFINITY;

  // No admin reply yet.
  if (s.admin_messages_count === 0) {
    if (ageHoursSinceUser >= NO_REPLY_THRESHOLD_HOURS) {
      return { bucket: 'no_reply', source: 'heuristic', reason: 'no_admin_reply_overdue' };
    }
    return { bucket: 'new', source: 'heuristic', reason: 'no_admin_reply_fresh' };
  }

  // Admin replied at some point — check waiting on user response.
  // If last message was from user > threshold hours ago and admin hasn't followed up.
  if (lastUser > lastAdmin && ageHoursSinceUser >= NO_REPLY_THRESHOLD_HOURS) {
    return { bucket: 'no_reply', source: 'heuristic', reason: 'admin_silent_after_user' };
  }

  // Keyword scan on body sample.
  const body = (s.body_sample || '').toLowerCase();
  if (body) {
    if (TECH_Q_KEYWORDS_RU.some((k) => body.includes(k)) ||
        TECH_Q_KEYWORDS_EN.some((k) => body.includes(k))) {
      return { bucket: 'tech_q', source: 'heuristic', reason: 'tech_keyword' };
    }
    if (NEGOTIATION_KEYWORDS.some((k) => body.includes(k))) {
      return { bucket: 'negotiation', source: 'heuristic', reason: 'negotiation_keyword' };
    }
  }

  return { bucket: 'in_progress', source: 'heuristic', reason: 'default_open' };
}
