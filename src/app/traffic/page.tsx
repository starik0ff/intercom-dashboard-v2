'use client';

import { Suspense, useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { GlobalFilterBar } from '@/components/GlobalFilterBar';
import { useGlobalFilters, filtersToQueryString } from '@/hooks/useGlobalFilters';
import {
  SOURCE_BUCKETS,
  SOURCE_LABELS,
  type SourceBucket,
} from '@/lib/filters/types';

const SOURCE_COLORS: Record<SourceBucket, string> = {
  telegram_boostyfi: '#2563eb',
  telegram_iamlimitless: '#7c3aed',
  facebook: '#1877f2',
  website: '#16a34a',
  email: '#f59e0b',
  other: '#6b7280',
  unknown: '#9ca3af',
};

interface BySourceItem { source_bucket: string; n: number }
interface DailyItem { day: string; total: number; [k: string]: number | string }
interface FunnelStage { key: string; label: string; value: number }
interface TopPage { url: string; n: number }

function useApi<T>(url: string, key: string): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading, error };
}

export default function TrafficPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Загрузка…</div>}>
      <TrafficPageInner />
    </Suspense>
  );
}

function TrafficPageInner() {
  const { filters, key } = useGlobalFilters();
  const qs = filtersToQueryString(filters);
  const k = `${qs}|${key}`;

  const bySource = useApi<{ total: number; items: BySourceItem[] }>(
    `/api/traffic/by-source?${qs}`,
    `bs:${k}`,
  );
  const daily = useApi<{ items: DailyItem[] }>(
    `/api/traffic/daily?${qs}`,
    `dl:${k}`,
  );
  const funnel = useApi<{ stages: FunnelStage[]; no_reply: number }>(
    `/api/traffic/funnel?${qs}`,
    `fn:${k}`,
  );
  const topPages = useApi<{ items: TopPage[] }>(
    `/api/traffic/top-pages?${qs}`,
    `tp:${k}`,
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalFilterBar />
      <div className="p-4 max-w-[1400px] mx-auto space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Трафик</h1>

        {/* Top KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Всего диалогов"
            value={bySource.data?.total ?? null}
            loading={bySource.loading}
          />
          <KpiCard
            label="С первым ответом"
            value={funnel.data?.stages.find((s) => s.key === 'first_reply')?.value ?? null}
            loading={funnel.loading}
          />
          <KpiCard
            label="Закрыто"
            value={funnel.data?.stages.find((s) => s.key === 'closed')?.value ?? null}
            loading={funnel.loading}
          />
          <KpiCard
            label="Без ответа"
            value={funnel.data?.no_reply ?? null}
            loading={funnel.loading}
            tone="warn"
          />
        </div>

        {/* Pie + Funnel side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="По источникам" loading={bySource.loading} error={bySource.error}>
            {bySource.data && bySource.data.items.length > 0 ? (
              <SourcePie
                items={bySource.data.items}
                total={bySource.data.total}
              />
            ) : (
              <Empty />
            )}
          </ChartCard>

          <ChartCard title="Воронка" loading={funnel.loading} error={funnel.error}>
            {funnel.data ? (
              <FunnelView stages={funnel.data.stages} />
            ) : (
              <Empty />
            )}
          </ChartCard>
        </div>

        {/* Daily area chart */}
        <ChartCard title="По дням" loading={daily.loading} error={daily.error}>
          {daily.data && daily.data.items.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={daily.data.items}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend
                  formatter={(v: string) => SOURCE_LABELS[v as SourceBucket] || v}
                />
                {SOURCE_BUCKETS.map((s) => (
                  <Area
                    key={s}
                    type="monotone"
                    dataKey={s}
                    stackId="1"
                    stroke={SOURCE_COLORS[s]}
                    fill={SOURCE_COLORS[s]}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        {/* Top pages */}
        <ChartCard title="Топ URL (источник website)" loading={topPages.loading} error={topPages.error}>
          {topPages.data && topPages.data.items.length > 0 ? (
            <div className="w-full overflow-hidden">
              <table className="w-full text-sm table-fixed">
                <thead className="text-xs text-gray-500 border-b">
                  <tr>
                    <th className="text-left py-1.5">URL</th>
                    <th className="text-right py-1.5 w-20">Диалогов</th>
                  </tr>
                </thead>
                <tbody>
                  {topPages.data.items.map((it) => (
                    <tr key={it.url} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        <div className="truncate text-gray-700" title={it.url}>
                          {it.url || '—'}
                        </div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{it.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: number | null;
  loading: boolean;
  tone?: 'warn';
}) {
  return (
    <div className="bg-white border border-gray-200 rounded p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={`text-2xl font-semibold tabular-nums ${
          tone === 'warn' ? 'text-orange-600' : 'text-gray-900'
        }`}
      >
        {loading ? '…' : value ?? '—'}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded p-4">
      <div className="text-sm font-medium text-gray-700 mb-3">{title}</div>
      {error ? (
        <div className="text-sm text-red-600">Ошибка: {error}</div>
      ) : loading ? (
        <div className="text-sm text-gray-400">Загрузка…</div>
      ) : (
        children
      )}
    </div>
  );
}

function Empty() {
  return <div className="text-sm text-gray-400 py-8 text-center">Нет данных</div>;
}

function SourcePie({ items, total }: { items: BySourceItem[]; total: number }) {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="w-full sm:w-[220px] h-[220px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="n"
              nameKey="source_bucket"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={1}
              stroke="none"
            >
              {items.map((it) => (
                <Cell
                  key={it.source_bucket}
                  fill={SOURCE_COLORS[it.source_bucket as SourceBucket] || '#9ca3af'}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, _n, p) => {
                const bucket = (p as { payload?: { source_bucket?: string } }).payload
                  ?.source_bucket;
                return [
                  Number(v).toLocaleString('ru-RU'),
                  SOURCE_LABELS[bucket as SourceBucket] || bucket || '',
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 w-full space-y-1.5 text-sm min-w-0">
        {items.map((it) => {
          const pct = total ? (it.n / total) * 100 : 0;
          return (
            <li
              key={it.source_bucket}
              className="flex items-center gap-2 min-w-0"
            >
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{
                  backgroundColor:
                    SOURCE_COLORS[it.source_bucket as SourceBucket] || '#9ca3af',
                }}
              />
              <span className="truncate text-gray-700">
                {SOURCE_LABELS[it.source_bucket as SourceBucket] || it.source_bucket}
              </span>
              <span className="ml-auto tabular-nums text-gray-900 shrink-0">
                {it.n.toLocaleString('ru-RU')}
              </span>
              <span className="tabular-nums text-gray-400 text-xs w-10 text-right shrink-0">
                {pct.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FunnelView({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-2 py-2">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const conv =
          i > 0 && stages[0].value > 0
            ? ((s.value / stages[0].value) * 100).toFixed(1)
            : null;
        return (
          <div key={s.key}>
            <div className="flex items-baseline justify-between text-xs mb-0.5">
              <span className="text-gray-700">{s.label}</span>
              <span className="tabular-nums text-gray-900">
                {s.value}
                {conv != null && <span className="text-gray-400 ml-2">{conv}%</span>}
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded">
              <div
                className="h-full bg-blue-500 rounded"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
