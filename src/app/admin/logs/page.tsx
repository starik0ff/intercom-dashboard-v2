"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, LogIn, LogOut, Search, Eye, Download, Filter, ShieldAlert } from "lucide-react";
import type { LogEntry, ActionType } from "@/lib/logger";

const ACTION_LABELS: Record<ActionType, string> = {
  login: "Вход",
  login_failed: "Неудачный вход",
  logout: "Выход",
  search: "Поиск",
  view_conversation: "Просмотр диалога",
  export: "Экспорт",
  export_start: "Запуск экспорта",
};

const ACTION_ICONS: Record<ActionType, React.ReactNode> = {
  login: <LogIn className="w-3.5 h-3.5" />,
  login_failed: <ShieldAlert className="w-3.5 h-3.5" />,
  logout: <LogOut className="w-3.5 h-3.5" />,
  search: <Search className="w-3.5 h-3.5" />,
  view_conversation: <Eye className="w-3.5 h-3.5" />,
  export: <Download className="w-3.5 h-3.5" />,
  export_start: <Download className="w-3.5 h-3.5" />,
};

const ACTION_COLORS: Record<ActionType, string> = {
  login: "bg-green-100 text-green-700",
  login_failed: "bg-red-100 text-red-700",
  logout: "bg-gray-100 text-gray-600",
  search: "bg-blue-100 text-blue-700",
  view_conversation: "bg-purple-100 text-purple-700",
  export: "bg-orange-100 text-orange-700",
  export_start: "bg-yellow-100 text-yellow-700",
};

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDetails(action: ActionType, details: Record<string, unknown>): string {
  if (action === "search") {
    const parts: string[] = [];
    if (details.author) parts.push(`автор: ${details.author}`);
    if (details.body) parts.push(`текст: "${details.body}"`);
    if (details.dateFrom || details.dateTo) parts.push(`дата: ${details.dateFrom || "…"} — ${details.dateTo || "…"}`);
    if (details.total !== undefined) parts.push(`найдено: ${details.total}`);
    return parts.join(", ") || "—";
  }
  if (action === "view_conversation") {
    return details.conversation_id ? `ID: ${details.conversation_id}` : "—";
  }
  if (action === "export") {
    const parts: string[] = [];
    if (details.format) parts.push(`формат: ${details.format}`);
    if (details.author) parts.push(`автор: ${details.author}`);
    if (details.body) parts.push(`текст: "${details.body}"`);
    return parts.join(", ") || "—";
  }
  if (action === "login") {
    return details.ip ? `IP: ${details.ip}` : "—";
  }
  return "—";
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterUser, setFilterUser] = useState("all");
  const [filterAction, setFilterAction] = useState("all");

  async function fetchLogs() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/logs?limit=1000");
      if (res.status === 403) {
        setError("Доступ запрещён. Только для администратора.");
        return;
      }
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      setError("Ошибка загрузки логов");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
  }, []);

  const filtered = logs.filter((l) => {
    if (filterUser !== "all" && l.user !== filterUser) return false;
    if (filterAction !== "all" && l.action !== filterAction) return false;
    return true;
  });

  const users = [...new Set(logs.map((l) => l.user))];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Админ-панель
            </a>
            <span className="text-gray-300">|</span>
            <h1 className="text-sm font-semibold text-gray-900">Журнал активности</h1>
          </div>
          <button
            onClick={fetchLogs}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Обновить
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-4 flex items-center gap-4 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">Пользователь:</label>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="all">Все</option>
              {users.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">Действие:</label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="all">Все</option>
              {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
                <option key={a} value={a}>{ACTION_LABELS[a]}</option>
              ))}
            </select>
          </div>
          <span className="ml-auto text-sm text-gray-400">
            {filtered.length} записей
          </span>
        </div>

        {loading && (
          <div className="text-center py-16">
            <div className="inline-block w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-3">Загрузка логов...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-16">
            <p className="text-red-600 font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Дата и время</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Пользователь</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Действие</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Детали</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-gray-400">
                      Нет записей
                    </td>
                  </tr>
                )}
                {filtered.map((entry, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs whitespace-nowrap">
                      {formatDatetime(entry.datetime)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{entry.user}</span>
                        <span className="text-xs text-gray-400">{entry.role === "admin" ? "Администратор" : "Аудитор"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${ACTION_COLORS[entry.action]}`}
                      >
                        {ACTION_ICONS[entry.action]}
                        {ACTION_LABELS[entry.action]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">
                      {formatDetails(entry.action, entry.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
