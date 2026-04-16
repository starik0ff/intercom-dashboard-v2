'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GlobalFilterBar } from '@/components/GlobalFilterBar';
import { useGlobalFilters, filtersToQueryString } from '@/hooks/useGlobalFilters';
import { SOURCE_LABELS, type SourceBucket } from '@/lib/filters/types';

interface Item {
  conversation_id: string;
  created_at: number;
  updated_at: number;
  contact_name: string | null;
  contact_email: string | null;
  source_bucket: string;
  status_source: string;
  admin_assignee_id: string | null;
  admin_name: string | null;
  override: { set_by: string; set_at: number; note: string | null } | null;
}

interface Resp {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ClosedDealsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Загрузка…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { filters, key } = useGlobalFilters();
  const qs = filtersToQueryString(filters);

  const urlPage = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(qs);
    params.set('page', String(urlPage));
    params.set('page_size', '25');
    fetch(`/api/closed-deals?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return (await r.json()) as Resp;
      })
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [urlPage, qs, key]);

  const totalPages = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, Math.ceil(data.total / data.page_size));
  }, [data]);

  function gotoPage(p: number) {
    const next = new URLSearchParams(sp.toString());
    next.set('page', String(p));
    router.replace(`/closed-deals?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalFilterBar />

      <div className="px-4 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Дашборд
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">Closed Deals</h1>
          {data && (
            <span className="ml-2 text-sm text-gray-500">
              {data.total.toLocaleString('ru-RU')} сделок
            </span>
          )}
          <div className="flex-1" />
          <a
            href={`/api/export?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), statuses: 'closed_deal', format: 'csv' }).toString()}`}
            download
            className="px-2.5 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
          >
            ↓ CSV
          </a>
          <a
            href={`/api/export?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), statuses: 'closed_deal', format: 'json' }).toString()}`}
            download
            className="px-2.5 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
          >
            ↓ JSON
          </a>
        </div>

        {loading && <div className="text-sm text-gray-400 py-8 text-center">Загрузка…</div>}
        {error && <div className="text-sm text-red-600 py-4">Ошибка: {error}</div>}

        {data && !loading && data.items.length === 0 && (
          <div className="text-sm text-gray-400 py-16 text-center">
            Closed Deal диалогов нет. Ручной статус можно поставить на странице диалога.
          </div>
        )}

        {data && data.items.length > 0 && (
          <div className="bg-white border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Диалог</th>
                  <th className="px-3 py-2 text-left">Контакт</th>
                  <th className="px-3 py-2 text-left">Источник</th>
                  <th className="px-3 py-2 text-left">Менеджер</th>
                  <th className="px-3 py-2 text-left">Отметил</th>
                  <th className="px-3 py-2 text-left">Когда</th>
                  <th className="px-3 py-2 text-left">Примечание</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.conversation_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link
                        href={`/conversation/${it.conversation_id}`}
                        className="text-blue-600 hover:underline font-mono text-xs"
                      >
                        #{it.conversation_id.slice(-8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {it.contact_name || it.contact_email || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                        {SOURCE_LABELS[it.source_bucket as SourceBucket] || it.source_bucket}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 text-xs">
                      {it.admin_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {it.override ? it.override.set_by : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 tabular-nums">
                      {it.override ? fmtDate(it.override.set_at) : fmtDate(it.updated_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {it.override?.note || <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => gotoPage(data.page - 1)}
                  disabled={data.page <= 1}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  ← Назад
                </button>
                <span className="text-sm text-gray-600 px-2">
                  {data.page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => gotoPage(data.page + 1)}
                  disabled={data.page >= totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                >
                  Вперёд →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
