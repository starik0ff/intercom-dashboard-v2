'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { GlobalFilterBar } from '@/components/GlobalFilterBar';
import { useGlobalFilters, filtersToQueryString } from '@/hooks/useGlobalFilters';

interface Item {
  admin_id: string;
  name: string | null;
  email: string | null;
  total: number;
  open_count: number;
  closed_count: number;
  no_reply_count: number;
  avg_frt: number | null;
  median_frt: number | null;
}

type SortKey = 'total' | 'open_count' | 'no_reply_count' | 'median_frt' | 'name';

function fmtDuration(secs: number | null): string {
  if (secs == null) return '—';
  if (secs < 60) return `${secs}с`;
  if (secs < 3600) return `${Math.round(secs / 60)}м`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}ч`;
  return `${(secs / 86400).toFixed(1)}д`;
}

export default function TeamPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Загрузка…</div>}>
      <TeamPageInner />
    </Suspense>
  );
}

function TeamPageInner() {
  const { filters, key } = useGlobalFilters();
  const qs = filtersToQueryString(filters);
  const [data, setData] = useState<{ items: Item[]; unassigned: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/team/list?${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [`${qs}|${key}`]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.items];
    arr.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number | string;
      const bv = (b[sortKey] ?? 0) as number | string;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'name' ? 'asc' : 'desc');
    }
  }

  function arrow(k: SortKey) {
    if (sortKey !== k) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalFilterBar />
      <div className="p-4 max-w-[1400px] mx-auto space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Команда</h1>

        <div className="bg-white border border-gray-200 rounded">
          {error && <div className="p-4 text-sm text-red-600">Ошибка: {error}</div>}
          {loading && <div className="p-4 text-sm text-gray-400">Загрузка…</div>}
          {!loading && !error && data && (
            <>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600 border-b">
                  <tr>
                    <th
                      className="text-left px-3 py-2 cursor-pointer hover:text-gray-900"
                      onClick={() => toggleSort('name')}
                    >
                      Менеджер{arrow('name')}
                    </th>
                    <th
                      className="text-right px-3 py-2 cursor-pointer hover:text-gray-900 w-24"
                      onClick={() => toggleSort('total')}
                    >
                      Всего{arrow('total')}
                    </th>
                    <th
                      className="text-right px-3 py-2 cursor-pointer hover:text-gray-900 w-24"
                      onClick={() => toggleSort('open_count')}
                    >
                      Открытых{arrow('open_count')}
                    </th>
                    <th
                      className="text-right px-3 py-2 cursor-pointer hover:text-gray-900 w-24"
                      onClick={() => toggleSort('no_reply_count')}
                    >
                      Без ответа{arrow('no_reply_count')}
                    </th>
                    <th
                      className="text-right px-3 py-2 cursor-pointer hover:text-gray-900 w-28"
                      onClick={() => toggleSort('median_frt')}
                    >
                      Медиана FRT{arrow('median_frt')}
                    </th>
                    <th className="text-right px-3 py-2 w-28">Среднее FRT</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((it) => (
                    <tr key={it.admin_id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <Link
                          href={`/team/${it.admin_id}?${qs}`}
                          className="text-blue-600 hover:underline"
                        >
                          {it.name || it.email || `admin ${it.admin_id}`}
                        </Link>
                        {it.email && it.name && (
                          <div className="text-xs text-gray-500">{it.email}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.open_count}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          it.no_reply_count > 0 ? 'text-orange-600' : ''
                        }`}
                      >
                        {it.no_reply_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtDuration(it.median_frt)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                        {fmtDuration(it.avg_frt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.unassigned > 0 && (
                <div className="px-3 py-2 text-xs text-gray-500 border-t bg-gray-50">
                  Без назначения: <span className="tabular-nums">{data.unassigned}</span>
                </div>
              )}
              {sorted.length === 0 && (
                <div className="p-8 text-sm text-gray-400 text-center">Нет данных</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
