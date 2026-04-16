import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";

// SESSION_SECRET is required everywhere this module is imported.
// In Edge runtime (proxy.ts) we use a separate path that re-reads process.env
// at request time; here we read once on first use.
function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET env var is required and must be ≥16 chars",
    );
  }
  return s;
}

export interface SessionUser {
  username: string;
  role: "admin" | "user";
  displayName: string;
}

interface StoredUser {
  hash: string; // scrypt$N$saltB64u$keyB64u
  role: "admin" | "user";
  displayName: string;
}

let _users: Record<string, StoredUser> | null = null;
function loadUsers(): Record<string, StoredUser> {
  if (_users) return _users;
  const file =
    process.env.DASHBOARD_USERS_FILE ||
    path.join(process.cwd(), "credentials", "users.json");
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    throw new Error(`Users file not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, "utf8");
  _users = JSON.parse(raw) as Record<string, StoredUser>;
  return _users;
}

// scrypt verify with constant-time comparison
function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const N = parseInt(parts[1], 10);
  const salt = Buffer.from(parts[2], "base64url");
  const expected = Buffer.from(parts[3], "base64url");
  const got = crypto.scryptSync(plain, salt, expected.length, { N, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expected);
}

export function authenticate(username: string, password: string): SessionUser | null {
  const users = loadUsers();
  const u = users[username];
  if (!u) {
    // Burn similar amount of CPU to avoid trivial username enumeration timing.
    crypto.scryptSync(password, "decoy-salt-1234567890ab", 32, { N: 16384, r: 8, p: 1 });
    return null;
  }
  if (!verifyPassword(password, u.hash)) return null;
  return { username, role: u.role, displayName: u.displayName };
}

export function getUserMeta(username: string): SessionUser | null {
  const u = loadUsers()[username];
  if (!u) return null;
  return { username, role: u.role, displayName: u.displayName };
}

export function createToken(username: string, role: string): string {
  const expires = Date.now() + 24 * 60 * 60 * 1000; // 24h
  const payload = `${username}:${role}:${expires}`;
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): SessionUser | null {
  try {
    const lastDot = token.lastIndexOf(".");
    if (lastDot === -1) return null;

    const payload = token.slice(0, lastDot);
    const sig = token.slice(lastDot + 1);

    const expectedSig = crypto
      .createHmac("sha256", getSecret())
      .update(payload)
      .digest("base64url");

    if (sig.length !== expectedSig.length) return null;
    if (
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
    ) {
      return null;
    }

    const parts = payload.split(":");
    if (parts.length !== 3) return null;

    const [username, role, expiresStr] = parts;
    if (Date.now() > parseInt(expiresStr)) return null;

    const meta = getUserMeta(username);
    if (!meta) return null;
    if (meta.role !== role) return null; // role rotated since token issued

    return meta;
  } catch {
    return null;
  }
}
