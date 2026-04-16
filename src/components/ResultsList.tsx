"use client";

import { MessageSquare, Clock, Users, Calendar, User, X, ArrowDownWideNarrow, ArrowUpNarrowWide, Download } from "lucide-react";
import type { SearchResult } from "@/lib/types";

interface ResultsListProps {
  results: SearchResult[];
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  bodyQuery: string;
  authorQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  onDateFilter?: (dateFrom: string, dateTo: string) => void;
  sort?: string;
  onSortChange?: (sort: string) => void;
  onClearAuthor?: () => void;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  let idx = lowerText.indexOf(lowerQuery, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(
      <mark key={idx} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

function truncateBody(body: string, maxLen: number = 200): string {
  // Strip image references for display
  const clean = body.replace(/\[Image "[^"]*"\]\s*/g, "[Изображение] ");
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + "...";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ResultsList({
  results,
  total,
  page,
  totalPages,
  onPageChange,
  bodyQuery,
  authorQuery = "",
  dateFrom = "",
  dateTo = "",
  onDateFilter,
  sort = "newest",
  onSortChange,
  onClearAuthor,
}: ResultsListProps) {
  if (results.length === 0) {
    return (
      <div>
        {onDateFilter && (
          <div className="flex items-center gap-3 mb-4 flex-wrap bg-white rounded-lg border border-gray-200 px-4 py-3">
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              Фильтр по дате:
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFilter(e.target.value, dateTo)}
              className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-gray-400">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateFilter(dateFrom, e.target.value)}
              className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => onDateFilter("", "")}
                className="text-xs text-gray-400 hover:text-gray-600 ml-1"
              >
                Сбросить
              </button>
            )}
          </div>
        )}
        <div className="text-center py-16 text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">Ничего не найдено</p>
          <p className="text-sm mt-1">Попробуйте изменить параметры поиска</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {onDateFilter && (
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-white rounded-lg border border-gray-200 px-4 py-3">
          <span className="text-sm text-gray-500 flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            Фильтр по дате:
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFilter(e.target.value, dateTo)}
            className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <span className="text-gray-400">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateFilter(dateFrom, e.target.value)}
            className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => onDateFilter("", "")}
              className="text-xs text-gray-400 hover:text-gray-600 ml-1"
            >
              Сбросить
            </button>
          )}
        </div>
      )}

      {authorQuery && (
        <div className="flex items-center gap-2 mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
          <User className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-sm text-blue-700">
            Фильтр по автору: <span className="font-semibold">{authorQuery}</span>
          </span>
          {onClearAuthor && (
            <button
              onClick={onClearAuthor}
              className="ml-auto p-0.5 hover:bg-blue-100 rounded transition-colors"
              title="Сбросить фильтр"
            >
              <X className="w-4 h-4 text-blue-400 hover:text-blue-600" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">
          Найдено: <span className="font-semibold text-gray-900">{total.toLocaleString("ru-RU")}</span> диалогов
        </p>
        <div className="flex items-center gap-3">
          {onSortChange && (
            <button
              onClick={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {sort === "newest" ? (
                <>
                  <ArrowDownWideNarrow className="w-4 h-4 text-gray-500" />
                  Сначала новые
                </>
              ) : (
                <>
                  <ArrowUpNarrowWide className="w-4 h-4 text-gray-500" />
                  Сначала старые
                </>
              )}
            </button>
          )}
          <a
            href={buildExportUrl({ authorQuery, bodyQuery, dateFrom, dateTo, sort, format: "csv" })}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4 text-gray-500" />
            CSV
          </a>
          <a
            href={buildExportUrl({ authorQuery, bodyQuery, dateFrom, dateTo, sort, format: "json" })}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4 text-gray-500" />
            JSON
          </a>
          {totalPages > 1 && (
            <p className="text-sm text-gray-500">
              Страница {page} из {totalPages}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {results.map((result) => (
          <a
            key={result.conversation_id}
            href={`/conversation/${result.conversation_id}${bodyQuery ? `?highlight=${encodeURIComponent(bodyQuery)}` : ""}`}
            onClick={() => sessionStorage.setItem("searchUrl", window.location.href)}
            className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDate(result.created_at)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {result.message_count} сообщ.
                </span>
              </div>
              <span className="text-xs font-mono text-gray-400 group-hover:text-blue-500 transition-colors">
                #{result.conversation_id.slice(-6)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              {result.authors.slice(0, 4).map((a) => (
                <span
                  key={a}
                  className="inline-block bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full"
                >
                  {a}
                </span>
              ))}
              {result.authors.length > 4 && (
                <span className="text-xs text-gray-400">
                  +{result.authors.length - 4}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {result.matches.map((match, i) => (
                <div
                  key={i}
                  className="text-sm text-gray-600 bg-gray-50 rounded px-3 py-2"
                >
                  <span className="text-xs font-medium text-gray-900">
                    {match.author}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">
                    {formatDate(match.date)}
                  </span>
                  <p className="mt-0.5 leading-relaxed">
                    {highlightText(truncateBody(match.body), bodyQuery)}
                  </p>
                </div>
              ))}
            </div>
          </a>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Назад
          </button>
          {generatePageNumbers(page, totalPages).map((p, i) =>
            p === "..." ? (
              <span key={`dots-${i}`} className="px-2 text-gray-400">...</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p as number)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  p === page
                    ? "bg-blue-600 text-white"
                    : "border border-gray-300 hover:bg-gray-50"
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Вперед
          </button>
        </div>
      )}
    </div>
  );
}

function buildExportUrl({
  authorQuery,
  bodyQuery,
  dateFrom,
  dateTo,
  sort,
  format,
}: {
  authorQuery: string;
  bodyQuery: string;
  dateFrom: string;
  dateTo: string;
  sort: string;
  format: "csv" | "json";
}): string {
  const qs = new URLSearchParams();
  if (authorQuery) qs.set("author", authorQuery);
  if (bodyQuery) qs.set("body", bodyQuery);
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  qs.set("sort", sort);
  qs.set("format", format);
  return `/api/export?${qs.toString()}`;
}

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | string)[] = [1];

  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push("...");

  pages.push(total);
  return pages;
}
