'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_BUCKETS,
  type SourceBucket,
  type StatusBucket,
} from '@/lib/filters/types';

interface Conv {
  id: string;
  created_at: number;
  updated_at: number;
  state: string | null;
  open: number;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  team_assignee_id: string | null;
  team_name: string | null;
  admin_assignee_id: string | null;
  admin_name: string | null;
  admin_email: string | null;
  source_type: string | null;
  source_url: string | null;
  source_subject: string | null;
  source_bucket: string;
  status_bucket: string;
  status_source: string;
  parts_count: number;
  user_messages_count: number;
  admin_messages_count: number;
  first_admin_reply_at: number | null;
  first_response_seconds: number | null;
}

interface Msg {
  id: string;
  created_at: number;
  part_type: string | null;
  author_type: string | null;
  author_id: string | null;
  body: string | null;
  author_name: string | null;
}

interface Resp {
  conversation: Conv;
  messages: Msg[];
  override: { status_bucket: string; set_by: string; set_at: number; note: string | null } | null;
  intercom_url: string;
}

function fmtDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtSeconds(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}с`;
  if (s < 3600) return `${Math.round(s / 60)}м`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}ч`;
  return `${(s / 86400).toFixed(1)}д`;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
        {p}
      </mark>
    ) : (
      p
    ),
  );
}

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Загрузка…</div>}>
      <Inner id={id} />
    </Suspense>
  );
}

function Inner({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const q = sp.get('q') || '';
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRole(j?.user?.role ?? null))
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/conversation/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, reloadTick]);

  if (loading) return <div className="p-6 text-sm text-gray-400">Загрузка…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Ошибка: {error}</div>;
  if (!data) return null;

  const { conversation: c, messages, override, intercom_url } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              ← Назад
            </button>
            <span className="text-gray-300">|</span>
            <span className="text-sm font-mono text-gray-500">ID: {c.id}</span>
          </div>
          <a
            href={intercom_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            Открыть в Intercom →
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Metadata card */}
        <div className="bg-white border border-gray-200 rounded p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Field label="Создан" value={fmtDateTime(c.created_at)} />
            <Field label="Обновлён" value={fmtDateTime(c.updated_at)} />
            <Field
              label="Состояние"
              value={c.open ? 'Открыт' : 'Закрыт'}
              tone={c.open ? 'good' : 'muted'}
            />
            <Field
              label="Источник"
              value={SOURCE_LABELS[c.source_bucket as SourceBucket] || c.source_bucket}
            />
            <Field
              label="Статус"
              value={STATUS_LABELS[c.status_bucket as StatusBucket] || c.status_bucket}
              tone={c.status_bucket === 'no_reply' ? 'warn' : undefined}
            />
            <Field label="Менеджер" value={c.admin_name || '—'} />
            <Field label="Команда" value={c.team_name || '—'} />
            <Field label="Сообщений" value={`${c.user_messages_count}/${c.admin_messages_count}`} />
            <Field label="Контакт" value={c.contact_name || c.contact_email || '—'} />
            <Field label="Email" value={c.contact_email || '—'} />
            <Field label="FRT" value={fmtSeconds(c.first_response_seconds)} />
            <Field
              label="Источник статуса"
              value={c.status_source === 'manual' ? 'ручной' : 'эвристика'}
              tone={c.status_source === 'manual' ? 'good' : 'muted'}
            />
          </div>
          {override && (
            <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900">
              Ручной статус «{STATUS_LABELS[override.status_bucket as StatusBucket]}» установлен
              <span className="font-medium"> {override.set_by}</span> ·
              {' '}
              {fmtDateTime(override.set_at)}
              {override.note && <span className="block text-xs mt-1">{override.note}</span>}
            </div>
          )}
          {role === 'admin' && (
            <StatusOverrideEditor
              conversationId={c.id}
              currentStatus={c.status_bucket as StatusBucket}
              hasOverride={!!override}
              onChanged={() => setReloadTick((t) => t + 1)}
            />
          )}
          {c.source_url && (
            <div className="mt-3 text-xs text-gray-500 break-all">
              URL: <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{c.source_url}</a>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="space-y-2">
          {messages.length === 0 && (
            <div className="text-sm text-gray-400 py-8 text-center">Сообщений нет</div>
          )}
          {messages.map((m) => {
            const isAdmin = m.author_type === 'admin';
            const isSystem = m.part_type === 'assignment' || m.part_type === 'note';
            return (
              <div
                key={m.id}
                className={`rounded p-3 border ${
                  isSystem
                    ? 'bg-gray-50 border-gray-200 text-xs text-gray-500'
                    : isAdmin
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700">
                    {isSystem
                      ? `[${m.part_type}]`
                      : isAdmin
                      ? m.author_name || `admin ${m.author_id || ''}`
                      : m.author_type || 'user'}
                  </span>
                  <span className="text-xs text-gray-400 tabular-nums">
                    {fmtDateTime(m.created_at)}
                  </span>
                </div>
                {m.body && (
                  <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                    {q ? highlight(m.body, q) : m.body}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-center pt-4">
          <Link href="/search" className="text-sm text-blue-600 hover:underline">
            ← К поиску
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatusOverrideEditor({
  conversationId,
  currentStatus,
  hasOverride,
  onChanged,
}: {
  conversationId: string;
  currentStatus: StatusBucket;
  hasOverride: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StatusBucket>(currentStatus);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setStatus(currentStatus);
  }, [currentStatus]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/conversation/${conversationId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status_bucket: status, note: note || null }),
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      setNote('');
      setOpen(false);
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm('Сбросить ручной статус и вернуть эвристику?')) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/conversation/${conversationId}/status`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      setOpen(false);
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50"
        >
          Изменить статус
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded text-orange-700 hover:bg-orange-50"
          >
            Сбросить к эвристике
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 border border-gray-200 rounded bg-gray-50">
      <div className="text-xs font-medium text-gray-700 mb-2">Ручной статус</div>
      <div className="flex flex-wrap items-start gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusBucket)}
          className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
        >
          {STATUS_BUCKETS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Примечание (опц.)"
          maxLength={500}
          className="flex-1 min-w-[200px] px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Сохранить'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-white"
        >
          Отмена
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'muted';
}) {
  const valColor =
    tone === 'good'
      ? 'text-green-700'
      : tone === 'warn'
      ? 'text-orange-700'
      : tone === 'muted'
      ? 'text-gray-500'
      : 'text-gray-900';
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-medium ${valColor}`}>{value}</div>
    </div>
  );
}
