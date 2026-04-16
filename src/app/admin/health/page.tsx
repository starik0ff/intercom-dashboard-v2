'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  latency_ms: number;
  message: string;
  details?: Record<string, unknown>;
}

interface Resp {
  status: 'ok' | 'warn' | 'fail';
  now: number;
  checks: Check[];
}

const STATUS_STYLES: Record<
  'ok' | 'warn' | 'fail',
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  ok: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    dot: 'bg-green-500',
    label: 'OK',
  },
  warn: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-800',
    dot: 'bg-yellow-500',
    label: 'WARN',
  },
  fail: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    dot: 'bg-red-500',
    label: 'FAIL',
  },
};

const CHECK_LABELS: Record<string, string> = {
  database: 'База данных (SQLite)',
  tables: 'Таблицы и объёмы',
  fts: 'Полнотекстовый индекс (FTS5)',
  bootstrap: 'Bootstrap синхронизация',
  worker_process: 'Процесс воркера',
  incremental: 'Инкрементальная синхронизация',
  sync_errors_24h: 'Ошибки синхронизации (24ч)',
  env: 'Переменные окружения',
  users_file: 'Файл пользователей',
  intercom_api: 'Intercom API',
};

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function HealthPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/health/full${probe ? '' : '?probe=0'}`)
      .then(async (r) => {
        const j = (await r.json()) as Resp;
        setData(j);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [probe]);

  useEffect(() => {
    load();
  }, [load, tick]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const overall = data?.status || (error ? 'fail' : 'warn');
  const s = STATUS_STYLES[overall];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Дашборд
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">Health checks</h1>
          <div className="flex-1" />
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={probe}
              onChange={(e) => setProbe(e.target.checked)}
            />
            Intercom probe
          </label>
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto 30с
          </label>
          <button
            type="button"
            onClick={() => setTick((v) => v + 1)}
            disabled={loading}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className={`rounded border p-4 ${s.bg} ${s.border}`}>
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${s.dot}`} />
            <span className={`text-lg font-semibold ${s.text}`}>
              {s.label}
            </span>
            <span className="text-sm text-gray-600">
              — сводный статус системы
            </span>
            <div className="flex-1" />
            {data && (
              <span className="text-xs text-gray-500">
                проверено {fmtDate(data.now)}
              </span>
            )}
          </div>
          {error && (
            <div className="mt-2 text-sm text-red-700">Ошибка запроса: {error}</div>
          )}
        </div>

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.checks.map((c) => {
              const cs = STATUS_STYLES[c.status];
              return (
                <div
                  key={c.name}
                  className={`rounded border p-3 ${cs.bg} ${cs.border}`}
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${cs.dot}`} />
                      <span className={`text-sm font-semibold ${cs.text}`}>
                        {CHECK_LABELS[c.name] || c.name}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {c.latency_ms}ms
                    </span>
                  </div>
                  <div className="text-sm text-gray-700 break-words">{c.message}</div>
                  {c.details && Object.keys(c.details).length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                        Детали
                      </summary>
                      <pre className="mt-1 text-xs text-gray-600 bg-white bg-opacity-60 border border-gray-200 rounded p-2 overflow-x-auto">
                        {JSON.stringify(c.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="text-xs text-gray-500 pt-2">
          Публичная liveness-проверка (без авторизации):{' '}
          <code className="bg-gray-100 px-1 rounded">/api/health</code>
        </div>
      </div>
    </div>
  );
}
