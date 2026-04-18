"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  MessageCircleOff,
  Clock,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  Copy,
  Search,
  Plug,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  FileJson,
  FileText,
  ExternalLink,
} from "lucide-react";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import {
  useGlobalFilters,
  filtersToQueryString,
} from "@/hooks/useGlobalFilters";
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  type SourceBucket,
  type StatusBucket,
} from "@/lib/filters/types";

type FilterType = "inWork" | "unanswered" | "waiting1h" | "duplicates";

interface ChannelStatus {
  channel: string;
  label: string;
  totalOpen: number;
  last1h: number;
  last24h: number;
  lastMessageAt: string | null;
  lastConvId: string | null;
  status: "ok" | "warning" | "error";
}

interface IntegrationsData {
  channels: ChannelStatus[];
  checkedAt: string;
}

interface InWorkItem {
  id: string;
  updated_at: string;
  messageCount: number;
  lastAuthor: string;
  preview: string;
}

interface UnansweredItem {
  id: string;
  waitingMs: number;
  lastAuthor: string;
  lastDate: string;
  preview: string;
}

interface DuplicateConv {
  id: string;
  updated_at: string;
  preview: string;
  assignee: string;
}

interface DuplicateGroup {
  email: string;
  chatsCount: number;
  managersCount: number;
  managers: string[];
  conversations: DuplicateConv[];
}

interface FilterResult {
  list: InWorkItem[] | UnansweredItem[] | DuplicateGroup[];
  total: number;
  page: number;
  pageSize: number;
}

interface MonitoringData {
  inWork: number;
  unansweredCount: number;
  avgResponseMs: number | null;
  waitingOver1h: number;
  duplicatesCount: number;
  computedAt: string;
  period: string;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} д ${hours % 24} ч`;
  if (hours > 0) return `${hours} ч ${minutes % 60} мин`;
  return `${minutes} мин`;
}

function formatResponseTime(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours} ч ${minutes % 60} мин`;
  return `${minutes} мин`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "только что";
  return `${formatDuration(diff)} назад`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FILTER_LABELS: Record<FilterType, string> = {
  inWork: "Диалоги в работе",
  unanswered: "Неотвеченные диалоги",
  waiting1h: "Ожидают > 1 часа",
  duplicates: "Дубли по email",
};

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  onClick,
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  color: string;
  onClick?: () => void;
}) {
  const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
    blue: { bg: "bg-blue-50", text: "text-blue-700", icon: "text-blue-500" },
    red: { bg: "bg-red-50", text: "text-red-700", icon: "text-red-500" },
    green: { bg: "bg-green-50", text: "text-green-700", icon: "text-green-500" },
    orange: { bg: "bg-orange-50", text: "text-orange-700", icon: "text-orange-500" },
  };
  const c = colorMap[color] || colorMap.blue;

  const base = "bg-white border border-gray-200 rounded-xl p-5 text-left transition-all";
  const interactive = onClick ? "cursor-pointer hover:shadow-md hover:border-gray-300" : "";

  return (
    <button className={`${base} ${interactive}`} onClick={onClick} disabled={!onClick}>
      <div className="flex items-center gap-3">
        <div className={`${c.bg} p-2.5 rounded-lg`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className={`text-2xl font-bold ${c.text}`}>{value}</p>
        </div>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="bg-gray-200 w-10 h-10 rounded-lg" />
        <div>
          <div className="bg-gray-200 h-4 w-24 rounded mb-2" />
          <div className="bg-gray-200 h-7 w-16 rounded" />
        </div>
      </div>
    </div>
  );
}

export default function MonitoringPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Загрузка…</div>}>
      <MonitoringPageInner />
    </Suspense>
  );
}

function MonitoringPageInner() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType | null>(null);
  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterPage, setFilterPage] = useState(1);
  const [emailSearch, setEmailSearch] = useState("");
  const [integrations, setIntegrations] = useState<IntegrationsData | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/monitoring");
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    try {
      const res = await fetch("/api/monitoring/integrations");
      const json = await res.json();
      setIntegrations(json);
    } catch {
      // ignore
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  const fetchFilter = useCallback(async (filter: FilterType, page: number, search?: string) => {
    setFilterLoading(true);
    try {
      const params = new URLSearchParams({ filter, page: String(page) });
      if (search) params.set("q", search);
      const res = await fetch(`/api/monitoring?${params}`);
      const json = await res.json();
      setFilterResult(json);
    } catch {
      // ignore
    } finally {
      setFilterLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchIntegrations();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    const intInterval = setInterval(fetchIntegrations, 3 * 60 * 1000);
    return () => { clearInterval(interval); clearInterval(intInterval); };
  }, [fetchData, fetchIntegrations]);

  function handleCardClick(filter: FilterType) {
    setActiveFilter(filter);
    setFilterPage(1);
    setFilterResult(null);
    setEmailSearch("");
    fetchFilter(filter, 1);
  }

  function handlePageChange(newPage: number) {
    if (!activeFilter) return;
    setFilterPage(newPage);
    fetchFilter(activeFilter, newPage, emailSearch);
    document.getElementById("filter-table")?.scrollIntoView({ behavior: "smooth" });
  }

  function handleEmailSearch(q: string) {
    setEmailSearch(q);
    setFilterPage(1);
    fetchFilter("duplicates", 1, q);
  }

  function handleRefresh() {
    setLoading(true);
    fetchData();
    fetchIntegrations();
    if (activeFilter) fetchFilter(activeFilter, filterPage, emailSearch);
  }

  const totalPages = filterResult ? Math.ceil(filterResult.total / filterResult.pageSize) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Админ-панель
          </Link>
          <div className="ml-2">
            <h1 className="text-xl font-bold text-gray-900">Мониторинг диалогов</h1>
          </div>
        </div>
      </header>

      <GlobalFilterBar />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Legacy monitoring metrics + integrations hidden */}

        <ExportConversationsSection />
      </main>
    </div>
  );
}

// ─── Export view ────────────────────────────────────────────────────────────
// Browse all conversations matching current global filters and download
// CSV / JSON. Filters live in URL state via GlobalFilterBar at the top.

interface ConversationRow {
  id: string;
  created_at: number;
  updated_at: number;
  open: number;
  state: string | null;
  source_bucket: string;
  status_bucket: string;
  status_source: string;
  contact_name: string | null;
  contact_email: string | null;
  admin_assignee_id: string | null;
  admin_name: string | null;
  team_name: string | null;
  parts_count: number;
  user_messages_count: number;
  admin_messages_count: number;
  first_response_seconds: number | null;
  source_url: string | null;
}

interface ConversationsResp {
  items: ConversationRow[];
  total: number;
  page: number;
  page_size: number;
}

function fmtUnix(ts: number): string {
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSec(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м`;
  return `${Math.floor(m / 60)}ч ${m % 60}м`;
}

interface AdminOption { id: string; name: string }

function ExportConversationsSection() {
  const { filters, key } = useGlobalFilters();
  const qs = filtersToQueryString(filters);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [dateField, setDateField] = useState<'created_at' | 'updated_at' | 'last_message_at'>('created_at');
  const [adminId, setAdminId] = useState('');
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [data, setData] = useState<ConversationsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load admins list once
  useEffect(() => {
    fetch('/api/team/list')
      .then((r) => r.json())
      .then((d) => {
        const all: AdminOption[] = [];
        for (const team of d.teams || []) {
          for (const m of team.members || []) {
            if (!all.some((a) => a.id === m.admin_id)) {
              all.push({ id: m.admin_id, name: m.admin_name || m.admin_id });
            }
          }
        }
        all.sort((a, b) => a.name.localeCompare(b.name));
        setAdmins(all);
      })
      .catch(() => {});
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [qs, key, dateField, adminId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(qs);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    params.set("date_field", dateField);
    if (adminId) params.set("admin_id", adminId);
    fetch(`/api/conversations?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<ConversationsResp>;
      })
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [qs, key, page, pageSize, dateField, adminId]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  // Background export state
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'pending' | 'processing' | 'done' | 'error'>('idle');
  const [exportProgress, setExportProgress] = useState<{ processed: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const startExport = async (format: 'csv' | 'json') => {
    setExportStatus('pending');
    setExportProgress(null);
    setExportError(null);
    try {
      const filtersObj = {
        period: filters.period,
        from: filters.from,
        to: filters.to,
        sources: filters.sources,
        statuses: filters.statuses,
        date_field: dateField,
        admin_id: adminId || undefined,
      };
      const res = await fetch('/api/export/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, filters: filtersObj }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { id } = await res.json();
      setExportJobId(id);
    } catch (e) {
      setExportStatus('error');
      setExportError(String(e));
    }
  };

  // Poll export status
  useEffect(() => {
    if (!exportJobId || exportStatus === 'done' || exportStatus === 'error' || exportStatus === 'idle') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/export/status?id=${exportJobId}`);
        if (!res.ok) return;
        const job = await res.json();
        if (job.status === 'processing' || job.status === 'pending') {
          setExportStatus('processing');
          if (job.total_rows) setExportProgress({ processed: job.processed_rows || 0, total: job.total_rows });
        } else if (job.status === 'done') {
          setExportStatus('done');
          setExportProgress(job.total_rows ? { processed: job.total_rows, total: job.total_rows } : null);
        } else if (job.status === 'error') {
          setExportStatus('error');
          setExportError(job.error_message || 'Unknown error');
        }
      } catch { /* retry next tick */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [exportJobId, exportStatus]);

  const resetExport = () => {
    setExportJobId(null);
    setExportStatus('idle');
    setExportProgress(null);
    setExportError(null);
  };

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Download className="w-5 h-5 text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-900">Экспорт диалогов</h2>
        <div className="flex items-center gap-1 bg-gray-100 rounded p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setDateField('created_at')}
            className={`px-2 py-1 rounded ${dateField === 'created_at' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            По созданию
          </button>
          <button
            type="button"
            onClick={() => setDateField('last_message_at')}
            className={`px-2 py-1 rounded ${dateField === 'last_message_at' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            По активности
          </button>
        </div>
        <select
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-700"
        >
          <option value="">Все менеджеры</option>
          {admins.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        {data && (
          <span className="text-sm text-gray-500">
            {data.total.toLocaleString("ru-RU")} диалогов
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {exportStatus === 'idle' ? (
            <>
              <button
                onClick={() => startExport('csv')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                <FileText className="w-4 h-4" />
                CSV
              </button>
              <button
                onClick={() => startExport('json')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-800 text-white rounded hover:bg-gray-900"
              >
                <FileJson className="w-4 h-4" />
                JSON
              </button>
            </>
          ) : exportStatus === 'pending' || exportStatus === 'processing' ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>
                {exportProgress
                  ? `${exportProgress.processed.toLocaleString('ru-RU')} / ${exportProgress.total.toLocaleString('ru-RU')}`
                  : 'Подготовка...'}
              </span>
            </div>
          ) : exportStatus === 'done' ? (
            <div className="flex items-center gap-2">
              <a
                href={`/api/export/download?id=${exportJobId}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
              >
                <Download className="w-4 h-4" />
                Скачать
              </a>
              <button
                onClick={resetExport}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Новый экспорт
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-600">{exportError || 'Ошибка'}</span>
              <button
                onClick={resetExport}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Повторить
              </button>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
          Ошибка: {error}
        </div>
      ) : loading && !data ? (
        <div className="bg-white border border-gray-200 rounded p-8 text-center text-sm text-gray-500">
          Загрузка…
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="bg-white border border-gray-200 rounded overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">ID</th>
                  <th className="text-left px-3 py-2 font-medium">Создан</th>
                  <th className="text-left px-3 py-2 font-medium">Источник</th>
                  <th className="text-left px-3 py-2 font-medium">Статус</th>
                  <th className="text-left px-3 py-2 font-medium">Клиент</th>
                  <th className="text-left px-3 py-2 font-medium">Менеджер</th>
                  <th className="text-right px-3 py-2 font-medium">Сообщ.</th>
                  <th className="text-right px-3 py-2 font-medium">1-й ответ</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link
                        href={`/conversation/${c.id}`}
                        className="text-blue-600 hover:underline font-mono text-xs"
                      >
                        {c.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {fmtUnix(c.created_at)}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {SOURCE_LABELS[c.source_bucket as SourceBucket] || c.source_bucket}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {STATUS_LABELS[c.status_bucket as StatusBucket] || c.status_bucket}
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">
                      {c.contact_name || c.contact_email || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-[140px] truncate">
                      {c.admin_name || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {c.parts_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {fmtSec(c.first_response_seconds)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть в Intercom"
                        className="text-gray-400 hover:text-gray-700 inline-flex"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
            <span>
              Стр. {data.page} из {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white border border-gray-200 rounded p-8 text-center text-sm text-gray-500">
          Нет диалогов по выбранным фильтрам
        </div>
      )}
    </section>
  );
}
