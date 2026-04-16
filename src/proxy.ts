import { NextRequest, NextResponse } from "next/server";

// Edge runtime: cannot import the Node-only auth.ts. We re-implement just the
// HMAC verification here. SESSION_SECRET is required at process boot.
const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 16) {
  throw new Error("SESSION_SECRET env var is required and must be ≥16 chars");
}
const encoder = new TextEncoder();

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
    return NextResponse.next();
  }

  const token = req.cookies.get("session")?.value;

  if (!token || !(await verifyTokenEdge(token))) {
    // API requests → 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Page requests → redirect to login
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
