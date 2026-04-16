import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, authErrorResponse } from '@/lib/auth-server';

const BASE_URL = 'https://api.intercom.io';

function getHeaders() {
  const token = process.env.INTERCOM_TOKEN;
  if (!token) throw new Error('INTERCOM_TOKEN env var is required');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Intercom-Version': '2.11',
  };
}

const QuerySchema = z.object({
  action: z.enum(['admins', 'teams', 'conversations']),
  admin_id: z.string().regex(/^\d+$/).optional(),
  starting_after: z.string().max(256).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireUser();
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { action, admin_id, starting_after } = parsed.data;

  if (action === 'admins') {
    const res = await fetch(`${BASE_URL}/admins`, { headers: getHeaders() });
    return NextResponse.json(await res.json());
  }

  if (action === 'teams') {
    const res = await fetch(`${BASE_URL}/teams`, { headers: getHeaders() });
    return NextResponse.json(await res.json());
  }

  if (action === 'conversations') {
    if (!admin_id) {
      return NextResponse.json({ error: 'admin_id required' }, { status: 400 });
    }
    const body = {
      query: {
        operator: 'AND',
        value: [{ field: 'admin_assignee_id', operator: '=', value: admin_id }],
      },
      pagination: {
        per_page: 150,
        ...(starting_after ? { starting_after } : {}),
      },
    };
    const res = await fetch(`${BASE_URL}/conversations/search`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json());
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
