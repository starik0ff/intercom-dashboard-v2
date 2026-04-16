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
