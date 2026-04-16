"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Search, ArrowRightLeft, CheckSquare, Square, Loader2, AlertTriangle, CheckCircle, SkipForward, XCircle, Users } from "lucide-react";
import Link from "next/link";

interface Admin {
  id: string;
  name: string;
  email: string;
  has_inbox_seat: boolean;
  team_ids: number[];
}

interface Team {
  id: string;
  name: string;
}

interface ConvItem {
  id: string;
  state: string;
  team_assignee_id: string | null;
  admin_assignee_id: string;
  source?: { body?: string; subject?: string; author?: { email?: string; type?: string }; delivered_as?: string; type?: string };
  created_at: number;
  updated_at: number;
  selected: boolean;
  isFacebook: boolean;
}

type Phase = "idle" | "scanning" | "ready" | "moving" | "done";

export default function MovePage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedAdmins, setSelectedAdmins] = useState<Set<string>>(new Set());
  const [selectedTeam, setSelectedTeam] = useState("");
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanProgress, setScanProgress] = useState({ page: 0, total: 0, currentAdmin: "" });
  const [moveProgress, setMoveProgress] = useState({ done: 0, total: 0, ok: 0, skipped: 0, errors: 0 });
  const [adminSearch, setAdminSearch] = useState("");
  const abortRef = useRef(false);

  // Load admins and teams
  useEffect(() => {
    Promise.all([
      fetch("/api/intercom?action=admins").then(r => r.json()),
      fetch("/api/intercom?action=teams").then(r => r.json()),
    ]).then(([adminsData, teamsData]) => {
      const filtered = (adminsData.admins || [])
        .filter((a: Admin) => a.has_inbox_seat)
        .sort((a: Admin, b: Admin) => a.name.localeCompare(b.name));
      setAdmins(filtered);
      setTeams(teamsData.teams || []);
    });
  }, []);

  // Auto-detect team when single admin selected
  useEffect(() => {
    if (selectedAdmins.size !== 1) return;
    const adminId = [...selectedAdmins][0];
    const admin = admins.find(a => a.id === adminId);
    if (!admin) return;
    const match = admin.name.match(/[Tt]eam[\s_']*([A-J])/i);
    if (match) {
      const letter = match[1].toUpperCase();
      const team = teams.find(t => t.name.includes(letter) && t.name.includes("Team"));
      if (team) setSelectedTeam(team.id);
    }
  }, [selectedAdmins, admins, teams]);

  const toggleAdmin = (id: string) => {
    setSelectedAdmins(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPhase("idle");
    setConversations([]);
  };

  const selectAllFiltered = () => {
    const ids = filteredAdmins.map(a => a.id);
    setSelectedAdmins(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      if (allSelected) {
        ids.forEach(id => next.delete(id));
      } else {
        ids.forEach(id => next.add(id));
      }
      return next;
    });
    setPhase("idle");
    setConversations([]);
  };

  const handleScan = useCallback(async () => {
    if (selectedAdmins.size === 0) return;
    setPhase("scanning");
    setConversations([]);
    abortRef.current = false;

    const all: ConvItem[] = [];
    const adminIds = [...selectedAdmins];

    for (const adminId of adminIds) {
      if (abortRef.current) break;
      const adminName = admins.find(a => a.id === adminId)?.name || adminId;
      let cursor: string | undefined;
      let page = 0;

      while (!abortRef.current) {
        page++;
        setScanProgress({ page, total: all.length, currentAdmin: adminName });

        const params = new URLSearchParams({ action: "conversations", admin_id: adminId });
        if (cursor) params.set("starting_after", cursor);

        const res = await fetch(`/api/intercom?${params}`);
        const data = await res.json();
        const convs = (data.conversations || []).map((c: Record<string, unknown>) => {
          const source = c.source as ConvItem["source"];
          const srcType = (source?.type || "").toLowerCase();
          const deliveredAs = (source?.delivered_as || "").toLowerCase();
          const isFacebook = srcType.includes("facebook") || deliveredAs.includes("facebook");
          return {
            id: c.id as string,
            state: c.state as string,
            team_assignee_id: c.team_assignee_id ? String(c.team_assignee_id) : null,
            admin_assignee_id: adminId,
            source,
            created_at: c.created_at as number,
            updated_at: c.updated_at as number,
            selected: isFacebook,
            isFacebook,
          };
        });

        all.push(...convs);
        setConversations([...all]);

        const nextCursor = (data.pages as Record<string, Record<string, string>> | undefined)?.next?.starting_after;
        if (!nextCursor) break;
        cursor = nextCursor;
      }
    }

    setPhase("ready");
  }, [selectedAdmins, admins]);

  const handleMove = useCallback(async () => {
    const toMove = conversations.filter(c => c.selected && c.team_assignee_id !== selectedTeam);
    if (!toMove.length || !selectedTeam) return;

    setPhase("moving");
    abortRef.current = false;
    const BATCH_SIZE = 10;
    let totalOk = 0, totalSkipped = 0, totalErrors = 0, totalDone = 0;

    // Group by admin for correct assignee
    const byAdmin = new Map<string, ConvItem[]>();
    for (const conv of toMove) {
      const list = byAdmin.get(conv.admin_assignee_id) || [];
      list.push(conv);
      byAdmin.set(conv.admin_assignee_id, list);
    }

    for (const [adminId, adminConvs] of byAdmin) {
      if (abortRef.current) break;

      for (let i = 0; i < adminConvs.length && !abortRef.current; i += BATCH_SIZE) {
        const batch = adminConvs.slice(i, i + BATCH_SIZE);
        const res = await fetch("/api/intercom/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationIds: batch.map(c => c.id),
            teamId: selectedTeam,
            adminId,
            teamOnly: true,
          }),
        });
        const data = await res.json();
        totalOk += data.summary.ok;
        totalSkipped += data.summary.skipped;
        totalErrors += data.summary.errors;
        totalDone += batch.length;

        const resultMap = new Map(data.results.map((r: { id: string; status: string }) => [r.id, r.status]));
        setConversations(prev => prev.map(c => {
          const status = resultMap.get(c.id);
          if (status === "ok") return { ...c, team_assignee_id: selectedTeam };
          return c;
        }));

        setMoveProgress({ done: totalDone, total: toMove.length, ok: totalOk, skipped: totalSkipped, errors: totalErrors });
      }
    }

    setPhase("done");
  }, [conversations, selectedTeam]);

  const handleStop = () => { abortRef.current = true; };

  const toggleAll = (value: boolean) => {
    setConversations(prev => prev.map(c => ({ ...c, selected: value })));
  };

  const toggleOne = (id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, selected: !c.selected } : c));
  };

  const selectedCount = conversations.filter(c => c.selected && c.team_assignee_id !== selectedTeam).length;
  const alreadyInTeam = conversations.filter(c => c.team_assignee_id === selectedTeam).length;
  const fbCount = conversations.filter(c => c.isFacebook).length;
  const nonFbCount = conversations.length - fbCount;
  const teamName = teams.find(t => t.id === selectedTeam)?.name || "";

  const filteredAdmins = adminSearch
    ? admins.filter(a => a.name.toLowerCase().includes(adminSearch.toLowerCase()) || a.email.toLowerCase().includes(adminSearch.toLowerCase()))
    : admins;

  const selectedAdminNames = admins
    .filter(a => selectedAdmins.has(a.id))
    .map(a => a.name);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            <ArrowLeft size={20} />
          </Link>
          <ArrowRightLeft size={20} className="text-blue-600" />
          <h1 className="text-lg font-semibold">Массовый перенос диалогов</h1>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Controls */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Admin multi-select */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Менеджеры
                {selectedAdmins.size > 0 && (
                  <span className="ml-2 text-blue-600 font-normal">({selectedAdmins.size} выбрано)</span>
                )}
              </label>
              <input
                type="text"
                placeholder="Поиск менеджера..."
                value={adminSearch}
                onChange={e => setAdminSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                {/* Select all filtered */}
                <button
                  onClick={selectAllFiltered}
                  className="w-full px-3 py-1.5 text-left text-xs text-blue-600 hover:bg-blue-50 border-b border-gray-200 flex items-center gap-2"
                >
                  {filteredAdmins.length > 0 && filteredAdmins.every(a => selectedAdmins.has(a.id))
                    ? <CheckSquare size={14} />
                    : <Square size={14} />
                  }
                  Выбрать всех {adminSearch ? "найденных" : ""} ({filteredAdmins.length})
                </button>
                <div className="max-h-48 overflow-y-auto">
                  {filteredAdmins.map(a => (
                    <button
                      key={a.id}
                      onClick={() => toggleAdmin(a.id)}
                      className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                        selectedAdmins.has(a.id) ? "bg-blue-50" : ""
                      }`}
                    >
                      {selectedAdmins.has(a.id)
                        ? <CheckSquare size={14} className="text-blue-600 flex-shrink-0" />
                        : <Square size={14} className="text-gray-400 flex-shrink-0" />
                      }
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Team select */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Целевая команда</label>
              <select
                value={selectedTeam}
                onChange={e => setSelectedTeam(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="">-- Выберите команду --</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{decodeHtml(t.name)}</option>
                ))}
              </select>

              {/* Selected admins summary */}
              {selectedAdmins.size > 0 && selectedTeam && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Users size={14} />
                    {selectedAdminNames.length} менеджеров &rarr; {decodeHtml(teamName)}
                  </div>
                  <div className="text-xs text-gray-500 max-h-24 overflow-y-auto space-y-0.5">
                    {selectedAdminNames.map(name => (
                      <div key={name}>{name}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleScan}
              disabled={selectedAdmins.size === 0 || phase === "scanning" || phase === "moving"}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {phase === "scanning" ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {phase === "scanning"
                ? `${scanProgress.currentAdmin}: стр. ${scanProgress.page}, найдено ${scanProgress.total}`
                : `Сканировать (${selectedAdmins.size} менедж.)`
              }
            </button>

            {phase === "ready" && selectedTeam && selectedCount > 0 && (
              <button
                onClick={handleMove}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
              >
                <ArrowRightLeft size={16} />
                Перенести ({selectedCount})
              </button>
            )}

            {(phase === "scanning" || phase === "moving") && (
              <button
                onClick={handleStop}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium"
              >
                Остановить
              </button>
            )}
          </div>
        </div>

        {/* Moving progress */}
        {(phase === "moving" || phase === "done") && (
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              {phase === "moving" ? (
                <Loader2 size={18} className="animate-spin text-blue-600" />
              ) : (
                <CheckCircle size={18} className="text-green-600" />
              )}
              <span className="font-medium">
                {phase === "moving" ? "Перенос..." : "Перенос завершён"}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${moveProgress.total ? (moveProgress.done / moveProgress.total) * 100 : 0}%` }}
              />
            </div>

            <div className="flex gap-4 text-sm">
              <span className="text-gray-600">{moveProgress.done} / {moveProgress.total}</span>
              <span className="inline-flex items-center gap-1 text-green-700">
                <CheckCircle size={14} /> {moveProgress.ok}
              </span>
              <span className="inline-flex items-center gap-1 text-yellow-700">
                <SkipForward size={14} /> {moveProgress.skipped} (FB)
              </span>
              {moveProgress.errors > 0 && (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <XCircle size={14} /> {moveProgress.errors}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Conversations list */}
        {conversations.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200">
            {/* List header */}
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleAll(!conversations.every(c => c.selected))}
                  className="text-gray-500 hover:text-gray-700"
                  title="Выделить все / снять"
                >
                  {conversations.every(c => c.selected) ? <CheckSquare size={18} /> : <Square size={18} />}
                </button>
                <span className="text-sm text-gray-600">
                  Всего: <span className="font-semibold">{conversations.length}</span>
                  {" | "}FB: <span className="font-semibold text-indigo-700">{fbCount}</span>
                  {" | "}Другие: <span className="font-semibold">{nonFbCount}</span>
                  {" | "}К переносу: <span className="font-semibold text-blue-700">{selectedCount}</span>
                  {alreadyInTeam > 0 && (
                    <>{" | "}Уже в команде: <span className="font-semibold text-green-700">{alreadyInTeam}</span></>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setConversations(prev =>
                    [...prev.map(c => ({ ...c, selected: c.isFacebook }))]
                      .sort((a, b) => (b.isFacebook ? 1 : 0) - (a.isFacebook ? 1 : 0))
                  )}
                  className="px-2 py-1 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                >
                  Только FB
                </button>
                <button
                  onClick={() => setConversations(prev => [...prev.map(c => ({ ...c, selected: true }))])}
                  className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  Все
                </button>
                <button
                  onClick={() => setConversations(prev => [...prev.map(c => ({ ...c, selected: false }))])}
                  className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  Снять
                </button>
              </div>
            </div>

            {/* Scrollable list */}
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100">
              {conversations.map(conv => {
                const isInTeam = conv.team_assignee_id === selectedTeam;
                const preview = conv.source?.body
                  ? stripHtml(conv.source.body).slice(0, 100)
                  : "Нет превью";
                const email = conv.source?.author?.email || "";
                const date = new Date(conv.updated_at * 1000).toLocaleDateString("ru-RU", {
                  day: "2-digit", month: "2-digit", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                });
                const ownerName = admins.find(a => a.id === conv.admin_assignee_id)?.name || "";

                return (
                  <div
                    key={conv.id}
                    className={`px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors ${isInTeam ? "opacity-50" : ""}`}
                  >
                    <button
                      onClick={() => !isInTeam && toggleOne(conv.id)}
                      className={`mt-0.5 flex-shrink-0 ${isInTeam ? "text-green-500" : "text-gray-400 hover:text-gray-600"}`}
                      disabled={isInTeam}
                    >
                      {isInTeam ? (
                        <CheckCircle size={18} />
                      ) : conv.selected ? (
                        <CheckSquare size={18} className="text-blue-600" />
                      ) : (
                        <Square size={18} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-gray-400">{conv.id}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          conv.state === "open" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        }`}>
                          {conv.state}
                        </span>
                        {conv.isFacebook && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">FB</span>
                        )}
                        {selectedAdmins.size > 1 && ownerName && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 truncate max-w-[200px]">
                            {ownerName}
                          </span>
                        )}
                        {isInTeam && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                            уже в команде
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 truncate mt-0.5">{preview}</p>
                      <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                        {email && <span>{email}</span>}
                        <span>{date}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {phase === "idle" && conversations.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <ArrowRightLeft size={48} className="mx-auto mb-3 opacity-50" />
            <p>Выберите менеджеров и нажмите &laquo;Сканировать&raquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").trim();
}

function decodeHtml(text: string): string {
  return text.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
