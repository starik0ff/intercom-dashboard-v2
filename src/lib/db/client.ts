import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DASHBOARD_DB_PATH ||
  path.join(process.cwd(), 'data', 'dashboard.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Run schema (idempotent — uses IF NOT EXISTS).
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Idempotent ALTER TABLE migrations (SQLite lacks IF NOT EXISTS for columns).
  // Each entry is checked against pragma table_info and added if missing.
  const migrations: Array<{ table: string; column: string; ddl: string }> = [
    {
      table: 'conversations',
      column: 'progress_attribute',
      ddl: 'ALTER TABLE conversations ADD COLUMN progress_attribute TEXT',
    },
  ];
  for (const m of migrations) {
    const cols = db
      .prepare(`PRAGMA table_info(${m.table})`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === m.column)) {
      db.exec(m.ddl);
    }
  }

  _db = db;
  return db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
