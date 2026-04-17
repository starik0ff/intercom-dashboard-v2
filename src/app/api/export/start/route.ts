import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { requireUser, authErrorResponse } from '@/lib/auth-server';
import { logActivity } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const format = body.format === 'json' ? 'json' : 'csv';
  const filters = body.filters || {};

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const db = getDb();
  db.prepare(
    `INSERT INTO export_jobs (id, created_at, status, format, filters, requested_by)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
  ).run(id, now, format, JSON.stringify(filters), user.username);

  logActivity(user.username, user.role, 'export_start', {
    job_id: id,
    format,
    filters,
  });

  return Response.json({ id, status: 'pending' });
}
