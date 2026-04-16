// Source classification — Variant D.
// Order: explicit team_id mapping → URL pattern → first_team_assignment →
//        current team_assignment → source.type → unknown.

export type SourceBucket =
  | 'telegram_boostyfi'
  | 'telegram_iamlimitless'
  | 'facebook'
  | 'website'
  | 'email'
  | 'other'
  | 'unknown';

// Confirmed mappings from Intercom workspace bu625hil:
// (per user direction — 1 combined Facebook bucket)
export const TEAM_TO_SOURCE: Record<string, SourceBucket> = {
  // Telegram bots
  '10163896': 'telegram_boostyfi', // Telegram (Boostyfi)
  '10304332': 'telegram_iamlimitless', // Iamlimitless
  // Facebook (both Atla + JGGL → single bucket per spec)
  '10059054': 'facebook', // [Main] Facebook
  '10018713': 'facebook', // [Test] Facebook
  // Website / Email
  '9828440': 'website', // Boostyfi Intercom (website widget)
  '10169050': 'email', // E-mail
};

const URL_PATTERNS: Array<{ re: RegExp; bucket: SourceBucket }> = [
  { re: /facebook\.com|messenger\.com|m\.me/i, bucket: 'facebook' },
  { re: /t\.me|telegram/i, bucket: 'telegram_boostyfi' }, // ambiguous — fallback only
];

export interface ClassifyInput {
  team_assignee_id?: string | null;
  first_team_assignee_id?: string | null;
  source?: {
    type?: string | null;
    delivered_as?: string | null;
    url?: string | null;
  } | null;
}

export function classifySource(c: ClassifyInput): {
  bucket: SourceBucket;
  reason: string;
} {
  // 1. First non-bot team assignment (Variant D core).
  if (c.first_team_assignee_id && TEAM_TO_SOURCE[c.first_team_assignee_id]) {
    return {
      bucket: TEAM_TO_SOURCE[c.first_team_assignee_id],
      reason: `first_team:${c.first_team_assignee_id}`,
    };
  }
  // 2. Current team assignment.
  if (c.team_assignee_id && TEAM_TO_SOURCE[c.team_assignee_id]) {
    return {
      bucket: TEAM_TO_SOURCE[c.team_assignee_id],
      reason: `current_team:${c.team_assignee_id}`,
    };
  }
  // 3. URL match.
  const url = c.source?.url || '';
  if (url) {
    for (const p of URL_PATTERNS) {
      if (p.re.test(url)) return { bucket: p.bucket, reason: `url:${p.re}` };
    }
  }
  // 4. source.type heuristics.
  const type = (c.source?.type || '').toLowerCase();
  const delivered = (c.source?.delivered_as || '').toLowerCase();
  if (type === 'email' || delivered === 'email') {
    return { bucket: 'email', reason: 'source.type:email' };
  }
  if (type === 'facebook') return { bucket: 'facebook', reason: 'source.type' };
  // source.type='conversation' is the Intercom Messenger widget — i.e. website,
  // even when source_url is empty (e.g. historical migrated conversations that
  // landed straight in a manager team).
  if (type === 'conversation') {
    return { bucket: 'website', reason: 'source.type:conversation' };
  }
  if (type === 'admin_initiated') {
    return { bucket: 'other', reason: 'source.type:admin_initiated' };
  }
  return { bucket: 'unknown', reason: 'no_match' };
}
