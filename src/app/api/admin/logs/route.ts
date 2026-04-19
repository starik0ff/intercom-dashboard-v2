import { NextRequest } from "next/server";
import { requireRole, authErrorResponse } from "@/lib/auth-server";
import { readLogs } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam), 2000) : 500;

  const logs = readLogs(limit);
  return Response.json({ logs });
}
