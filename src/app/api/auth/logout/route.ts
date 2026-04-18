import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { logActivity } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const session = token ? verifyToken(token) : null;

  if (session) {
    logActivity(session.username, session.role, "logout", {});
  }

  const isHttps = req.headers.get("x-forwarded-proto") === "https"
    || req.url.startsWith("https");
  cookieStore.set("session", "", {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
    maxAge: 0,
  });

  return Response.json({ ok: true });
}
