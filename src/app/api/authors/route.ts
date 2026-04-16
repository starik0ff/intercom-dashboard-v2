import { NextRequest } from "next/server";
import { loadAuthorIndex } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const index = await loadAuthorIndex();
  const authors = Object.keys(index);

  const all = request.nextUrl.searchParams.get("all") === "1";
  const limit = all ? Infinity : 30;

  if (!query.trim()) {
    const sorted = authors
      .map((a) => ({ name: a, count: index[a].length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    return Response.json(sorted);
  }

  const q = query.toLowerCase();
  const filtered = authors
    .filter((a) => a.toLowerCase().includes(q))
    .map((a) => ({ name: a, count: index[a].length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return Response.json(filtered);
}
