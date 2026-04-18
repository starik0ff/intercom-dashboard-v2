import { NextRequest, NextResponse } from "next/server";

// Edge runtime: cannot import the Node-only auth.ts. We re-implement just the
// HMAC verification here. SESSION_SECRET is required at process boot.
const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 16) {
  throw new Error("SESSION_SECRET env var is required and must be ≥16 chars");
}
const encoder = new TextEncoder();

// --- CORS for cross-origin CRM frontend ---
const ALLOWED_ORIGINS = new Set([
  "https://sales.atomgroup.dev",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type,Accept,X-Requested-With,X-CSRF-Token",
    "Access-Control-Expose-Headers": "Content-Type,Set-Cookie",
    Vary: "Origin",
  };
}

function applyCors(
  res: NextResponse,
  origin: string | null,
): NextResponse {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      res.headers.set(k, v);
    }
  }
  return res;
}

async function verifyTokenEdge(token: string): Promise<boolean> {
  try {
    const lastDot = token.lastIndexOf(".");
    if (lastDot === -1) return false;

    const payload = token.slice(0, lastDot);
    const sig = token.slice(lastDot + 1);

    const parts = payload.split(":");
    if (parts.length !== 3) return false;
    if (Date.now() > parseInt(parts[2])) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // base64url → bytes
    const padded = sig.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const sigBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

    return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payload));
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin");

  // CORS preflight for API routes
  if (req.method === "OPTIONS" && pathname.startsWith("/api/") && origin && ALLOWED_ORIGINS.has(origin)) {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  // Allow public paths
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api" ||
    pathname === "/api/openapi.json" ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon")
  ) {
    return applyCors(NextResponse.next(), origin);
  }

  const token = req.cookies.get("session")?.value;

  if (!token || !(await verifyTokenEdge(token))) {
    // API requests → 401
    if (pathname.startsWith("/api/")) {
      return applyCors(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        origin,
      );
    }
    // Page requests → redirect to login
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return applyCors(NextResponse.next(), origin);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
