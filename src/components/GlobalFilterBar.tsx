'use client';

// Sticky filter bar shown at the top of every dashboard section.
// Reads/writes URL state via useGlobalFilters.

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Calendar, Filter, X, ChevronDown } from 'lucide-react';
import { useGlobalFilters, filtersToQueryString } from '@/hooks/useGlobalFilters';
import {
  PERIOD_PRESETS,
  PERIOD_LABELS,
  SOURCE_BUCKETS,
  SOURCE_LABELS,
  STATUS_BUCKETS,
  STATUS_LABELS,
  type PeriodPreset,
  type SourceBucket,
  type StatusBucket,
} from '@/lib/filters/types';
import { resolveFilters, PROJECT_TZ } from '@/lib/filters/url';

function fmtDate(unixSec: number | null): string {
  if (unixSec == null) return '—';
  return new Date(unixSec * 1000).toLocaleDateString('ru-RU', {
    timeZone: PROJECT_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function dateInputValue(unixSec: number | null): string {
  if (unixSec == null) return '';
  // YYYY-MM-DD in Moscow tz
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PROJECT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSec * 1000));
}

function dateInputToUnix(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const iso = `${value}T${endOfDay ? '23:59:59' : '00:00:00'}+03:00`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

interface DropdownProps {
  label: string;
  count: number;
  children: React.ReactNode;
}
function Dropdown({ label, count, children }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
      >
        <Filter className="w-3.5 h-3.5" />
        <span>{label}</span>
        {count > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
            {count}
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[200px] bg-white border border-gray-200 rounded shadow-lg p-2">
          {children}
        </div>
      )}
    </div>
  );
}

function PeriodDropdown({
  value,
  onSelect,
}: {
  value: PeriodPreset;
  onSelect: (p: PeriodPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
      >
        <Calendar className="w-3.5 h-3.5 text-gray-500" />
        <span>{PERIOD_LABELS[value]}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[180px] bg-white border border-gray-200 rounded shadow-lg py-1">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onSelect(p);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
                value === p ? 'text-blue-600 font-medium' : 'text-gray-700'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GlobalFilterBar() {
  const { filters, patch, reset } = useGlobalFilters();
  const resolved = resolveFilters(filters);
  const pathname = usePathname();
  const isHome = pathname === '/';
  const homeQs = filtersToQueryString(filters);

  const isCustom = filters.period === 'custom';

  const hasActive =
    filters.sources.length > 0 ||
    filters.statuses.length > 0 ||
    filters.period !== '30d' ||
    filters.from != null ||
    filters.to != null;

  return (
    <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {!isHome && (
            <Link
              href={`/${homeQs ? `?${homeQs}` : ''}`}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded shrink-0"
              title="На главную"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Главная</span>
            </Link>
          )}

          {/* Period dropdown */}
          <PeriodDropdown
            value={filters.period}
            onSelect={(p) =>
              p === 'custom'
                ? patch({ period: 'custom' })
                : patch({ period: p, from: null, to: null })
            }
          />

          {isCustom && (
            <div className="flex items-center gap-1.5 text-sm">
              <input
                type="date"
                value={dateInputValue(filters.from)}
                onChange={(e) =>
                  patch({ from: dateInputToUnix(e.target.value, false) })
                }
                className="px-2 py-1 border border-gray-300 rounded text-xs"
              />
              <span className="text-gray-400">—</span>
              <input
                type="date"
                value={dateInputValue(filters.to)}
                onChange={(e) =>
                  patch({ to: dateInputToUnix(e.target.value, true) })
                }
                className="px-2 py-1 border border-gray-300 rounded text-xs"
              />
            </div>
          )}

          {/* Source dropdown */}
          <Dropdown label="Источники" count={filters.sources.length}>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {SOURCE_BUCKETS.map((s) => (
              <label key={s} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.sources.includes(s)}
                  onChange={(e) => {
                    const next = new Set<SourceBucket>(filters.sources);
                    if (e.target.checked) next.add(s);
                    else next.delete(s);
                    patch({ sources: Array.from(next) });
                  }}
                />
                <span>{SOURCE_LABELS[s]}</span>
              </label>
            ))}
          </div>
          {filters.sources.length > 0 && (
            <button
              type="button"
              onClick={() => patch({ sources: [] })}
              className="mt-2 w-full px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded border border-gray-200"
            >
              Очистить
            </button>
          )}
        </Dropdown>

          {/* Status dropdown */}
          <Dropdown label="Статусы" count={filters.statuses.length}>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {STATUS_BUCKETS.map((s) => (
              <label key={s} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.statuses.includes(s)}
                  onChange={(e) => {
                    const next = new Set<StatusBucket>(filters.statuses);
                    if (e.target.checked) next.add(s);
                    else next.delete(s);
                    patch({ statuses: Array.from(next) });
                  }}
                />
                <span>{STATUS_LABELS[s]}</span>
              </label>
            ))}
          </div>
          {filters.statuses.length > 0 && (
            <button
              type="button"
              onClick={() => patch({ statuses: [] })}
              className="mt-2 w-full px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded border border-gray-200"
            >
              Очистить
            </button>
          )}
        </Dropdown>

          {/* Resolved range — pushed right on wide screens, wraps under on narrow */}
          <div className="text-xs text-gray-500 ml-auto whitespace-nowrap">
            {resolved.from || resolved.to
              ? `${fmtDate(resolved.from)} — ${fmtDate(resolved.to)}`
              : 'Все периоды'}
          </div>

          {hasActive && (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded shrink-0"
            >
              <X className="w-3 h-3" />
              Сбросить
            </button>
          )}
        </div>
      </div>

      {/* Active chips */}
      {(filters.sources.length > 0 || filters.statuses.length > 0) && (
        <div className="max-w-6xl mx-auto px-4 pb-2 flex flex-wrap gap-1.5">
          {filters.sources.map((s) => (
            <span
              key={`src-${s}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
            >
              {SOURCE_LABELS[s]}
              <button
                type="button"
                onClick={() =>
                  patch({ sources: filters.sources.filter((x) => x !== s) })
                }
                className="hover:bg-blue-100 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {filters.statuses.map((s) => (
            <span
              key={`st-${s}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded"
            >
              {STATUS_LABELS[s]}
              <button
                type="button"
                onClick={() =>
                  patch({ statuses: filters.statuses.filter((x) => x !== s) })
                }
                className="hover:bg-purple-100 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
