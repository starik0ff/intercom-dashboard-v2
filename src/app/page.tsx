'use client';

// Landing dashboard for v2. Shows KPI funnel + source breakdown driven by
// the global filter bar, plus navigation tiles to the main sections.

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import {
  Activity,
  BarChart2,
  ClipboardList,
  HeartPulse,
  Terminal,
  LogOut,
  Search,
  Shield,
  Trophy,
  Users,
} from 'lucide-react';
import { GlobalFilterBar } from '@/components/GlobalFilterBar';
import { useGlobalFilters, filtersToQueryString } from '@/hooks/useGlobalFilters';
import { SOURCE_LABELS, type SourceBucket } from '@/lib/filters/types';
import type { SessionUser } from '@/lib/auth';

interface FunnelResp {
  stages: { key: string; label: string; value: number }[];
  no_reply: number;
}

interface SourceRow {
  source_bucket: string;
  n: number;
}

interface SourceResp {
  total: number;
  items: SourceRow[];
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU');
}

function pct(n: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Загрузка…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const { filters, key } = useGlobalFilters();
  const qs = filtersToQueryString(filters);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [funnel, setFunnel] = useState<FunnelResp | null>(null);
  const [sources, setSources] = useState<SourceResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .catch(() => null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/traffic/funnel?${qs}`).then((r) => {
        if (!r.ok) throw new Error(`funnel ${r.status}`);
        return r.json() as Promise<FunnelResp>;
      }),
      fetch(`/api/traffic/by-source?${qs}`).then((r) => {
        if (!r.ok) throw new Error(`by-source ${r.status}`);
        return r.json() as Promise<SourceResp>;
      }),
    ])
      .then(([f, s]) => {
        if (cancelled) return;
        setFunnel(f);
        setSources(s);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [qs, key]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const total = funnel?.stages.find((s) => s.key === 'total')?.value ?? 0;
  const firstReply = funnel?.stages.find((s) => s.key === 'first_reply')?.value ?? 0;
  const closed = funnel?.stages.find((s) => s.key === 'closed')?.value ?? 0;
  const closedDeal = funnel?.stages.find((s) => s.key === 'closed_deal')?.value ?? 0;
  const noReply = funnel?.no_reply ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Shield className="w-6 h-6 text-blue-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
              Intercom Dashboard
            </h1>
            <p className="text-xs text-gray-500 truncate">Аналитика и аудит диалогов</p>
          </div>
          {user && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-gray-600 hidden md:block">
                <span className="font-medium text-gray-900">{user.displayName}</span>
                <span className="text-gray-400 ml-1">({user.username})</span>
              </span>
              {user.role === 'admin' && (
                <Link
                  href="/admin/health"
                  title="Health"
                  className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 p-1.5 sm:px-3 sm:py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <HeartPulse className="w-4 h-4" />
                  <span className="hidden md:inline">Health</span>
                </Link>
              )}
              {user.role === 'admin' && (
                <Link
                  href="/admin/logs"
                  title="Логи"
                  className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 p-1.5 sm:px-3 sm:py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <ClipboardList className="w-4 h-4" />
                  <span className="hidden md:inline">Логи</span>
                </Link>
              )}
              {user.role === 'admin' && (
                <Link
                  href="/admin/scripts"
                  title="Скрипты"
                  className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 p-1.5 sm:px-3 sm:py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <Terminal className="w-4 h-4" />
                  <span className="hidden md:inline">Скрипты</span>
                </Link>
              )}
              <button
                type="button"
                onClick={handleLogout}
                title="Выйти"
                className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-red-600 p-1.5 sm:px-3 sm:py-1.5 border border-gray-300 rounded-lg hover:border-red-300 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden md:inline">Выйти</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <GlobalFilterBar />

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 text-sm text-red-700 p-3">
            Ошибка загрузки: {error}
          </div>
        )}

        {/* KPI row */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Всего диалогов"
            value={fmtNum(total)}
            hint={loading ? 'загрузка…' : 'по текущим фильтрам'}
            accent="blue"
          />
          <KpiCard
            label="С первым ответом"
            value={fmtNum(firstReply)}
            hint={pct(firstReply, total) + ' от всех'}
            accent="indigo"
          />
          <KpiCard
            label="Закрыто"
            value={fmtNum(closed)}
            hint={pct(closed, total) + ' от всех'}
            accent="gray"
          />
          <KpiCard
            label="Closed Deal"
            value={fmtNum(closedDeal)}
            hint={pct(closedDeal, total) + ' от всех'}
            accent="green"
          />
        </section>

        {/* Source breakdown + no-reply callout */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 bg-white border border-gray-200 rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">По источникам</h2>
              <Link
                href={`/traffic?${qs}`}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                подробнее →
              </Link>
            </div>
            {sources && sources.items.length > 0 ? (
              <div className="space-y-2">
                {sources.items.map((r) => {
                  const p = sources.total ? (r.n / sources.total) * 100 : 0;
                  return (
                    <div key={r.source_bucket} className="flex items-center gap-3 text-sm">
                      <div className="w-28 text-gray-700 shrink-0">
                        {SOURCE_LABELS[r.source_bucket as SourceBucket] ?? r.source_bucket}
                      </div>
                      <div className="flex-1 bg-gray-100 rounded h-2 overflow-hidden">
                        <div
                          className="bg-blue-500 h-full"
                          style={{ width: `${p}%` }}
                        />
                      </div>
                      <div className="w-20 text-right tabular-nums text-gray-700">
                        {fmtNum(r.n)}
                      </div>
                      <div className="w-10 text-right tabular-nums text-gray-400 text-xs">
                        {Math.round(p)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-400 py-4 text-center">
                {loading ? 'Загрузка…' : 'Нет данных'}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-red-500" />
              <h2 className="text-sm font-semibold text-gray-900">Без ответа</h2>
            </div>
            <div className="text-3xl font-bold text-red-600 tabular-nums">
              {fmtNum(noReply)}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              диалогов в статусе «без ответа» по текущим фильтрам
            </p>
            <Link
              href={`/search?${qs}&statuses=no_reply`}
              className="inline-block mt-3 text-xs text-blue-600 hover:text-blue-800"
            >
              открыть список →
            </Link>
          </div>
        </section>

        {/* Navigation tiles */}
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Разделы</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <NavTile
              href={`/search?${qs}`}
              icon={<Search className="w-5 h-5" />}
              title="Поиск"
              desc="Полнотекстовый поиск по всем сообщениям (FTS5)"
            />
            <NavTile
              href={`/closed-deals?${qs}`}
              icon={<Trophy className="w-5 h-5" />}
              title="Closed Deals"
              desc="Диалоги с ручной пометкой «сделка закрыта»"
            />
            <NavTile
              href={`/traffic?${qs}`}
              icon={<BarChart2 className="w-5 h-5" />}
              title="Трафик"
              desc="Динамика обращений, источники, воронка"
            />
            <NavTile
              href={`/team?${qs}`}
              icon={<Users className="w-5 h-5" />}
              title="Команда"
              desc="Статистика по менеджерам и нагрузка"
            />
            <NavTile
              href={`/monitoring?${qs}`}
              icon={<Activity className="w-5 h-5" />}
              title="Мониторинг"
              desc="SLA, время ответа, аномалии"
            />
            {user?.role === 'admin' && (
              <NavTile
                href="/admin/health"
                icon={<HeartPulse className="w-5 h-5" />}
                title="Health checks"
                desc="Состояние БД, воркера, Intercom API"
              />
            )}
          </div>
        </section>

        <div className="text-xs text-gray-400 pt-2">
          API / документация:{' '}
          <Link href="/api" className="text-blue-600 hover:text-blue-800">
            Swagger UI
          </Link>{' '}
          ·{' '}
          <Link href="/api/openapi.json" className="text-blue-600 hover:text-blue-800">
            openapi.json
          </Link>
        </div>
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: 'blue' | 'indigo' | 'green' | 'gray';
}) {
  const accentMap: Record<string, string> = {
    blue: 'text-blue-600',
    indigo: 'text-indigo-600',
    green: 'text-green-600',
    gray: 'text-gray-700',
  };
  return (
    <div className="bg-white border border-gray-200 rounded p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold tabular-nums mt-1 ${accentMap[accent]}`}>
        {value}
      </div>
      <div className="text-xs text-gray-400 mt-1">{hint}</div>
    </div>
  );
}

function NavTile({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="block bg-white border border-gray-200 rounded p-4 hover:border-blue-400 hover:shadow-sm transition"
    >
      <div className="flex items-center gap-2 text-blue-600 mb-1">
        {icon}
        <div className="text-sm font-semibold text-gray-900">{title}</div>
      </div>
      <p className="text-xs text-gray-500 leading-snug">{desc}</p>
    </Link>
  );
}
