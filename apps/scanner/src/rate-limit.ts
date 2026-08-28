/**
 * Per-client rate limiting for the paid routes.
 *
 * They are public and unauthenticated — they have to be, the app ships no
 * secret — and every call spends money. Without a limit, anyone who reads the
 * URL out of the app's traffic can drain the API budget.
 *
 * Counters live in a shared store when one is configured, and in process
 * memory otherwise. Process memory alone was never enough for launch: it
 * resets on every deploy and does not span instances, so N instances mean N
 * times the allowance and a deploy hands everyone a fresh quota.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 30;
/** Transcribing an hour of audio costs orders of magnitude more than one
 *  image, so the lecture endpoints get their own, much tighter allowance. */
export const LECTURE_MAX_PER_WINDOW = 6;
/** Asking a question is a text-only call over an excerpt, so it costs a
 *  fraction of an analysis — but it is still a paid call on a public route,
 *  and a study session is a handful of questions rather than a hundred. */
export const ASK_MAX_PER_WINDOW = 20;
/** Stop the map growing without bound if traffic is spread over many IPs. */
const MAX_TRACKED_CLIENTS = 10_000;

export type RateVerdict =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/* ------------------------------------------------------------ process memory */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function hitMemory(key: string, max: number): RateVerdict {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED_CLIENTS) sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: max - 1 };
  }

  if (bucket.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: max - bucket.count };
}

/* -------------------------------------------------------------- shared store */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const sharedStoreConfigured = Boolean(REDIS_URL && REDIS_TOKEN);

/** Complain once rather than once per request when the store is unreachable. */
let warnedAboutStore = false;

/**
 * A fixed-window counter in Redis, over Upstash's REST API.
 *
 * Two commands in one round trip: `INCR` the key, and `EXPIRE` it with `NX` so
 * only the request that created the window sets its lifetime. The count that
 * comes back is this client's usage inside the current window, and the TTL is
 * how long until it resets — which is exactly the `Retry-After` the routes
 * already send.
 *
 * REST rather than a Redis client library: these run in the Expo server output,
 * the transcribe route already reaches an external service with plain `fetch`,
 * and a TCP client would be one more native-ish dependency for two commands.
 *
 * **The wire format below was written without being able to load Upstash's
 * documentation** — this container's egress policy blocks the host. It matches
 * their REST API as I understand it, and `scripts/check-ratelimit.js --probe`
 * exercises it against a real instance in one command. Run that once before
 * trusting this in production; until it passes, every request quietly falls
 * back to the in-memory limiter below, which is what shipped before.
 */
async function hitRedis(key: string, max: number): Promise<RateVerdict | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;

  const seconds = Math.ceil(WINDOW_MS / 1000);
  const field = `ratelimit:${key}`;

  try {
    const response = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", field],
        ["EXPIRE", field, String(seconds), "NX"],
        ["TTL", field],
      ]),
    });
    if (!response.ok) return unavailable(`HTTP ${response.status}`);

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body) || body.length < 3) return unavailable("unexpected response shape");

    const count = Number((body[0] as { result?: unknown })?.result);
    const ttl = Number((body[2] as { result?: unknown })?.result);
    if (!Number.isFinite(count) || count < 1) return unavailable("no count in response");

    if (count > max) {
      // A negative TTL means the key exists without one, which should not
      // happen — treat it as a full window rather than as "retry immediately".
      return {
        allowed: false,
        retryAfterSeconds: ttl > 0 ? ttl : seconds,
      };
    }
    return { allowed: true, remaining: max - count };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "request failed");
  }
}

function unavailable(why: string): null {
  if (!warnedAboutStore) {
    warnedAboutStore = true;
    console.warn(
      `[rate-limit] shared store unavailable (${why}); falling back to this ` +
        `instance's memory. The limit no longer spans instances.`,
    );
  }
  return null;
}

/* ------------------------------------------------------------------- identity */

/**
 * Best-effort client identity from proxy headers.
 *
 * There is no socket peer address inside a WinterCG request handler, so
 * headers are the only source there is. They are ordered by how much the
 * caller can influence them: `cf-connecting-ip` is written by the Cloudflare
 * edge and cannot be set by the client, whereas `x-forwarded-for` is a chain
 * anyone may prepend to. Preferring the trustworthy one where it exists costs
 * nothing and removes the easiest way to get a fresh bucket per request.
 *
 * This does not make the limiter authoritative — an attacker with many
 * addresses still gets many buckets. Per-device attestation is the next step
 * if abuse continues.
 */
export function clientKey(request: Request): string {
  const trusted = request.headers.get("cf-connecting-ip");
  if (trusted) return trusted.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Spend one unit of a client's allowance.
 *
 * A shared-store failure falls back to this instance's memory rather than to
 * open. Failing open would turn a Redis outage into an unlimited spend window
 * on an endpoint that costs money per call; failing closed would take the app
 * down for everyone because a cache was unreachable. Per-instance limiting is
 * the honest middle, and the fallback says so in the log.
 */
export async function checkRateLimit(key: string, max = MAX_PER_WINDOW): Promise<RateVerdict> {
  const shared = await hitRedis(key, max);
  return shared ?? hitMemory(key, max);
}

/** For the checker: the in-memory path on its own, and a way to reset it. */
export const __memory = {
  hit: hitMemory,
  reset: () => buckets.clear(),
  windowMs: WINDOW_MS,
};
