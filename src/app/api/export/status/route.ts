import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { requireUser, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const job = db.prepare(
    `SELECT id, status, total_rows, processed_rows, file_size,
            error_message, created_at, completed_at
       FROM export_jobs WHERE id = ?`,
  ).get(id) as Record<string, unknown> | undefined;

  if (!job) return Response.json({ error: 'not_found' }, { status: 404 });

  return Response.json(job);
}
