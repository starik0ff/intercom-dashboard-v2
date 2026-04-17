// Tiny helpers shared by analytics route handlers.

import type { NextRequest } from 'next/server';
import { filtersFromSearchParams } from './filters/url';
import { requireUser, authErrorResponse } from './auth-server';

export async function withAuth<T>(
  handler: () => Promise<T>,
): Promise<T | Response> {
  try {
    await requireUser();
    return await handler();
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }
}

export function parseFilters(req: NextRequest) {
  return filtersFromSearchParams(req.nextUrl.searchParams);
}

/** Parse filters from a plain object (used by worker for export jobs). */
export function parseFiltersFromObj(obj: {
  period: string;
  from?: number | null;
  to?: number | null;
  sources?: string[];
  statuses?: string[];
}) {
  const sp = new URLSearchParams();
  sp.set('period', obj.period);
  if (obj.from != null) sp.set('from', String(obj.from));
  if (obj.to != null) sp.set('to', String(obj.to));
  if (obj.sources?.length) sp.set('sources', obj.sources.join(','));
  if (obj.statuses?.length) sp.set('statuses', obj.statuses.join(','));
  return filtersFromSearchParams(sp);
}
