"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, MessageCircle } from "lucide-react";

interface TgRow {
  chat_id: string;
  tg_username: string | null;
  started_at: number;
  admin_email: string | null;
  admin_id: string | null;
  admin_name: string | null;
  status: "connected" | "awaiting_code" | "awaiting_email" | "email_not_found" | "started";
}

const STATUS_LABELS: Record<string, string> = {
  connected: "Подключён",
  awaiting_code: "Ожидает код",
  awaiting_email: "Ожидает email",
  email_not_found: "Email не найден",
  started: "Начал /start",
};

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-green-100 text-green-700",
  awaiting_code: "bg-yellow-100 text-yellow-700",
  awaiting_email: "bg-blue-100 text-blue-700",
  email_not_found: "bg-red-100 text-red-700",
  started: "bg-gray-100 text-gray-600",
};

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TelegramLogPage() {
  const [rows, setRows] = useState<TgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/telegram/log");
      if (res.status === 403) {
        setError("Доступ запрещён.");
        return;
      }
      const data = await res.json();
      setRows(data.rows || []);
    } catch {
      setError("Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const connected = rows.filter((r) => r.status === "connected").length;
  const pending = rows.filter((r) => r.status !== "connected").length;

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
            <h1 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-blue-600" />
              Telegram-уведомления
            </h1>
          </div>
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Обновить
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="flex gap-3 mb-4">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Подключено</span>
            <span className="text-lg font-bold text-green-600 tabular-nums">{connected}</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">В процессе</span>
            <span className="text-lg font-bold text-yellow-600 tabular-nums">{pending}</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Всего</span>
            <span className="text-lg font-bold text-gray-900 tabular-nums">{rows.length}</span>
          </div>
        </div>

        {loading && (
          <div className="text-center py-16">
            <div className="inline-block w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-3">Загрузка...</p>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Пользователь Telegram
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Рабочая почта
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Статус
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Дата
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-gray-400">
                      Пока никто не нажал /start
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.chat_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">
                          {row.tg_username ? `@${row.tg_username}` : `chat:${row.chat_id}`}
                        </span>
                        {row.tg_username && (
                          <span className="text-xs text-gray-400">ID: {row.chat_id}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.admin_email ? (
                        <div className="flex flex-col">
                          <span className="text-gray-900">{row.admin_email}</span>
                          {row.admin_name && (
                            <span className="text-xs text-gray-400">{row.admin_name}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {STATUS_LABELS[row.status] || row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap font-mono">
                      {fmtDate(row.started_at)}
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
