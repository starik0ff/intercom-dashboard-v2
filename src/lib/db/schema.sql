-- Dashboard v2 schema. Run via client.ts migration runner.
-- All timestamps stored as INTEGER unix seconds (Intercom convention).

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ---------- conversations ----------
CREATE TABLE IF NOT EXISTS conversations (
  id                       TEXT PRIMARY KEY,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  waiting_since            INTEGER,
  snoozed_until            INTEGER,
  open                     INTEGER NOT NULL DEFAULT 1, -- 0/1
  state                    TEXT,                       -- open|closed|snoozed
  read                     INTEGER,
  priority                 TEXT,                       -- priority | not_priority

  -- contact
  contact_id               TEXT,
  contact_email            TEXT,
  contact_name             TEXT,
  contact_external_id      TEXT,

  -- assignment (current)
  team_assignee_id         TEXT,
  admin_assignee_id        TEXT,
  -- first non-bot team assignment (Variant D)
  first_team_assignee_id   TEXT,
  first_team_assigned_at   INTEGER,

  -- source
  source_type              TEXT,    -- intercom source.type
  source_url               TEXT,
  source_subject           TEXT,
  source_delivered_as      TEXT,

  -- classification
  source_bucket            TEXT NOT NULL,  -- telegram_boostyfi|telegram_iamlimitless|facebook|website|email|other|unknown
  status_bucket            TEXT NOT NULL,  -- new|in_progress|negotiation|tech_q|no_reply|closed_deal|closed|unknown
  status_source            TEXT NOT NULL,  -- heuristic|manual|intercom
  progress_attribute       TEXT,           -- raw Intercom custom_attributes.Progress value

  -- denormalized metrics
  parts_count              INTEGER NOT NULL DEFAULT 0,
  user_messages_count      INTEGER NOT NULL DEFAULT 0,
  admin_messages_count     INTEGER NOT NULL DEFAULT 0,
  last_user_message_at     INTEGER,
  last_admin_message_at    INTEGER,
  first_admin_reply_at     INTEGER,
  first_response_seconds   INTEGER,

  -- raw json blob (for debugging / future fields)
  raw_json                 TEXT,

  -- bookkeeping
  fetched_at               INTEGER NOT NULL,
  detail_fetched_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_conv_updated     ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_conv_created     ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conv_team        ON conversations(team_assignee_id);
CREATE INDEX IF NOT EXISTS idx_conv_admin       ON conversations(admin_assignee_id);
CREATE INDEX IF NOT EXISTS idx_conv_source      ON conversations(source_bucket);
CREATE INDEX IF NOT EXISTS idx_conv_status      ON conversations(status_bucket);
CREATE INDEX IF NOT EXISTS idx_conv_open        ON conversations(open);
CREATE INDEX IF NOT EXISTS idx_conv_email       ON conversations(contact_email);

-- ---------- messages ----------
-- One row per conversation_part of type comment/note/message.
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  part_type       TEXT,    -- comment | note | assignment | open | close | ...
  author_type     TEXT,    -- admin | user | bot | lead | contact
  author_id       TEXT,
  body            TEXT,    -- plain text (HTML stripped)
  body_html       TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_msg_conv     ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_author   ON messages(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_created  ON messages(created_at);

-- FTS5 over message body
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

-- ---------- manual status overrides ----------
CREATE TABLE IF NOT EXISTS conversation_status_overrides (
  conversation_id TEXT PRIMARY KEY,
  status_bucket   TEXT NOT NULL,
  set_by          TEXT NOT NULL,  -- dashboard user id / email
  set_at          INTEGER NOT NULL,
  note            TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- ---------- admins / teams ----------
CREATE TABLE IF NOT EXISTS admins (
  id             TEXT PRIMARY KEY,
  name           TEXT,
  email          TEXT,
  has_inbox_seat INTEGER,
  away_mode      INTEGER,
  raw_json       TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  raw_json    TEXT,
  updated_at  INTEGER NOT NULL
);

-- ---------- sync state / errors ----------
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sync_errors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at     INTEGER NOT NULL,
  scope           TEXT NOT NULL,         -- bootstrap|incremental|detail|admins|teams
  conversation_id TEXT,
  status_code     INTEGER,
  message         TEXT NOT NULL,
  payload         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_err_when ON sync_errors(occurred_at);

-- ---------- activity log (audit) ----------
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_when ON activity_log(occurred_at);

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      INTEGER NOT NULL,
  kind            TEXT NOT NULL,    -- stuck_chat | closed_deal | sync_error | manual
  conversation_id TEXT,
  severity        TEXT NOT NULL DEFAULT 'info', -- info|warn|error
  title           TEXT NOT NULL,
  body            TEXT,
  payload         TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notif_kind    ON notifications(kind);

CREATE TABLE IF NOT EXISTS notifications_read (
  notification_id INTEGER NOT NULL,
  user_id         TEXT NOT NULL,
  read_at         INTEGER NOT NULL,
  PRIMARY KEY (notification_id, user_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
);

-- ---------- export jobs ----------
CREATE TABLE IF NOT EXISTS export_jobs (
  id              TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  completed_at    INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|done|error
  format          TEXT NOT NULL,                     -- csv|json
  filters         TEXT NOT NULL,                     -- JSON blob
  total_rows      INTEGER,
  processed_rows  INTEGER NOT NULL DEFAULT 0,
  file_path       TEXT,
  file_size       INTEGER,
  error_message   TEXT,
  requested_by    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_export_status  ON export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_export_created ON export_jobs(created_at);

-- ---------- channel status cache (monitoring/integrations) ----------
CREATE TABLE IF NOT EXISTS channel_status_cache (
  channel         TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  total_open      INTEGER NOT NULL DEFAULT 0,
  last_1h         INTEGER NOT NULL DEFAULT 0,
  last_24h        INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,             -- ISO 8601
  last_conv_id    TEXT,
  status          TEXT NOT NULL DEFAULT 'ok',  -- ok|warning|error
  updated_at      INTEGER NOT NULL  -- unix seconds
);

-- ---------- admin → telegram mapping (notifications) ----------
CREATE TABLE IF NOT EXISTS admin_telegram (
  admin_id         TEXT PRIMARY KEY,
  telegram_chat_id TEXT NOT NULL,
  username         TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

-- ---------- telegram registration flow (temporary state) ----------
CREATE TABLE IF NOT EXISTS telegram_reg (
  chat_id     TEXT PRIMARY KEY,
  admin_id    TEXT,
  admin_name  TEXT,
  code        TEXT,
  step        TEXT NOT NULL DEFAULT 'await_admin_id',  -- await_admin_id | await_code
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------- telegram notification threads (group messages per conversation) ----------
CREATE TABLE IF NOT EXISTS telegram_threads (
  conversation_id  TEXT NOT NULL,
  chat_id          TEXT NOT NULL,
  message_id       INTEGER NOT NULL,   -- telegram message_id
  messages_count   INTEGER NOT NULL DEFAULT 1,
  last_text        TEXT,               -- full current message text
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (conversation_id, chat_id)
);

-- ---------- telegram bot event log (persistent) ----------
CREATE TABLE IF NOT EXISTS telegram_bot_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch()),
  chat_id     TEXT NOT NULL,
  tg_username TEXT,
  event       TEXT NOT NULL,  -- start | email_entered | code_sent | verified | reset | error
  admin_id    TEXT,
  admin_email TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tglog_time ON telegram_bot_log(occurred_at);
