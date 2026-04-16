"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Users, Calendar, RefreshCw } from "lucide-react";
import type { StatsData } from "@/lib/types";

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatSyncTime(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч. назад`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface SyncState {
  last_sync_date: string;
  last_run?: { found: number; added: number; updated: number; errors: number };
}

interface StatsBarProps {
  onShowAll?: () => void;
  onShowAuthors?: () => void;
  dateFrom?: string;
  dateTo?: string;
  onDateRange?: (dateFrom: string, dateTo: string) => void;
}

export default function StatsBar({ onShowAll, onShowAuthors, dateFrom = "", dateTo = "", onDateRange }: StatsBarProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
    fetch("/api/sync-status")
      .then((r) => r.json())
      .then(setSync)
      .catch(() => {});
  }, []);

  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-7 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <button
        onClick={onShowAll}
        className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group"
      >
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1 group-hover:text-blue-600 transition-colors">
          <MessageSquare className="w-4 h-4" />
          Всего диалогов
          <span className="ml-auto text-xs text-gray-400 group-hover:text-blue-500">Показать все →</span>
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {stats.totalConversations.toLocaleString("ru-RU")}
        </div>
      </button>
      <button
        onClick={onShowAuthors}
        className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group"
      >
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1 group-hover:text-blue-600 transition-colors">
          <Users className="w-4 h-4" />
          Уникальных авторов
          <span className="ml-auto text-xs text-gray-400 group-hover:text-blue-500">Показать все →</span>
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {stats.totalAuthors.toLocaleString("ru-RU")}
        </div>
      </button>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <Calendar className="w-4 h-4" />
          Период данных
          {sync?.last_sync_date && (
            <span className="ml-auto flex items-center gap-1 text-xs text-green-600">
              <RefreshCw className="w-3 h-3" />
              Синк: {formatSyncTime(sync.last_sync_date)}
              {sync.last_run && sync.last_run.added > 0 && (
                <span className="text-green-700 font-medium">+{sync.last_run.added}</span>
              )}
            </span>
          )}
          {!sync?.last_sync_date && (
            <span className="text-xs text-gray-400 ml-auto">
              {formatDateShort(stats.dateRange.min)} — {formatDateShort(stats.dateRange.max)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <input
            type="date"
            value={dateFrom}
            min={stats.dateRange.min}
            max={stats.dateRange.max}
            onChange={(e) => {
              onDateRange?.(e.target.value, dateTo);
            }}
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <span className="text-gray-400 text-sm">—</span>
          <input
            type="date"
            value={dateTo}
            min={stats.dateRange.min}
            max={stats.dateRange.max}
            onChange={(e) => {
              onDateRange?.(dateFrom, e.target.value);
            }}
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              onDateRange?.("", "");
            }}
            className="text-xs text-gray-400 hover:text-gray-600 mt-1.5"
          >
            Сбросить
          </button>
        )}
      </div>
    </div>
  );
}
