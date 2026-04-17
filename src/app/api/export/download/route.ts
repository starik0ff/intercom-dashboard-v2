import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
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
    'SELECT status, format, file_path, filters FROM export_jobs WHERE id = ?',
  ).get(id) as { status: string; format: string; file_path: string | null; filters: string } | undefined;

  if (!job) return Response.json({ error: 'not_found' }, { status: 404 });
  if (job.status !== 'done' || !job.file_path) {
    return Response.json({ error: 'not_ready' }, { status: 409 });
  }

  const filePath = path.resolve(process.cwd(), job.file_path);
  if (!fs.existsSync(filePath)) {
    return Response.json({ error: 'file_missing' }, { status: 410 });
  }

  const data = fs.readFileSync(filePath);
  const filters = JSON.parse(job.filters || '{}');
  const filename = `conversations_${filters.period || 'export'}_${id.slice(0, 8)}.${job.format}`;

  return new Response(data, {
    headers: {
      'Content-Type': job.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
