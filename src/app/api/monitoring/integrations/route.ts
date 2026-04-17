import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();

  const rows = db.prepare(`
    SELECT channel, label, total_open, last_1h, last_24h,
           last_message_at, last_conv_id, status, updated_at
    FROM channel_status_cache
    ORDER BY channel
  `).all() as Array<{
    channel: string;
    label: string;
    total_open: number;
    last_1h: number;
    last_24h: number;
    last_message_at: string | null;
    last_conv_id: string | null;
    status: string;
    updated_at: number;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({
      channels: [],
      checkedAt: null,
      stale: true,
      message: "Кеш ещё не заполнен. Данные появятся после следующего цикла воркера (~15 мин).",
    });
  }

  const oldestUpdate = Math.min(...rows.map(r => r.updated_at));
  const ageMinutes = (Date.now() / 1000 - oldestUpdate) / 60;

  return NextResponse.json({
    channels: rows.map(r => ({
      channel: r.channel,
      label: r.label,
      totalOpen: r.total_open,
      last1h: r.last_1h,
      last24h: r.last_24h,
      lastMessageAt: r.last_message_at,
      lastConvId: r.last_conv_id,
      status: r.status,
    })),
    checkedAt: new Date(oldestUpdate * 1000).toISOString(),
    stale: ageMinutes > 30,
  });
}
