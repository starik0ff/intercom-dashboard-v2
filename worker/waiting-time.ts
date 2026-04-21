/**
 * Updates "Ожидание ответа" custom attribute on open Intercom conversations.
 * Runs every cycle from the worker daemon.
 *
 * Logic: for each open conversation where last message is from user (not admin),
 * compute elapsed time and write a human-readable string to Intercom.
 * If admin already replied last — clear the field.
 */

import type Database from 'better-sqlite3';

const BASE_URL = 'https://api.intercom.io';
const BATCH_DELAY_MS = 150; // ~6-7 req/s to stay within Intercom rate limits

interface WaitingRow {
  id: string;
  last_user_message_at: number | null;
  last_admin_message_at: number | null;
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

async function updateConversation(
  convId: string,
  value: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/conversations/${convId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({
        custom_attributes: { 'Ожидание ответа': value },
      }),
    });
    if (res.status === 429) {
      const delay = parseInt(res.headers.get('retry-after') || '5', 10);
      await new Promise((r) => setTimeout(r, delay * 1000));
      // Retry once
      const retry = await fetch(`${BASE_URL}/conversations/${convId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          custom_attributes: { 'Ожидание ответа': value },
        }),
      });
      return retry.ok;
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function refreshWaitingTimes(db: Database.Database): Promise<{
  updated: number;
  cleared: number;
  errors: number;
}> {
  const now = Math.floor(Date.now() / 1000);

  // Get all open conversations with message timestamps
  const rows = db
    .prepare(
      `SELECT id, last_user_message_at, last_admin_message_at
         FROM conversations
        WHERE state = 'open'
          AND (last_user_message_at IS NOT NULL OR last_admin_message_at IS NOT NULL)`,
    )
    .all() as WaitingRow[];

  let updated = 0;
  let cleared = 0;
  let errors = 0;

  for (const row of rows) {
    const lastUser = row.last_user_message_at;
    const lastAdmin = row.last_admin_message_at;

    // Determine if client is waiting (user spoke last)
    const isWaiting = lastUser && (!lastAdmin || lastAdmin < lastUser);

    let value: string;
    if (isWaiting) {
      const elapsed = now - lastUser;
      if (elapsed < 60) continue; // skip if < 1 min
      value = formatWaiting(elapsed);
    } else {
      value = '';
    }

    const ok = await updateConversation(row.id, value);
    if (ok) {
      if (isWaiting) updated++;
      else cleared++;
    } else {
      errors++;
    }

    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  return { updated, cleared, errors };
}
