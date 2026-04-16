import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, authErrorResponse } from '@/lib/auth-server';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

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

const AssignSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1).max(500),
  teamId: z.string().min(1),
  adminId: z.string().min(1),
  closedIds: z.array(z.string().min(1)).optional(),
  teamOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireRole('admin');
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }

  // 5 batches/min per admin user.
  const rl = rateLimit(`assign:${user.username}`, 5, 5 / 60);
  if (!rl.ok) return rateLimitResponse(rl);

  let parsed;
  try {
    parsed = AssignSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { conversationIds, teamId, adminId, closedIds, teamOnly } = parsed.data;
  const closedSet = new Set(closedIds || []);

  const results: { id: string; status: 'ok' | 'skipped' | 'error'; error?: string }[] = [];

  for (const convId of conversationIds) {
    try {
      // 1. Assign to team
      const r1 = await fetch(`${BASE_URL}/conversations/${convId}/parts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          message_type: 'assignment',
          type: 'team',
          assignee_id: teamId,
          admin_id: adminId,
          body: '',
        }),
      });

      if (!r1.ok) {
        const err = await r1.json();
        const msg = err.errors?.[0]?.message || r1.statusText;
        if (msg.includes('facebook') || msg.includes('action_forbidden')) {
          results.push({ id: convId, status: 'skipped', error: 'Facebook 24h limit' });
          continue;
        }
        results.push({ id: convId, status: 'error', error: msg });
        continue;
      }

      if (teamOnly) {
        results.push({ id: convId, status: 'ok' });
      } else {
        // 2. Re-assign admin back
        await new Promise(r => setTimeout(r, 100));
        const r2 = await fetch(`${BASE_URL}/conversations/${convId}/parts`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            message_type: 'assignment',
            type: 'admin',
            assignee_id: adminId,
            admin_id: adminId,
            body: '',
          }),
        });

        if (!r2.ok) {
          results.push({ id: convId, status: 'ok', error: 'Team assigned but admin reassign failed' });
        } else {
          // 3. Re-close if was closed
          if (closedSet.has(convId)) {
            await new Promise(r => setTimeout(r, 100));
            await fetch(`${BASE_URL}/conversations/${convId}/parts`, {
              method: 'POST',
              headers: getHeaders(),
              body: JSON.stringify({
                message_type: 'close',
                type: 'admin',
                admin_id: adminId,
                body: '',
              }),
            });
          }
          results.push({ id: convId, status: 'ok' });
        }
      }
    } catch (err) {
      results.push({ id: convId, status: 'error', error: String(err) });
    }

    await new Promise(r => setTimeout(r, 150));
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;

  return NextResponse.json({ results, summary: { ok, skipped, errors, total: conversationIds.length } });
}
