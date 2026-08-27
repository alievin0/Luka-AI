/**
 * Per-client rate limiting for the scan endpoint.
 *
 * The route is public and unauthenticated — it has to be, the app ships no
 * secret — and every call spends money on a vision request. Without a limit,
 * anyone who reads the URL out of the app's traffic can drain the API budget.
 *
 * This is an in-memory limiter, so it resets on deploy and does not span
 * instances. That is enough to stop casual abuse from one machine; before
 * launch, move the counters to a shared store (Redis/Upstash) so the limit
 * holds across instances, and add per-device attestation if abuse continues.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 30;
/** Stop the map growing without bound if traffic is spread over many IPs. */
const MAX_TRACKED_CLIENTS = 10_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Best-effort client identity from proxy headers. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

export type RateVerdict =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(key: string): RateVerdict {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED_CLIENTS) sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_PER_WINDOW - 1 };
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: MAX_PER_WINDOW - bucket.count };
}
