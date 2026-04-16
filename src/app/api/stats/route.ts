import { loadConversations, loadAuthorIndex } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await loadConversations();
  const authorIndex = await loadAuthorIndex();

  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  for (const conv of conversations) {
    const d = conv.created_at.slice(0, 10);
    if (d < minDate) minDate = d;
    if (d > maxDate) maxDate = d;
  }

  return Response.json({
    totalConversations: conversations.length,
    totalAuthors: Object.keys(authorIndex).length,
    dateRange: { min: minDate, max: maxDate },
  });
}
