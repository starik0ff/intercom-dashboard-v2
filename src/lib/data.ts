import fs from "fs";
import path from "path";
import readline from "readline";
import type { Conversation, AuthorIndex } from "./types";

let cachedTeammateEmails: Set<string> | null = null;
let cachedTeammateNames: Map<string, string> | null = null;
let cachedAdminIdNames: Map<number, string> | null = null;

export function loadTeammateEmails(): Set<string> {
  if (cachedTeammateEmails) return cachedTeammateEmails;
  loadTeammatesFromCsv();
  return cachedTeammateEmails!;
}

export function loadTeammateNames(): Map<string, string> {
  if (cachedTeammateNames) return cachedTeammateNames;
  loadTeammatesFromCsv();
  return cachedTeammateNames!;
}

export function loadAdminIdNames(): Map<number, string> {
  if (cachedAdminIdNames) return cachedAdminIdNames;
  loadTeammatesFromCsv();
  return cachedAdminIdNames!;
}

function loadTeammatesFromCsv() {
  const filePath = path.resolve(process.cwd(), "credentials", "teammates.csv");
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").slice(1);
  const emails = new Set<string>();
  const names = new Map<string, string>();
  const adminIds = new Map<number, string>();
  for (const line of lines) {
    const match = line.match(/^"([^"]*)","([^"]+)"/);
    if (match) {
      emails.add(match[2].toLowerCase());
      names.set(match[2].toLowerCase(), match[1]);
    }
    const idMatch = line.match(/\/teammates\/(\d+)\//);
    if (idMatch && match) {
      adminIds.set(parseInt(idMatch[1]), match[1]);
    }
  }
  cachedTeammateEmails = emails;
  cachedTeammateNames = names;
  cachedAdminIdNames = adminIds;
}

const DATA_DIR = path.resolve(process.cwd(), "..", "intercom-migration", "data");

let cachedConversations: Conversation[] | null = null;
let cachedAuthorIndex: AuthorIndex | null = null;
let cachedFileMtime: number = 0;

/**
 * Load all conversations from JSONL file into memory (cached after first load).
 * ~42MB file, ~14k conversations - fits in Node.js memory.
 */
export async function loadConversations(): Promise<Conversation[]> {
  const filePath = path.join(DATA_DIR, "conversations_simplified.jsonl");

  const mtime = fs.statSync(filePath).mtimeMs;
  if (cachedConversations && mtime === cachedFileMtime) return cachedConversations;

  cachedAuthorIndex = null; // сбросить вместе с основным кешем
  const conversations: Conversation[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        conversations.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
  }

  cachedConversations = conversations;
  cachedFileMtime = mtime;
  return conversations;
}

/**
 * Load the author index mapping author -> conversation_ids.
 */
export async function loadAuthorIndex(): Promise<AuthorIndex> {
  if (cachedAuthorIndex) return cachedAuthorIndex;

  const filePath = path.join(DATA_DIR, "author_index.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  cachedAuthorIndex = JSON.parse(raw);
  return cachedAuthorIndex!;
}

/**
 * Get a single conversation by ID.
 */
export async function getConversation(id: string): Promise<Conversation | null> {
  const conversations = await loadConversations();
  return conversations.find((c) => c.conversation_id === id) || null;
}

/**
 * Extract all unique authors from the author index.
 */
export async function getAuthors(): Promise<string[]> {
  const index = await loadAuthorIndex();
  return Object.keys(index).sort();
}

/**
 * Search conversations with filters.
 */
export async function searchConversations(params: {
  author?: string;
  bodyQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ results: Conversation[]; total: number }> {
  const { author, bodyQuery, dateFrom, dateTo, sort = "newest", page = 1, pageSize = 50 } = params;

  const conversations = await loadConversations();
  const authorIndex = await loadAuthorIndex();

  let candidateIds: Set<string> | null = null;

  // Filter by author using the index for fast lookup
  if (author && author.trim()) {
    const query = author.trim().toLowerCase();
    const matchingIds = new Set<string>();
    for (const [authorKey, ids] of Object.entries(authorIndex)) {
      if (authorKey.toLowerCase().includes(query)) {
        for (const id of ids) {
          matchingIds.add(id);
        }
      }
    }
    candidateIds = matchingIds;
  }

  const bodyQueryLower = bodyQuery?.trim().toLowerCase() || "";

  const filtered: Conversation[] = [];

  for (const conv of conversations) {
    // Filter by candidate IDs from author index
    if (candidateIds && !candidateIds.has(conv.conversation_id)) continue;

    // Filter by date range
    if (dateFrom) {
      const convDate = conv.created_at.slice(0, 10);
      if (convDate < dateFrom) continue;
    }
    if (dateTo) {
      const convDate = conv.created_at.slice(0, 10);
      if (convDate > dateTo) continue;
    }

    // Filter by body text
    if (bodyQueryLower) {
      const hasMatch = conv.messages.some((m) =>
        m.body.toLowerCase().includes(bodyQueryLower)
      );
      if (!hasMatch) continue;
    }

    filtered.push(conv);
  }

  if (sort === "oldest") {
    filtered.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } else {
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const results = filtered.slice(start, start + pageSize);

  return { results, total };
}
