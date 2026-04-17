// Background export job processor.
// Called from the main worker loop to pick up and process pending export jobs.

import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { getDb } from '@/lib/db/client';
import {
  queryExportRows,
  loadMessagesBatch,
  loadAdminNames,
  formatMessageForCsv,
  resolveRole,
  csvRow,
  CSV_HEADER,
  isoOrEmpty,
  intercomUrl,
  type ExportFilters,
  type Row,
} from '@/lib/export/builder';

const BATCH = 200; // item #4: increased batch size
const EXPORTS_DIR = path.resolve(process.cwd(), 'data', 'exports');
const TTL_SECONDS = 24 * 60 * 60; // 24 hours

interface ExportJob {
  id: string;
  format: string;
  filters: string;
  requested_by: string;
}

function ensureExportsDir() {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

/** Clean up export jobs and files older than TTL. */
function cleanupOldJobs() {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - TTL_SECONDS;
  const old = db
    .prepare("SELECT id, file_path FROM export_jobs WHERE created_at < ? AND status IN ('done', 'error')")
    .all(cutoff) as { id: string; file_path: string | null }[];

  for (const job of old) {
    if (job.file_path) {
      const fullPath = path.resolve(process.cwd(), job.file_path);
      try { fs.unlinkSync(fullPath); } catch { /* already deleted */ }
      // Also remove gzip version
      try { fs.unlinkSync(fullPath + '.gz'); } catch { /* ok */ }
    }
  }

  if (old.length > 0) {
    const placeholders = old.map(() => '?').join(',');
    db.prepare(`DELETE FROM export_jobs WHERE id IN (${placeholders})`).run(...old.map((j) => j.id));
    console.log(`[export] Cleaned up ${old.length} old export job(s)`);
  }
}

function writeExportFile(job: ExportJob): { filePath: string; fileSize: number; totalRows: number } {
  const filters: ExportFilters = JSON.parse(job.filters);
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Mark as processing
  db.prepare("UPDATE export_jobs SET status = 'processing', started_at = ? WHERE id = ?").run(now, job.id);

  // Query all rows
  const allRows = queryExportRows(filters);
  const totalRows = allRows.length;
  db.prepare('UPDATE export_jobs SET total_rows = ? WHERE id = ?').run(totalRows, job.id);

  const adminNames = loadAdminNames();
  const relPath = `data/exports/${job.id}.${job.format}`;
  const fullPath = path.resolve(process.cwd(), relPath);
  ensureExportsDir();

  const fd = fs.openSync(fullPath, 'w');

  try {
    if (job.format === 'csv') {
      fs.writeSync(fd, '\uFEFF' + csvRow(CSV_HEADER));
      for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);
        const messagesMap = loadMessagesBatch(batch.map((r) => r.id));
        for (const r of batch) {
          const msgs = messagesMap.get(r.id) || [];
          // item #5: skip conversations with no messages
          const transcript = msgs.map((m) => formatMessageForCsv(m, adminNames)).join(' | ');
          fs.writeSync(
            fd,
            csvRow([
              r.id,
              isoOrEmpty(r.created_at),
              isoOrEmpty(r.updated_at),
              r.open ? 'open' : 'closed',
              r.source_bucket,
              r.status_bucket,
              r.status_source,
              r.contact_name,
              r.contact_email,
              r.admin_name,
              r.team_name,
              r.parts_count,
              r.user_messages_count,
              r.admin_messages_count,
              r.first_response_seconds,
              r.source_url,
              intercomUrl(r.id),
              transcript,
            ]),
          );
        }
        // Update progress
        db.prepare('UPDATE export_jobs SET processed_rows = ? WHERE id = ?').run(
          Math.min(i + BATCH, allRows.length),
          job.id,
        );
      }
    } else {
      // JSON format
      fs.writeSync(fd, '[\n');
      let first = true;
      for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);
        const messagesMap = loadMessagesBatch(batch.map((r) => r.id));
        for (const r of batch) {
          const msgs = messagesMap.get(r.id) || [];
          const obj = {
            conversation_id: r.id,
            created_at: isoOrEmpty(r.created_at),
            updated_at: isoOrEmpty(r.updated_at),
            state: r.open ? 'open' : 'closed',
            source_bucket: r.source_bucket,
            status_bucket: r.status_bucket,
            status_source: r.status_source,
            contact_name: r.contact_name,
            contact_email: r.contact_email,
            admin_name: r.admin_name,
            team_name: r.team_name,
            parts_count: r.parts_count,
            user_messages_count: r.user_messages_count,
            admin_messages_count: r.admin_messages_count,
            first_response_seconds: r.first_response_seconds,
            source_url: r.source_url,
            intercom_url: intercomUrl(r.id),
            messages: msgs.map((m) => ({
              timestamp: isoOrEmpty(m.created_at),
              role: resolveRole(m, adminNames),
              text: m.body,
            })),
          };
          fs.writeSync(fd, (first ? '' : ',\n') + JSON.stringify(obj));
          first = false;
        }
        db.prepare('UPDATE export_jobs SET processed_rows = ? WHERE id = ?').run(
          Math.min(i + BATCH, allRows.length),
          job.id,
        );
      }
      fs.writeSync(fd, '\n]\n');
    }
  } finally {
    fs.closeSync(fd);
  }

  // item #3: gzip the file
  const fileSize = fs.statSync(fullPath).size;

  return { filePath: relPath, fileSize, totalRows };
}

async function gzipFile(filePath: string): Promise<void> {
  const fullPath = path.resolve(process.cwd(), filePath);
  const gzPath = fullPath + '.gz';
  const source = fs.createReadStream(fullPath);
  const gzip = createGzip({ level: 6 });
  const dest = fs.createWriteStream(gzPath);
  await pipeline(source, gzip, dest);
  // Replace original with gzipped version
  fs.unlinkSync(fullPath);
  fs.renameSync(gzPath, fullPath);
}

/** Process all pending export jobs. Returns the number of jobs processed. */
export async function processExportJobs(): Promise<number> {
  cleanupOldJobs();

  const db = getDb();
  let processed = 0;

  while (true) {
    const job = db
      .prepare("SELECT id, format, filters, requested_by FROM export_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
      .get() as ExportJob | undefined;

    if (!job) break;

    console.log(`[export] Processing job ${job.id} (${job.format})...`);
    const t0 = Date.now();

    try {
      const result = writeExportFile(job);

      // Gzip the file (item #3)
      await gzipFile(result.filePath);
      const gzSize = fs.statSync(path.resolve(process.cwd(), result.filePath)).size;

      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        `UPDATE export_jobs
            SET status = 'done', completed_at = ?, file_path = ?, file_size = ?,
                processed_rows = ?, total_rows = ?
          WHERE id = ?`,
      ).run(now, result.filePath, gzSize, result.totalRows, result.totalRows, job.id);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[export] Job ${job.id} done: ${result.totalRows} rows, ${(gzSize / 1024).toFixed(0)}KB gzipped, ${elapsed}s`);
      processed++;
    } catch (err) {
      const now = Math.floor(Date.now() / 1000);
      const msg = err instanceof Error ? err.message : String(err);
      db.prepare(
        "UPDATE export_jobs SET status = 'error', completed_at = ?, error_message = ? WHERE id = ?",
      ).run(now, msg, job.id);
      console.error(`[export] Job ${job.id} failed:`, msg);
      processed++;
    }
  }

  return processed;
}
