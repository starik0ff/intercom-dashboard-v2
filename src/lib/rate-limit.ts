// Tiny in-process token bucket for mutation endpoints.
// Not distributed-safe, but we run a single Next.js instance behind nginx.

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Token bucket. capacity = max burst, refillPerSec = sustained rate.
 * key should encode endpoint + actor (e.g. `assign:${user}` or `login:${ip}`).
 */
export function rateLimit(
  key: string,
  capacity: number,
  refillPerSec: number,
): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, updatedAt: now };
    buckets.set(key, b);
  } else {
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.updatedAt = now;
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
  }
  const retryAfterMs = Math.ceil(((1 - b.tokens) / refillPerSec) * 1000);
  return { ok: false, remaining: 0, retryAfterMs };
}

export function rateLimitResponse(r: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: "Too Many Requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)),
    },
  });
}

// Periodic cleanup so memory doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1h idle → drop
  for (const [k, b] of buckets) {
    if (b.updatedAt < cutoff) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref?.();
