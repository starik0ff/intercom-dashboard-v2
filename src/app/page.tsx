'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  ClipboardList,
  Database,
  HeartPulse,
  LogOut,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Settings,
  Shield,
  Terminal,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth';

interface SyncStatus {
  totals: { conversations: number; messages: number };
  bootstrap: { completed_at: string | null };
  incremental: {
    last_run_at: string | null;
    last_processed: number;
    cursor: number | null;
  };
  worker: { started_at: string | null };
  errors: { last_24h: number; recent: { scope: string; message: string; ts: string }[] };
}

interface HealthResp {
  status: 'ok' | 'warn' | 'fail';
  checks: { name: string; status: 'ok' | 'warn' | 'fail'; ms: number; detail?: string }[];
}

interface Stats {
  totalConversations: number;
  totalAuthors: number;
  dateRange: { min: string; max: string };
}

function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU');
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'нет данных';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export default function AdminHome() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/auth/me').then(r => r.json()).then(d => setUser(d.user || null)).catch(() => null),
      fetch('/api/sync-status').then(r => r.ok ? r.json() : null).then(setSync).catch(() => null),
      fetch('/api/health/full?probe=0').then(r => r.ok ? r.json() : null).then(setHealth).catch(() => null),
      fetch('/api/stats').then(r => r.ok ? r.json() : null).then(setStats).catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const healthColor = {
    ok: 'text-green-600 bg-green-100',
    warn: 'text-yellow-600 bg-yellow-100',
    fail: 'text-red-600 bg-red-100',
  };

  const healthIcon = {
    ok: <CheckCircle2 className="w-4 h-4" />,
    warn: <AlertTriangle className="w-4 h-4" />,
    fail: <XCircle className="w-4 h-4" />,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Settings className="w-6 h-6 text-blue-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
              Админ-панель
            </h1>
            <p className="text-xs text-gray-500 truncate">Intercom Dashboard — управление и мониторинг</p>
          </div>
          {user && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-gray-600 hidden md:block">
                <span className="font-medium text-gray-900">{user.displayName}</span>
                <span className="text-gray-400 ml-1">({user.username})</span>
              </span>
              <button
                onClick={fetchAll}
                title="Обновить"
                className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 p-1.5 sm:px-3 sm:py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
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

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loading && !stats && (
          <div className="text-center py-16">
            <div className="inline-block w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-3">Загрузка...</p>
          </div>
        )}

        {stats && (
          <>
            {/* KPI */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Диалогов" value={fmtNum(stats.totalConversations)} icon={<MessageSquare className="w-4 h-4" />} accent="blue" />
              <KpiCard label="Сообщений" value={fmtNum(sync?.totals.messages ?? 0)} icon={<Database className="w-4 h-4" />} accent="indigo" />
              <KpiCard label="Авторов" value={fmtNum(stats.totalAuthors)} icon={<Users className="w-4 h-4" />} accent="green" />
              <KpiCard
                label="Ошибки 24ч"
                value={fmtNum(sync?.errors.last_24h ?? 0)}
                icon={<AlertTriangle className="w-4 h-4" />}
                accent={(sync?.errors.last_24h ?? 0) > 0 ? 'red' : 'gray'}
              />
            </section>

            {/* Health + Sync widgets */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Health */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <HeartPulse className="w-4 h-4 text-blue-600" />
                    Health
                  </h2>
                  {health && (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${healthColor[health.status]}`}>
                      {healthIcon[health.status]}
                      {health.status.toUpperCase()}
                    </span>
                  )}
                </div>
                {health ? (
                  <div className="space-y-2">
                    {health.checks.map((c) => (
                      <div key={c.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${c.status === 'ok' ? 'bg-green-500' : c.status === 'warn' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                          <span className="text-gray-700">{c.name}</span>
                        </div>
                        <span className="text-xs text-gray-400 tabular-nums">{c.ms}ms</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Загрузка...</p>
                )}
                <Link href="/admin/health" className="inline-block mt-4 text-xs text-blue-600 hover:text-blue-800">
                  Подробнее →
                </Link>
              </div>

              {/* Sync */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-blue-600" />
                    Синхронизация
                  </h2>
                </div>
                {sync ? (
                  <div className="space-y-3">
                    <InfoRow label="Последний sync" value={relativeTime(sync.incremental.last_run_at)} />
                    <InfoRow label="Обработано" value={`${sync.incremental.last_processed} диалогов`} />
                    <InfoRow label="Worker uptime" value={relativeTime(sync.worker.started_at)} />
                    <InfoRow label="Bootstrap" value={sync.bootstrap.completed_at ? new Date(sync.bootstrap.completed_at).toLocaleDateString('ru-RU') : 'не завершён'} />
                    {sync.errors.last_24h > 0 && (
                      <div className="mt-2 p-2 bg-red-50 rounded-lg text-xs text-red-700">
                        {sync.errors.last_24h} ошибок за 24ч
                        {sync.errors.recent.length > 0 && (
                          <div className="mt-1 text-red-500 truncate">
                            Последняя: {sync.errors.recent[0].message}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Загрузка...</p>
                )}
              </div>
            </section>

            {/* Nav tiles */}
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Управление</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <NavTile
                  href="/monitoring"
                  icon={<Activity className="w-5 h-5" />}
                  title="Мониторинг"
                  desc="Каналы, SLA, без ответа, дубли"
                />
                <NavTile
                  href="/admin/scripts"
                  icon={<Terminal className="w-5 h-5" />}
                  title="Скрипты"
                  desc="Запуск сервисных скриптов"
                />
                <NavTile
                  href="/admin/health"
                  icon={<HeartPulse className="w-5 h-5" />}
                  title="Health checks"
                  desc="Состояние БД, воркера, Intercom API"
                />
                <NavTile
                  href="/admin/logs"
                  icon={<ClipboardList className="w-5 h-5" />}
                  title="Логи"
                  desc="Журнал активности пользователей"
                />
                <NavTile
                  href="/admin/telegram"
                  icon={<MessageCircle className="w-5 h-5" />}
                  title="Telegram"
                  desc="Подключение уведомлений менеджеров"
                />
                <NavTile
                  href="/api"
                  icon={<Shield className="w-5 h-5" />}
                  title="Swagger API"
                  desc="Документация и тестирование API"
                />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function KpiCard({ label, value, icon, accent }: {
  label: string; value: string; icon: React.ReactNode;
  accent: 'blue' | 'indigo' | 'green' | 'gray' | 'red';
}) {
  const colors: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50',
    indigo: 'text-indigo-600 bg-indigo-50',
    green: 'text-green-600 bg-green-50',
    gray: 'text-gray-600 bg-gray-50',
    red: 'text-red-600 bg-red-50',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`p-1.5 rounded-lg ${colors[accent]}`}>{icon}</span>
        <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${accent === 'red' ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}

function NavTile({ href, icon, title, desc }: {
  href: string; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <Link
      href={href}
      className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-sm transition"
    >
      <div className="flex items-center gap-2 text-blue-600 mb-1">
        {icon}
        <div className="text-sm font-semibold text-gray-900">{title}</div>
      </div>
      <p className="text-xs text-gray-500 leading-snug">{desc}</p>
    </Link>
  );
}
