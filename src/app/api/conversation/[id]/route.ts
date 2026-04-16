import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { withAuth } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface ConvRow {
  id: string;
  created_at: number;
  updated_at: number;
  state: string | null;
  open: number;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_external_id: string | null;
  team_assignee_id: string | null;
  admin_assignee_id: string | null;
  team_name: string | null;
  admin_name: string | null;
  admin_email: string | null;
  source_type: string | null;
  source_url: string | null;
  source_subject: string | null;
  source_bucket: string;
  status_bucket: string;
  status_source: string;
  parts_count: number;
  user_messages_count: number;
  admin_messages_count: number;
  first_admin_reply_at: number | null;
  first_response_seconds: number | null;
}

interface MessageRow {
  id: string;
  created_at: number;
  part_type: string | null;
  author_type: string | null;
  author_id: string | null;
  body: string | null;
  author_name: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return (await withAuth(async () => {
    const { id } = await params;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });

    const db = getDb();

    const conv = db
      .prepare(
        `SELECT c.id, c.created_at, c.updated_at, c.state, c.open,
                c.contact_id, c.contact_name, c.contact_email, c.contact_external_id,
                c.team_assignee_id, c.admin_assignee_id,
                t.name AS team_name,
                a.name AS admin_name, a.email AS admin_email,
                c.source_type, c.source_url, c.source_subject,
                c.source_bucket, c.status_bucket, c.status_source,
                c.parts_count, c.user_messages_count, c.admin_messages_count,
                c.first_admin_reply_at, c.first_response_seconds
           FROM conversations c
           LEFT JOIN admins a ON a.id = c.admin_assignee_id
           LEFT JOIN teams  t ON t.id = c.team_assignee_id
          WHERE c.id = ?`,
      )
      .get(id) as ConvRow | undefined;

    if (!conv) return Response.json({ error: 'not found' }, { status: 404 });

    const messages = db
      .prepare(
        `SELECT m.id, m.created_at, m.part_type, m.author_type, m.author_id, m.body,
                a.name AS author_name
           FROM messages m
           LEFT JOIN admins a ON a.id = m.author_id
          WHERE m.conversation_id = ?
          ORDER BY m.created_at ASC, m.id ASC`,
      )
      .all(id) as MessageRow[];

    // Manual override (if any).
    const override = db
      .prepare(
        `SELECT status_bucket, set_by, set_at, note
           FROM conversation_status_overrides
          WHERE conversation_id = ?`,
      )
      .get(id) as
      | { status_bucket: string; set_by: string; set_at: number; note: string | null }
      | undefined;

    return Response.json({
      conversation: conv,
      messages,
      override: override ?? null,
      intercom_url: `https://app.intercom.com/a/inbox/_/inbox/conversation/${id}`,
    });
  })) as Response;
}
