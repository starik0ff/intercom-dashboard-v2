import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { readLogs } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const session = token ? verifyToken(token) : null;

  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam), 2000) : 500;

  const logs = readLogs(limit);
  return Response.json({ logs });
}
