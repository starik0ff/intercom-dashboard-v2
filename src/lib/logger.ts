import fs from "fs";
import path from "path";

const LOG_FILE = path.resolve(
  process.cwd(),
  "..",
  "intercom-migration",
  "data",
  "activity.jsonl"
);

export type ActionType =
  | "login"
  | "login_failed"
  | "logout"
  | "search"
  | "view_conversation"
  | "export";

export interface LogEntry {
  ts: number;
  datetime: string;
  user: string;
  role: string;
  action: ActionType;
  details: Record<string, unknown>;
}

export function logActivity(
  user: string,
  role: string,
  action: ActionType,
  details: Record<string, unknown> = {}
): void {
  const entry: LogEntry = {
    ts: Date.now(),
    datetime: new Date().toISOString(),
    user,
    role,
    action,
    details,
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // ignore logging errors — should not break main functionality
  }
}

export function readLogs(limit = 500): LogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => e !== null);
    return entries.slice(-limit).reverse(); // newest first
  } catch {
    return [];
  }
}
