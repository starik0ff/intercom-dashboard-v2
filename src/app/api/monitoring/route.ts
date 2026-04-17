import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const filter = searchParams.get("filter");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const pageSize = 100;

  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = nowSec - 7 * 24 * 60 * 60;
  const oneHourMs = 60 * 60 * 1000;

  // ---------- filter: inWork (conversations updated in last 7 days) ----------
  if (filter === "inWork") {
    const rows = db.prepare(`
      SELECT c.id, c.updated_at,
             c.parts_count AS messageCount,
             COALESCE(m.author_type, '') AS lastAuthor,
             COALESCE(SUBSTR(m.body, 1, 120), '') AS preview
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
        AND m.created_at = (SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.conversation_id = c.id AND m2.part_type = 'comment')
      WHERE c.updated_at > ?
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(sevenDaysAgo, pageSize, (page - 1) * pageSize) as Array<{
      id: string; updated_at: number; messageCount: number; lastAuthor: string; preview: string;
    }>;
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE updated_at > ?`).get(sevenDaysAgo) as { n: number }).n;
    return Response.json({
      list: rows.map(r => ({
        id: r.id,
        updated_at: new Date(r.updated_at * 1000).toISOString(),
        messageCount: r.messageCount,
        lastAuthor: r.lastAuthor,
        preview: r.preview,
      })),
      total,
      page,
      pageSize,
    });
  }

  // ---------- Unanswered: last message is from user/lead/contact ----------
  // A conversation is "unanswered" if the newest comment was by a non-admin.
  const unansweredQuery = `
    SELECT c.id,
           lm.created_at AS last_msg_at,
           COALESCE(lm.author_type, '') AS lastAuthor,
           COALESCE(lm.body, '') AS body
    FROM conversations c
    JOIN messages lm ON lm.conversation_id = c.id
      AND lm.created_at = (
        SELECT MAX(m2.created_at) FROM messages m2
        WHERE m2.conversation_id = c.id AND m2.part_type = 'comment'
      )
    WHERE c.updated_at > ?
      AND lm.author_type IN ('user', 'lead', 'contact')
    ORDER BY lm.created_at ASC
  `;

  if (filter === "unanswered" || filter === "waiting1h") {
    const allUnanswered = db.prepare(unansweredQuery).all(sevenDaysAgo) as Array<{
      id: string; last_msg_at: number; lastAuthor: string; body: string;
    }>;

    const items = allUnanswered.map(r => ({
      id: r.id,
      waitingMs: Date.now() - r.last_msg_at * 1000,
      lastAuthor: r.lastAuthor,
      lastDate: new Date(r.last_msg_at * 1000).toISOString(),
      preview: r.body.slice(0, 120),
    }));

    if (filter === "waiting1h") {
      const over1h = items.filter(i => i.waitingMs > oneHourMs);
      const list = over1h.slice((page - 1) * pageSize, page * pageSize);
      return Response.json({ list, total: over1h.length, page, pageSize });
    }

    const list = items.slice((page - 1) * pageSize, page * pageSize);
    return Response.json({ list, total: items.length, page, pageSize });
  }

  // ---------- filter: duplicates ----------
  if (filter === "duplicates") {
    const q = (searchParams.get("q") || "").toLowerCase().trim();

    // Find emails with conversations assigned to >1 different admin, active in last 7 days
    const dupRows = db.prepare(`
      SELECT c.contact_email AS email,
             c.id,
             c.updated_at,
             COALESCE(SUBSTR(lm.body, 1, 80), '') AS preview,
             COALESCE(a.name, 'Admin #' || c.admin_assignee_id) AS assignee,
             c.admin_assignee_id
      FROM conversations c
      LEFT JOIN messages lm ON lm.conversation_id = c.id
        AND lm.created_at = (SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.conversation_id = c.id AND m2.part_type = 'comment')
      LEFT JOIN admins a ON a.id = c.admin_assignee_id
      WHERE c.contact_email IS NOT NULL
        AND c.contact_email != ''
        AND c.admin_assignee_id IS NOT NULL
        AND c.updated_at > ?
        AND c.contact_email NOT IN (
          SELECT email FROM admins WHERE email IS NOT NULL
        )
      ORDER BY c.contact_email, c.updated_at DESC
    `).all(sevenDaysAgo) as Array<{
      email: string; id: string; updated_at: number; preview: string; assignee: string; admin_assignee_id: string;
    }>;

    // Group by email, keep only groups with >1 unique assignee
    const emailMap = new Map<string, typeof dupRows>();
    for (const row of dupRows) {
      if (!emailMap.has(row.email)) emailMap.set(row.email, []);
      emailMap.get(row.email)!.push(row);
    }

    let groups = [...emailMap.entries()]
      .map(([email, convs]) => {
        const uniqueAssignees = [...new Set(convs.map(c => c.assignee))];
        if (uniqueAssignees.length <= 1) return null;
        return {
          email,
          chatsCount: convs.length,
          managersCount: uniqueAssignees.length,
          managers: uniqueAssignees,
          conversations: convs.map(c => ({
            id: c.id,
            updated_at: new Date(c.updated_at * 1000).toISOString(),
            preview: c.preview,
            assignee: c.assignee,
          })),
        };
      })
      .filter(Boolean) as Array<NonNullable<ReturnType<typeof Object.create>>>;

    groups.sort((a: { managersCount: number; chatsCount: number }, b: { managersCount: number; chatsCount: number }) =>
      b.managersCount - a.managersCount || b.chatsCount - a.chatsCount
    );

    if (q) {
      groups = groups.filter((g: { email: string }) => g.email.toLowerCase().includes(q));
    }

    const list = groups.slice((page - 1) * pageSize, page * pageSize);
    return Response.json({ list, total: groups.length, page, pageSize });
  }

  // ---------- Summary (no filter) ----------
  const inWork = (db.prepare(
    `SELECT COUNT(*) AS n FROM conversations WHERE updated_at > ?`
  ).get(sevenDaysAgo) as { n: number }).n;

  const unansweredCount = (db.prepare(`
    SELECT COUNT(*) AS n
    FROM conversations c
    JOIN messages lm ON lm.conversation_id = c.id
      AND lm.created_at = (
        SELECT MAX(m2.created_at) FROM messages m2
        WHERE m2.conversation_id = c.id AND m2.part_type = 'comment'
      )
    WHERE c.updated_at > ?
      AND lm.author_type IN ('user', 'lead', 'contact')
  `).get(sevenDaysAgo) as { n: number }).n;

  const oneHourAgo = nowSec - 3600;
  const waitingOver1h = (db.prepare(`
    SELECT COUNT(*) AS n
    FROM conversations c
    JOIN messages lm ON lm.conversation_id = c.id
      AND lm.created_at = (
        SELECT MAX(m2.created_at) FROM messages m2
        WHERE m2.conversation_id = c.id AND m2.part_type = 'comment'
      )
    WHERE c.updated_at > ?
      AND lm.author_type IN ('user', 'lead', 'contact')
      AND lm.created_at < ?
  `).get(sevenDaysAgo, oneHourAgo) as { n: number }).n;

  // Average first response time (only conversations with a first response)
  const avgRow = db.prepare(`
    SELECT AVG(first_response_seconds) AS avg_frt
    FROM conversations
    WHERE updated_at > ? AND first_response_seconds IS NOT NULL AND first_response_seconds > 0
  `).get(sevenDaysAgo) as { avg_frt: number | null };
  const avgResponseMs = avgRow.avg_frt != null ? Math.round(avgRow.avg_frt * 1000) : null;

  // Duplicates count (same logic as above but just counting)
  const dupCountRows = db.prepare(`
    SELECT c.contact_email AS email, COUNT(DISTINCT c.admin_assignee_id) AS n_admins
    FROM conversations c
    WHERE c.contact_email IS NOT NULL
      AND c.contact_email != ''
      AND c.admin_assignee_id IS NOT NULL
      AND c.updated_at > ?
      AND c.contact_email NOT IN (SELECT email FROM admins WHERE email IS NOT NULL)
    GROUP BY c.contact_email
    HAVING n_admins > 1
  `).all(sevenDaysAgo) as Array<{ email: string; n_admins: number }>;
  const duplicatesCount = dupCountRows.length;

  return Response.json({
    inWork,
    unansweredCount,
    avgResponseMs,
    waitingOver1h,
    duplicatesCount,
    computedAt: new Date().toISOString(),
    period: new Date((nowSec - 7 * 24 * 60 * 60) * 1000).toISOString(),
  });
}
