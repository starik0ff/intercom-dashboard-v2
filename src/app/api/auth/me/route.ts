import { getSessionUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  return Response.json({ user: user ?? null });
}
