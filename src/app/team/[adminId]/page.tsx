'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { use } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { GlobalFilterBar } from '@/components/GlobalFilterBar';
import { useGlobalFilters, filtersToQueryString } from '@/hooks/useGlobalFilters';
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  type SourceBucket,
  type StatusBucket,
} from '@/lib/filters/types';

interface AdminDetail {
  admin: { id: string; name: string | null; email: string | null };
  totals: {
    total: number;
    open_count: number;
    closed_count: number;
    avg_frt: number | null;
    median_frt: number | null;
  };
  daily: { day: string; n: number; avg_frt: number | null }[];
  by_status: { status_bucket: string; n: number }[];
  by_source: { source_bucket: string; n: number }[];
  frt_distribution: { label: string; n: number }[];
}

function fmtDuration(secs: number | null): string {
  if (secs == null) return '—';
  if (secs < 60) return `${secs}с`;
  if (secs < 3600) return `${Math.round(secs / 60)}м`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}ч`;
  return `${(secs / 86400).toFixed(1)}д`;
}

const STATUS_COLORS: Record<string, string> = {
  new: '#60a5fa',
  in_progress: '#3b82f6',
  negotiation: '#a855f7',
  tech_q: '#f97316',
  no_reply: '#f59e0b',
  closed_deal: '#10b981',
  closed: '#9ca3af',
  unknown: '#d1d5db',
};

const SOURCE_COLORS: Record<string, string> = {
  telegram_boostyfi: '#2563eb',
  telegram_iamlimitless: '#7c3aed',
  facebook: '#1877f2',
  website: '#16a34a',
  email: '#f59e0b',
  other: '#6b7280',
  unknown: '#9ca3af',
};

export default function AdminDetailPage({
  params,
}: {
  params: Promise<{ adminId: string }>;
}) {
  const { adminId } = use(params);
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Загрузка…</div>}>
      <Inner adminId={adminId} />
    </Suspense>
  );
}

function Inner({ adminId }: { adminId: string }) {
  const { filters, key } = useGlobalFilters();
  const qs = filtersToQueryString(filters);
  const [data, setData] = useState<AdminDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/team/admin/${adminId}?${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId, `${qs}|${key}`]);

  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalFilterBar />
      <div className="p-4 max-w-[1400px] mx-auto space-y-4">
        <div className="flex items-baseline gap-3">
          <Link href={`/team?${qs}`} className="text-sm text-blue-600 hover:underline">
            ← К команде
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">
            {data?.admin.name || data?.admin.email || `admin ${adminId}`}
          </h1>
          {data?.admin.email && data?.admin.name && (
            <span className="text-sm text-gray-500">{data.admin.email}</span>
          )}
        </div>

        {error && <div className="text-sm text-red-600">Ошибка: {error}</div>}
        {loading && <div className="text-sm text-gray-400">Загрузка…</div>}

        {data && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Kpi label="Всего" value={data.totals.total} />
              <Kpi label="Открытых" value={data.totals.open_count} />
              <Kpi label="Закрытых" value={data.totals.closed_count} />
              <Kpi label="Медиана FRT" value={fmtDuration(data.totals.median_frt)} />
              <Kpi label="Среднее FRT" value={fmtDuration(data.totals.avg_frt)} />
            </div>

            {/* Daily bar */}
            <Card title="По дням">
              {data.daily.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="n" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty />
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* FRT distribution */}
              <Card title="Распределение FRT">
                {data.frt_distribution.some((d) => d.n > 0) ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.frt_distribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="n" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty />
                )}
              </Card>

              {/* Status mix */}
              <Card title="По статусам">
                {data.by_status.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={data.by_status.map((s) => ({
                          ...s,
                          label: STATUS_LABELS[s.status_bucket as StatusBucket] || s.status_bucket,
                        }))}
                        dataKey="n"
                        nameKey="label"
                        outerRadius={90}
                      >
                        {data.by_status.map((s) => (
                          <Cell
                            key={s.status_bucket}
                            fill={STATUS_COLORS[s.status_bucket] || '#9ca3af'}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty />
                )}
              </Card>
            </div>

            {/* Source mix table */}
            <Card title="По источникам">
              {data.by_source.length > 0 ? (
                <table className="w-full text-sm">
                  <tbody>
                    {data.by_source.map((s) => (
                      <tr key={s.source_bucket} className="border-b last:border-0">
                        <td className="py-1.5 flex items-center gap-2">
                          <span
                            className="inline-block w-3 h-3 rounded-sm"
                            style={{
                              background: SOURCE_COLORS[s.source_bucket] || '#9ca3af',
                            }}
                          />
                          {SOURCE_LABELS[s.source_bucket as SourceBucket] || s.source_bucket}
                        </td>
                        <td className="py-1.5 text-right tabular-nums w-24">{s.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-gray-200 rounded p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded p-4">
      <div className="text-sm font-medium text-gray-700 mb-3">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-sm text-gray-400 py-8 text-center">Нет данных</div>;
}
