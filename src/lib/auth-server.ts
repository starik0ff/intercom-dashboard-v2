// Server-side request guards. Use these in every API route that requires
// authentication or specific roles. Never trust client-supplied user info.

import { cookies } from "next/headers";
import { verifyToken, type SessionUser } from "./auth";

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get("session")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, "Unauthorized");
  return user;
}

export async function requireRole(
  role: SessionUser["role"],
): Promise<SessionUser> {
  const user = await requireUser();
  if (role === "admin" && user.role !== "admin") {
    throw new AuthError(403, "Forbidden");
  }
  return user;
}

export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
