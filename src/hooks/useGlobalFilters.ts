'use client';

// Read/write the global filter state in the URL.
// Designed for use under /traffic, /team, /search, /exports.

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
} from '@/lib/filters/url';
import type { Filters } from '@/lib/filters/types';

export interface UseGlobalFiltersResult {
  filters: Filters;
  /** Replace the entire filter object. */
  setFilters: (next: Filters) => void;
  /** Patch a subset of fields. */
  patch: (partial: Partial<Filters>) => void;
  /** Reset to defaults (clears all filter params from URL). */
  reset: () => void;
  /** Stable string key — use as React useEffect dep. */
  key: string;
}

export function useGlobalFilters(): UseGlobalFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  );

  const setFilters = useCallback(
    (next: Filters) => {
      const sp = filtersToSearchParams(next);
      // Preserve any non-filter params (e.g. ?q= search query) by merging.
      for (const [k, v] of searchParams.entries()) {
        if (
          k !== 'period' &&
          k !== 'from' &&
          k !== 'to' &&
          k !== 'sources' &&
          k !== 'statuses'
        ) {
          sp.set(k, v);
        }
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const patch = useCallback(
    (partial: Partial<Filters>) => setFilters({ ...filters, ...partial }),
    [filters, setFilters],
  );

  const reset = useCallback(() => {
    const sp = new URLSearchParams();
    for (const [k, v] of searchParams.entries()) {
      if (
        k !== 'period' &&
        k !== 'from' &&
        k !== 'to' &&
        k !== 'sources' &&
        k !== 'statuses'
      ) {
        sp.set(k, v);
      }
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const key = `${filters.period}|${filters.from ?? ''}|${filters.to ?? ''}|${filters.sources.join(',')}|${filters.statuses.join(',')}`;

  return { filters, setFilters, patch, reset, key };
}

/** Build a query string from current filters — for fetch() to API routes. */
export function filtersToQueryString(f: Filters): string {
  return filtersToSearchParams(f).toString();
}
