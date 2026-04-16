"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, User, X, FileText } from "lucide-react";

interface AuthorSuggestion {
  name: string;
  count: number;
}

interface SearchFormProps {
  onSearch: (params: {
    author: string;
    body: string;
    dateFrom: string;
    dateTo: string;
  }) => void;
  isLoading: boolean;
  dateFrom?: string;
  dateTo?: string;
  initialAuthor?: string;
  initialBody?: string;
}

export default function SearchForm({ onSearch, isLoading, dateFrom: externalDateFrom, dateTo: externalDateTo, initialAuthor = "", initialBody = "" }: SearchFormProps) {
  const [author, setAuthor] = useState(initialAuthor);
  const [body, setBody] = useState(initialBody);
  const [suggestions, setSuggestions] = useState<AuthorSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dateFrom = externalDateFrom || "";
  const dateTo = externalDateTo || "";

  const fetchSuggestions = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/authors?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSuggestions(data);
      setShowSuggestions(true);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (author.length >= 1) {
      debounceRef.current = setTimeout(() => fetchSuggestions(author), 200);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [author, fetchSuggestions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowSuggestions(false);
    onSearch({ author, body, dateFrom, dateTo });
  }

  function handleClear() {
    setAuthor("");
    setBody("");
    onSearch({ author: "", body: "", dateFrom: "", dateTo: "" });
  }

  const hasFilters = author || body;

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Author search */}
        <div className="relative" ref={suggestionsRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <User className="inline w-4 h-4 mr-1 -mt-0.5" />
            Автор (имя или email)
          </label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onFocus={() => author.length >= 1 && setShowSuggestions(true)}
            placeholder="Введите имя или email автора..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center"
                  onClick={() => {
                    setAuthor(s.name);
                    setShowSuggestions(false);
                  }}
                >
                  <span className="truncate mr-2">{s.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{s.count} диалогов</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body search */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <FileText className="inline w-4 h-4 mr-1 -mt-0.5" />
            Поиск по тексту сообщений
          </label>
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Введите текст для поиска..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Search className="w-4 h-4 mr-2" />
          {isLoading ? "Поиск..." : "Найти"}
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 mr-1" />
            Сбросить
          </button>
        )}
      </div>
    </form>
  );
}
