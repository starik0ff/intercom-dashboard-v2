import { NextRequest } from "next/server";
import { loadConversations, loadTeammateEmails, loadAdminIdNames } from "@/lib/data";

export const dynamic = "force-dynamic";

function isCustomer(author: string): boolean {
  return author.includes("@") || /^lead[_:]/.test(author) || /^user[_:]/.test(author);
}

function isManager(author: string): boolean {
  return !isCustomer(author) && author !== "unknown" && author.trim().length > 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const filter = searchParams.get("filter");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const pageSize = 100;

  const conversations = await loadConversations();
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const recent = conversations.filter(
    (c) => new Date(c.updated_at).getTime() > now - sevenDaysMs
  );

  if (filter === "inWork") {
    const sorted = [...recent].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    const list = sorted.slice((page - 1) * pageSize, page * pageSize).map((c) => {
      const lastMsg = c.messages[c.messages.length - 1];
      return {
        id: c.conversation_id,
        updated_at: c.updated_at,
        messageCount: c.messages.length,
        lastAuthor: lastMsg?.author || "",
        preview: lastMsg?.body?.slice(0, 120) || "",
      };
    });
    return Response.json({ list, total: recent.length, page, pageSize });
  }

  const unansweredItems: Array<{
    id: string;
    waitingMs: number;
    lastAuthor: string;
    lastDate: string;
    preview: string;
  }> = [];
  const responseTimes: number[] = [];

  for (const conv of recent) {
    const msgs = conv.messages;
    if (!msgs.length) continue;

    for (let i = 0; i < msgs.length - 1; i++) {
      if (isCustomer(msgs[i].author) && isManager(msgs[i + 1].author)) {
        const diff =
          new Date(msgs[i + 1].date).getTime() - new Date(msgs[i].date).getTime();
        if (diff > 0 && diff < sevenDaysMs) responseTimes.push(diff);
      }
    }

    const lastMsg = msgs[msgs.length - 1];
    if (isCustomer(lastMsg.author)) {
      unansweredItems.push({
        id: conv.conversation_id,
        waitingMs: now - new Date(lastMsg.date).getTime(),
        lastAuthor: lastMsg.author,
        lastDate: lastMsg.date,
        preview: lastMsg.body.slice(0, 120),
      });
    }
  }

  unansweredItems.sort((a, b) => b.waitingMs - a.waitingMs);

  if (filter === "unanswered") {
    const list = unansweredItems.slice((page - 1) * pageSize, page * pageSize);
    return Response.json({ list, total: unansweredItems.length, page, pageSize });
  }

  if (filter === "waiting1h") {
    const over1h = unansweredItems.filter((i) => i.waitingMs > 60 * 60 * 1000);
    const list = over1h.slice((page - 1) * pageSize, page * pageSize);
    return Response.json({ list, total: over1h.length, page, pageSize });
  }

  // Build duplicates: group recent conversations by customer email, keep groups with >1 conv
  const teammateEmails = loadTeammateEmails();
  const adminIdNames = loadAdminIdNames();
  function isTeammate(author: string): boolean {
    return author.endsWith("@intercom.io") || teammateEmails.has(author.toLowerCase());
  }

  type ConvEntry = { id: string; updated_at: string; preview: string; assignee: string };
  const emailMap = new Map<string, ConvEntry[]>();
  for (const conv of conversations) {
    // Customer = first non-bot, non-teammate author with email (initiator)
    let customerEmail: string | null = null;
    for (const msg of conv.messages) {
      const a = msg.author;
      if (a.endsWith("@intercom.io")) continue;
      if (!a.includes("@")) break;
      if (isTeammate(a)) continue;
      customerEmail = a;
      break;
    }
    if (!customerEmail) continue;

    // Only include conversations where customer wrote in the last 7 days
    let customerLastMsgTime = 0;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].author === customerEmail) {
        customerLastMsgTime = new Date(conv.messages[i].date).getTime();
        break;
      }
    }
    if (customerLastMsgTime < now - sevenDaysMs) continue;

    // Assignee from Intercom admin_assignee_id
    const assigneeId = conv.admin_assignee_id;
    if (!assigneeId) continue; // skip unassigned conversations
    const assignee = adminIdNames.get(assigneeId) || `Admin #${assigneeId}`;
    const lastMsg = conv.messages[conv.messages.length - 1];
    const preview = lastMsg?.body?.slice(0, 80) || "";
    if (!emailMap.has(customerEmail)) emailMap.set(customerEmail, []);
    emailMap.get(customerEmail)!.push({ id: conv.conversation_id, updated_at: conv.updated_at, preview, assignee });
  }

  // Duplicate = one customer email has conversations assigned to DIFFERENT managers
  const duplicateGroups = [...emailMap.entries()]
    .map(([email, convs]) => {
      const uniqueAssignees = [...new Set(convs.map((c) => c.assignee))];
      return { email, convs, uniqueAssignees };
    })
    .filter(({ uniqueAssignees }) => uniqueAssignees.length > 1) // >1 different assignee = duplicate
    .map(({ email, convs, uniqueAssignees }) => {
      const sorted = convs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      return {
        email,
        chatsCount: convs.length,
        managersCount: uniqueAssignees.length,
        managers: uniqueAssignees,
        conversations: sorted.map(({ id, updated_at, preview, assignee }) => ({ id, updated_at, preview, assignee })),
      };
    })
    .sort((a, b) => b.managersCount - a.managersCount || b.chatsCount - a.chatsCount);

  if (filter === "duplicates") {
    const q = (searchParams.get("q") || "").toLowerCase().trim();
    const filtered = q
      ? duplicateGroups.filter((g) => g.email.toLowerCase().includes(q))
      : duplicateGroups;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return Response.json({ list, total: filtered.length, page, pageSize });
  }

  const avgResponseMs =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

  return Response.json({
    inWork: recent.length,
    unansweredCount: unansweredItems.length,
    avgResponseMs,
    waitingOver1h: unansweredItems.filter((i) => i.waitingMs > 60 * 60 * 1000).length,
    duplicatesCount: duplicateGroups.length,
    computedAt: new Date().toISOString(),
    period: new Date(now - sevenDaysMs).toISOString(),
  });
}
