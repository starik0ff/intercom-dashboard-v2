// URL <-> Filters conversion. Used by both client (useGlobalFilters) and
// server (route handlers parsing request.nextUrl.searchParams).

import {
  DEFAULT_FILTERS,
  FilterSchema,
  type Filters,
  type PeriodPreset,
  SOURCE_BUCKETS,
  STATUS_BUCKETS,
} from './types';

// Project timezone — Moscow (per existing dashboard convention).
export const PROJECT_TZ = 'Europe/Moscow';

// Convert a JS Date in PROJECT_TZ to unix seconds for "start of day"/"end of day".
function tzStartOfDay(d: Date): number {
  // Compose a YYYY-MM-DD in Moscow tz, then parse with explicit offset.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PROJECT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  // Moscow is UTC+3 (no DST).
  const iso = `${get('year')}-${get('month')}-${get('day')}T00:00:00+03:00`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

function tzEndOfDay(d: Date): number {
  return tzStartOfDay(d) + 86400 - 1;
}

function nowMoscow(): Date {
  return new Date();
}

/** Resolve a preset to absolute (from, to) in unix seconds. */
export function resolvePeriod(
  preset: PeriodPreset,
  customFrom: number | null,
  customTo: number | null,
): { from: number | null; to: number | null } {
  const now = nowMoscow();
  switch (preset) {
    case 'all':
      return { from: null, to: null };
    case 'today':
      return { from: tzStartOfDay(now), to: tzEndOfDay(now) };
    case 'yesterday': {
      const y = new Date(now.getTime() - 86400_000);
      return { from: tzStartOfDay(y), to: tzEndOfDay(y) };
    }
    case '7d': {
      const start = new Date(now.getTime() - 6 * 86400_000);
      return { from: tzStartOfDay(start), to: tzEndOfDay(now) };
    }
    case '30d': {
      const start = new Date(now.getTime() - 29 * 86400_000);
      return { from: tzStartOfDay(start), to: tzEndOfDay(now) };
    }
    case 'this_month': {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: PROJECT_TZ,
        year: 'numeric',
        month: '2-digit',
      });
      const parts = fmt.formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
      const start = new Date(`${get('year')}-${get('month')}-01T00:00:00+03:00`);
      return { from: tzStartOfDay(start), to: tzEndOfDay(now) };
    }
    case 'last_month': {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: PROJECT_TZ,
        year: 'numeric',
        month: '2-digit',
      });
      const parts = fmt.formatToParts(now);
      const y = parseInt(parts.find((p) => p.type === 'year')?.value || '1970', 10);
      const m = parseInt(parts.find((p) => p.type === 'month')?.value || '01', 10);
      const prevMonth = m === 1 ? 12 : m - 1;
      const prevYear = m === 1 ? y - 1 : y;
      const startStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01T00:00:00+03:00`;
      const start = new Date(startStr);
      // End of last month = day before current month start.
      const thisMonthStart = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+03:00`);
      const end = new Date(thisMonthStart.getTime() - 1);
      return {
        from: Math.floor(start.getTime() / 1000),
        to: Math.floor(end.getTime() / 1000),
      };
    }
    case 'custom':
      return { from: customFrom, to: customTo };
  }
}

/** Parse from URL search params (URLSearchParams or ReadonlyURLSearchParams). */
export function filtersFromSearchParams(
  sp: URLSearchParams | { get(k: string): string | null },
): Filters {
  const period = (sp.get('period') as PeriodPreset | null) || DEFAULT_FILTERS.period;
  const fromStr = sp.get('from');
  const toStr = sp.get('to');
  const sourcesStr = sp.get('sources');
  const statusesStr = sp.get('statuses');

  const sources = sourcesStr
    ? sourcesStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => (SOURCE_BUCKETS as readonly string[]).includes(s))
    : [];

  const statuses = statusesStr
    ? statusesStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => (STATUS_BUCKETS as readonly string[]).includes(s))
    : [];

  const candidate = {
    period,
    from: fromStr ? parseInt(fromStr, 10) : null,
    to: toStr ? parseInt(toStr, 10) : null,
    sources,
    statuses,
  };

  const parsed = FilterSchema.safeParse(candidate);
  if (!parsed.success) return { ...DEFAULT_FILTERS };
  return parsed.data;
}

/** Serialize back to URLSearchParams (only non-default keys included). */
export function filtersToSearchParams(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.period !== DEFAULT_FILTERS.period) sp.set('period', f.period);
  if (f.period === 'custom') {
    if (f.from != null) sp.set('from', String(f.from));
    if (f.to != null) sp.set('to', String(f.to));
  }
  if (f.sources.length > 0) sp.set('sources', f.sources.join(','));
  if (f.statuses.length > 0) sp.set('statuses', f.statuses.join(','));
  return sp;
}

/** Resolve filters to absolute time bounds — for SQL/queries. */
export function resolveFilters(f: Filters): {
  from: number | null;
  to: number | null;
  sources: Filters['sources'];
  statuses: Filters['statuses'];
} {
  const { from, to } = resolvePeriod(f.period, f.from, f.to);
  return { from, to, sources: f.sources, statuses: f.statuses };
}
