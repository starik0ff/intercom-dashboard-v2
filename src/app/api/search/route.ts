import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { buildConversationsWhere } from '@/lib/filters/sql';
import { withAuth, parseFilters } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface FtsHit {
  rowid: number;
  rank: number;
  snippet: string;
}
interface MsgRow {
  rowid: number;
  conversation_id: string;
}
interface ConvRow {
  id: string;
  created_at: number;
  updated_at: number;
  contact_name: string | null;
  contact_email: string | null;
  source_bucket: string;
  status_bucket: string;
  admin_assignee_id: string | null;
  admin_name: string | null;
}

// SQLite FTS5 restriction: bm25() / snippet() can only be used in queries
// whose FROM clause is the FTS table directly (no joins, no subqueries).
// We work around it by running the FTS query stand-alone and then joining
// rowids back to messages/conversations from JS.
const FTS_HIT_LIMIT = 2000;

function buildFtsMatch(q: string): string | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/["()*:^]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export async function GET(req: NextRequest) {
  return (await withAuth(async () => {
    const sp = req.nextUrl.searchParams;
    const qRaw = sp.get('q') || '';
    const adminId = sp.get('admin_id') || '';
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(sp.get('page_size') || '25', 10) || 25),
    );

    const filters = parseFilters(req);
    const frag = buildConversationsWhere(filters, { alias: 'c' });
    const db = getDb();

    const match = buildFtsMatch(qRaw);
    if (!match) {
      return Response.json({
        items: [],
        total: 0,
        page,
        page_size: pageSize,
        query: qRaw,
        match: null,
      });
    }

    // ── stage 1: pure FTS query ─────────────────────────────────────────────
    const ftsHits = db
      .prepare(
        `SELECT rowid,
                bm25(messages_fts) AS rank,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', 14) AS snippet
           FROM messages_fts
          WHERE body MATCH ?
          ORDER BY rank ASC
          LIMIT ?`,
      )
      .all(match, FTS_HIT_LIMIT) as FtsHit[];

    if (ftsHits.length === 0) {
      return Response.json({
        items: [],
        total: 0,
        page,
        page_size: pageSize,
        query: qRaw,
        match,
      });
    }

    // ── stage 2: map rowids → conversation_ids ─────────────────────────────
    const rowids = ftsHits.map((h) => h.rowid);
    const placeholders = rowids.map(() => '?').join(',');
    const msgRows = db
      .prepare(`SELECT rowid, conversation_id FROM messages WHERE rowid IN (${placeholders})`)
      .all(...rowids) as MsgRow[];
    const rowidToConv = new Map<number, string>();
    for (const r of msgRows) rowidToConv.set(r.rowid, r.conversation_id);

    // ── stage 3: collapse hits to one-per-conversation, preserving rank order
    const seen = new Map<string, { rank: number; snippet: string; matches: number }>();
    for (const h of ftsHits) {
      const cid = rowidToConv.get(h.rowid);
      if (!cid) continue;
      const prev = seen.get(cid);
      if (!prev) {
        seen.set(cid, { rank: h.rank, snippet: h.snippet, matches: 1 });
      } else {
        prev.matches += 1;
      }
    }

    const candidateIds = Array.from(seen.keys());
    if (candidateIds.length === 0) {
      return Response.json({
        items: [],
        total: 0,
        page,
        page_size: pageSize,
        query: qRaw,
        match,
      });
    }

    // ── stage 4: filter candidate convs by global filters ───────────────────
    const cidPlaceholders = candidateIds.map(() => '?').join(',');
    const extraConds: string[] = [`c.id IN (${cidPlaceholders})`];
    const extraParams: unknown[] = [...candidateIds];
    if (adminId) {
      extraConds.push('c.admin_assignee_id = ?');
      extraParams.push(adminId);
    }

    const allConds = [frag.where, extraConds.join(' AND ')]
      .filter(Boolean)
      .join(' AND ');

    const filteredConvs = db
      .prepare(
        `SELECT c.id              AS id,
                c.created_at      AS created_at,
                c.updated_at      AS updated_at,
                c.contact_name    AS contact_name,
                c.contact_email   AS contact_email,
                c.source_bucket   AS source_bucket,
                c.status_bucket   AS status_bucket,
                c.admin_assignee_id AS admin_assignee_id,
                a.name            AS admin_name
           FROM conversations c
           LEFT JOIN admins a ON a.id = c.admin_assignee_id
          WHERE ${allConds}`,
      )
      .all(...frag.params, ...extraParams) as ConvRow[];

    // Re-order filtered convs by FTS rank.
    const filteredMap = new Map<string, ConvRow>();
    for (const c of filteredConvs) filteredMap.set(c.id, c);

    const ranked = candidateIds
      .filter((id) => filteredMap.has(id))
      .map((id) => {
        const meta = seen.get(id)!;
        const conv = filteredMap.get(id)!;
        return { conv, ...meta };
      })
      .sort((a, b) => a.rank - b.rank);

    const total = ranked.length;
    const offset = (page - 1) * pageSize;
    const pageRows = ranked.slice(offset, offset + pageSize);

    const items = pageRows.map((r) => ({
      conversation_id: r.conv.id,
      created_at: r.conv.created_at,
      updated_at: r.conv.updated_at,
      contact_name: r.conv.contact_name,
      contact_email: r.conv.contact_email,
      source_bucket: r.conv.source_bucket,
      status_bucket: r.conv.status_bucket,
      admin_assignee_id: r.conv.admin_assignee_id,
      admin_name: r.conv.admin_name,
      snippet: r.snippet,
      match_count: r.matches,
    }));

    return Response.json({
      items,
      total,
      page,
      page_size: pageSize,
      query: qRaw,
      match,
      truncated: ftsHits.length === FTS_HIT_LIMIT,
    });
  })) as Response;
}
