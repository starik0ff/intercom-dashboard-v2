import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { authenticate, createToken } from "@/lib/auth";
import { logActivity } from "@/lib/logger";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // 10 attempts/min sustained, burst 10 — per IP.
  const rl = rateLimit(`login:${ip}`, 10, 10 / 60);
  if (!rl.ok) return rateLimitResponse(rl);

  let parsed;
  try {
    parsed = LoginSchema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { username, password } = parsed.data;

  const session = authenticate(username, password);
  if (!session) {
    logActivity(username, "unknown", "login_failed", { ip });
    return Response.json(
      { error: "Неверный логин или пароль" },
      { status: 401 },
    );
  }

  const token = createToken(session.username, session.role);
  const isHttps = req.headers.get("x-forwarded-proto") === "https"
    || req.url.startsWith("https");
  const cookieStore = await cookies();
  cookieStore.set("session", token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });

  logActivity(session.username, session.role, "login", { ip });

  return Response.json({
    ok: true,
    user: session,
  });
}
