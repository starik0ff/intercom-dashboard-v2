'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GlobalFilterBar } from '@/components/GlobalFilterBar';
import { useGlobalFilters, filtersToQueryString } from '@/hooks/useGlobalFilters';
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  type SourceBucket,
  type StatusBucket,
} from '@/lib/filters/types';

interface Item {
  conversation_id: string;
  created_at: number;
  updated_at: number;
  contact_name: string | null;
  contact_email: string | null;
  source_bucket: string;
  status_bucket: string;
  admin_assignee_id: string | null;
  admin_name: string | null;
  snippet: string;
  match_count: number;
}

interface Resp {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
  query: string;
  match: string | null;
  truncated?: boolean;
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

// Render the snippet HTML returned by SQLite (already contains <mark> tags).
// We sanitize by allow-listing only <mark>…</mark>.
function SnippetHtml({ html }: { html: string }) {
  // Escape everything, then re-introduce <mark>…</mark>.
  const escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const reMark = escaped
    .replace(/&lt;mark&gt;/g, '<mark class="bg-yellow-200 text-yellow-900 px-0.5 rounded">')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
  return (
    <span
      className="text-sm text-gray-700"
      dangerouslySetInnerHTML={{ __html: reMark }}
    />
  );
}

export default function SearchPage() {
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

  const urlQ = sp.get('q') || '';
  const urlPage = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);

  const [input, setInput] = useState(urlQ);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync input → URL `q` only on submit; keep typing local.
  useEffect(() => {
    setInput(urlQ);
  }, [urlQ]);

  useEffect(() => {
    if (!urlQ.trim()) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(qs);
    params.set('q', urlQ);
    params.set('page', String(urlPage));
    params.set('page_size', '25');
    fetch(`/api/search?${params.toString()}`)
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
  }, [urlQ, urlPage, qs, key]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(sp.toString());
    if (input.trim()) next.set('q', input.trim());
    else next.delete('q');
    next.delete('page');
    router.replace(`/search?${next.toString()}`, { scroll: false });
  }

  function gotoPage(p: number) {
    const next = new URLSearchParams(sp.toString());
    next.set('page', String(p));
    router.replace(`/search?${next.toString()}`, { scroll: false });
  }

  const totalPages = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, Math.ceil(data.total / data.page_size));
  }, [data]);

  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalFilterBar />

      <div className="px-4 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Дашборд
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">Поиск по сообщениям</h1>
        </div>

        <form onSubmit={submit} className="mb-4 flex gap-2">
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Поиск по тексту сообщений (FTS)…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoFocus
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
          >
            Найти
          </button>
        </form>

        {!urlQ && (
          <div className="text-sm text-gray-500 py-12 text-center">
            Введите запрос для поиска. Поддерживаются префиксы (token*) и фразы.
            <br />
            Учитываются глобальные фильтры (период, источник, статус).
          </div>
        )}

        {loading && <div className="text-sm text-gray-400 py-8 text-center">Поиск…</div>}
        {error && <div className="text-sm text-red-600 py-4">Ошибка: {error}</div>}

        {data && !loading && (
          <>
            <div className="flex items-center justify-between mb-3 text-sm text-gray-600">
              <div>
                Найдено: <span className="font-semibold text-gray-900">{data.total.toLocaleString('ru-RU')}</span>{' '}
                диалогов
                {data.truncated && (
                  <span className="ml-2 text-xs text-orange-600">
                    (показаны топ-{data.page_size * totalPages} по релевантности)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/export?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), q: urlQ, format: 'csv' }).toString()}`}
                  download
                  className="px-2.5 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                >
                  ↓ CSV
                </a>
                <a
                  href={`/api/export?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), q: urlQ, format: 'json' }).toString()}`}
                  download
                  className="px-2.5 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                >
                  ↓ JSON
                </a>
                {totalPages > 1 && (
                  <span className="ml-2">Страница {data.page} из {totalPages}</span>
                )}
              </div>
            </div>

            {data.items.length === 0 && (
              <div className="text-sm text-gray-400 py-12 text-center">
                Ничего не найдено. Проверьте фильтры — попробуйте «Всё время».
              </div>
            )}

            <div className="space-y-2">
              {data.items.map((it) => (
                <Link
                  key={it.conversation_id}
                  href={`/conversation/${it.conversation_id}?q=${encodeURIComponent(urlQ)}`}
                  className="block bg-white border border-gray-200 rounded p-3 hover:border-blue-300 hover:shadow-sm transition"
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-mono">#{it.conversation_id.slice(-8)}</span>
                      <span>·</span>
                      <span>{fmtDate(it.created_at)}</span>
                      <span>·</span>
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                        {SOURCE_LABELS[it.source_bucket as SourceBucket] || it.source_bucket}
                      </span>
                      <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">
                        {STATUS_LABELS[it.status_bucket as StatusBucket] || it.status_bucket}
                      </span>
                      {it.match_count > 1 && (
                        <span className="text-xs text-gray-400">{it.match_count} совпадений</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {it.admin_name || 'не назначен'}
                    </div>
                  </div>
                  <div className="text-sm text-gray-700 mb-1">
                    {it.contact_name || it.contact_email || <span className="text-gray-400">—</span>}
                  </div>
                  <div className="text-sm text-gray-700 leading-relaxed">
                    <SnippetHtml html={it.snippet} />
                  </div>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
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
          </>
        )}
      </div>
    </div>
  );
}
