// Build a SQL WHERE fragment + bound parameters from resolved filters.
// Used by every analytics endpoint that queries the conversations table.

import type { Filters } from './types';
import { resolveFilters } from './url';

export interface SqlFragment {
  where: string;          // joined with " AND " — empty string if no filters
  params: unknown[];      // positional bound params, in order matching `?`s
}

export interface BuildOptions {
  /** Which conversations.* timestamp column to filter by. */
  timeColumn?: 'created_at' | 'updated_at' | 'first_team_assigned_at' | 'last_message_at';
  /** Table alias if joined (defaults to 'conversations'). */
  alias?: string;
  /** Skip status filter (e.g. for the "by status" pivot endpoint). */
  ignoreStatuses?: boolean;
  /** Skip source filter. */
  ignoreSources?: boolean;
}

export function buildConversationsWhere(
  filters: Filters,
  opts: BuildOptions = {},
): SqlFragment {
  const { from, to, sources, statuses } = resolveFilters(filters);
  const col = opts.timeColumn ?? 'created_at';
  const alias = opts.alias ?? 'conversations';
  // last_message_at = most recent of user/admin message timestamps (excludes technical updates)
  const t = col === 'last_message_at'
    ? `MAX(COALESCE(${alias}.last_user_message_at, 0), COALESCE(${alias}.last_admin_message_at, 0))`
    : `${alias}.${col}`;

  const conds: string[] = [];
  const params: unknown[] = [];

  if (from != null) {
    conds.push(`${t} >= ?`);
    params.push(from);
  }
  if (to != null) {
    conds.push(`${t} <= ?`);
    params.push(to);
  }
  if (!opts.ignoreSources && sources.length > 0) {
    const placeholders = sources.map(() => '?').join(',');
    conds.push(`${alias}.source_bucket IN (${placeholders})`);
    params.push(...sources);
  }
  if (!opts.ignoreStatuses && statuses.length > 0) {
    const placeholders = statuses.map(() => '?').join(',');
    conds.push(`${alias}.status_bucket IN (${placeholders})`);
    params.push(...statuses);
  }

  return {
    where: conds.length ? conds.join(' AND ') : '',
    params,
  };
}

/** Convenience: build a "WHERE ..." prefix or empty string. */
export function whereClause(frag: SqlFragment): string {
  return frag.where ? `WHERE ${frag.where}` : '';
}

/** Convenience: build an "AND ..." suffix or empty string. */
export function andClause(frag: SqlFragment): string {
  return frag.where ? `AND ${frag.where}` : '';
}
