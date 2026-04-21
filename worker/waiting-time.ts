/**
 * Updates "Ожидание ответа" custom attribute on open Intercom conversations.
 * Only processes conversations with user activity in last 48h.
 * Uses parallel batches for speed.
 */

import type Database from 'better-sqlite3';

const BASE_URL = 'https://api.intercom.io';
const CONCURRENCY = 5; // parallel requests
const DELAY_BETWEEN_BATCHES_MS = 250;
const CUTOFF_HOURS = 48;

interface WaitingRow {
  id: string;
  last_user_message_at: number;
}

function getHeaders(): Record<string, string> {
  const token = process.env.INTERCOM_TOKEN;
  if (!token) throw new Error('INTERCOM_TOKEN env var is required');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Intercom-Version': '2.11',
  };
}

function formatWaiting(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const hrs = Math.floor(min / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}д ${hrs % 24}ч`;
  if (hrs > 0) return `${hrs}ч ${min % 60}м`;
  return `${min}м`;
}

async function updateConversation(convId: string, value: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/conversations/${convId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ custom_attributes: { 'Ожидание ответа': value } }),
      });
      if (res.status === 429) {
        const delay = parseInt(res.headers.get('retry-after') || '3', 10);
        await new Promise((r) => setTimeout(r, delay * 1000));
        continue;
      }
      return res.ok;
    } catch {
      return false;
    }
  }
  return false;
}

export async function refreshWaitingTimes(db: Database.Database): Promise<{
  updated: number;
  errors: number;
  total: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - CUTOFF_HOURS * 3600;

  const rows = db
    .prepare(
      `SELECT id, last_user_message_at
         FROM conversations
        WHERE state = 'open'
          AND last_user_message_at IS NOT NULL
          AND last_user_message_at >= ?
          AND (last_admin_message_at IS NULL OR last_admin_message_at < last_user_message_at)
        ORDER BY last_user_message_at DESC`,
    )
    .all(cutoff) as WaitingRow[];

  let updated = 0;
  let errors = 0;

  // Process in parallel batches
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((row) => {
        const elapsed = now - row.last_user_message_at;
        if (elapsed < 60) return Promise.resolve(true);
        return updateConversation(row.id, formatWaiting(elapsed));
      }),
    );
    for (const ok of results) {
      if (ok) updated++;
      else errors++;
    }
    if (i + CONCURRENCY < rows.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  return { updated, errors, total: rows.length };
}
