"use client";

import { useEffect, useState, useMemo } from "react";
import { X, Search, Users, MessageSquare } from "lucide-react";

interface Author {
  name: string;
  count: number;
}

interface AuthorsModalProps {
  open: boolean;
  onClose: () => void;
  onSelectAuthor: (author: string) => void;
}

export default function AuthorsModal({ open, onClose, onSelectAuthor }: AuthorsModalProps) {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/authors?all=1")
      .then((r) => r.json())
      .then((data) => {
        setAuthors(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return authors;
    const q = filter.toLowerCase();
    return authors.filter((a) => a.name.toLowerCase().includes(q));
  }, [authors, filter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Все авторы</h2>
            <span className="text-sm text-gray-400">({authors.length})</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Фильтр по имени или email..."
              autoFocus
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500 mt-2">Загрузка...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p>Ничего не найдено</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((a) => (
                <button
                  key={a.name}
                  onClick={() => {
                    onSelectAuthor(a.name);
                    onClose();
                  }}
                  className="w-full text-left px-5 py-3 hover:bg-blue-50 transition-colors flex items-center justify-between group"
                >
                  <span className="text-sm text-gray-800 truncate mr-3 group-hover:text-blue-700">
                    {a.name}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-400 shrink-0 group-hover:text-blue-500">
                    <MessageSquare className="w-3.5 h-3.5" />
                    {a.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
