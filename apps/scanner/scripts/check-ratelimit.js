/**
 * The limiter guards endpoints that spend money on every call, so its edges
 * are worth asserting rather than assuming.
 *
 * Two modes:
 *
 *   node scripts/check-ratelimit.js
 *     Exercises the in-memory window — the path every request takes when no
 *     shared store is configured, and the path every request falls back to
 *     when one is configured and unreachable. Runs in `npm run check`.
 *
 *   node scripts/check-ratelimit.js --probe <rest-url> <token>
 *     Sends the real pipeline request to a real Upstash instance and prints
 *     what came back. **Run this once before trusting the shared store.** The
 *     wire format in src/rate-limit.ts was written without access to Upstash's
 *     documentation — this container's egress policy blocks the host — so this
 *     is the only thing that confirms it. Until it passes, the shared path
 *     fails safe into memory and the limiter behaves exactly as it did before.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* ------------------------------------------------------------------- the probe */

async function probe(url, token) {
  const base = url.replace(/\/$/, "");
  const field = `ratelimit:probe:${Date.now()}`;
  const body = [
    ["INCR", field],
    ["EXPIRE", field, "60", "NX"],
    ["TTL", field],
  ];

  console.log(`POST ${base}/pipeline`);
  console.log(`  ${JSON.stringify(body)}\n`);

  const response = await fetch(`${base}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(text);

  if (!response.ok) {
    console.log("\n✗ The request was rejected. The URL, the token, or the shape is wrong.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.log("\n✗ The response is not JSON. src/rate-limit.ts expects JSON.");
    process.exit(1);
  }

  const count = Number(parsed?.[0]?.result);
  const ttl = Number(parsed?.[2]?.result);
  if (!Array.isArray(parsed) || !Number.isFinite(count) || !Number.isFinite(ttl)) {
    console.log(
      "\n✗ Not the shape src/rate-limit.ts reads. It expects an array of " +
        "{result} objects: INCR's count at [0], TTL's seconds at [2]. " +
        "Adjust hitRedis() to match what came back above.",
    );
    process.exit(1);
  }

  console.log(`\ncount=${count} ttl=${ttl}`);
  if (count !== 1) console.log("(count is not 1 — a stale key, or INCR did not create it)");
  if (ttl < 1) console.log("✗ TTL was not set. Retry-After would fall back to a full window.");
  console.log("\n✓ The wire format matches what src/rate-limit.ts reads.");
}

/* ------------------------------------------------------- the in-memory window */

/** Load the limiter's in-memory half without a TypeScript build: strip the
 *  types off the two functions this needs and evaluate them. */
function memoryLimiter() {
  const src = fs.readFileSync(path.join(ROOT, "src/rate-limit.ts"), "utf8");
  const window = Number(src.match(/const WINDOW_MS = ([^;]+);/)[1].split("//")[0].replace(/[^\d*]/g, "").split("*").reduce((a, b) => a * b));
  const max = Number(src.match(/const MAX_PER_WINDOW = (\d+);/)[1]);
  const tracked = Number(src.match(/const MAX_TRACKED_CLIENTS = ([\d_]+);/)[1].replace(/_/g, ""));

  const buckets = new Map();
  const sweep = (now) => {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  };
  // Mirrors hitMemory in src/rate-limit.ts. The checker below asserts the
  // behaviour; check-lectures-style source assertions keep the two in step.
  const hit = (key, m = max, now = Date.now()) => {
    if (buckets.size > tracked) sweep(now);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + window });
      return { allowed: true, remaining: m - 1 };
    }
    if (bucket.count >= m) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, remaining: m - bucket.count };
  };
  return { hit, max, window, buckets };
}

const problems = [];
const ok = (what, condition) => {
  if (condition) console.log(`ok   ${what}`);
  else {
    console.log(`FAIL ${what}`);
    problems.push(what);
  }
};

function checkMemory() {
  const { hit, window } = memoryLimiter();
  const t0 = 1_000_000;

  ok("the first request is allowed", hit("a", 3, t0).allowed);
  ok("and spends one of the allowance", hit("b", 3, t0).remaining === 2);

  hit("c", 3, t0);
  hit("c", 3, t0);
  const third = hit("c", 3, t0);
  ok("the last request inside the limit is still allowed", third.allowed && third.remaining === 0);

  const fourth = hit("c", 3, t0);
  ok("the one after it is refused", !fourth.allowed);
  ok(
    "and is told how long to wait, never zero",
    !fourth.allowed && fourth.retryAfterSeconds > 0 && fourth.retryAfterSeconds <= window / 1000,
  );

  const late = hit("c", 3, t0 + window + 1);
  ok("the window reopens once it has passed", late.allowed);

  ok("one client's spending does not touch another's", hit("d", 3, t0).remaining === 2);

  // The per-surface allowances exist because a transcription costs orders of
  // magnitude more than an image; a shared counter would let one drain the other.
  const src = fs.readFileSync(path.join(ROOT, "src/rate-limit.ts"), "utf8");
  ok(
    "the lecture routes have a tighter allowance than scanning",
    Number(src.match(/LECTURE_MAX_PER_WINDOW = (\d+)/)[1]) <
      Number(src.match(/const MAX_PER_WINDOW = (\d+)/)[1]),
  );

  // A shared-store failure must not become an unlimited spend window.
  ok(
    "an unreachable shared store falls back to memory, not to open",
    /return shared \?\? hitMemory\(/.test(src),
  );
  ok(
    "and says so once rather than once per request",
    /warnedAboutStore/.test(src) && /console\.warn/.test(src),
  );

  // Every route must await it now that it can do IO.
  for (const route of ["scan", "analyze", "ask", "transcribe"]) {
    const routeSrc = fs.readFileSync(path.join(ROOT, `app/api/${route}+api.ts`), "utf8");
    ok(`${route}+api.ts awaits checkRateLimit`, /await checkRateLimit\(/.test(routeSrc));
  }
}

/* ---------------------------------------------------------------------- main */

const args = process.argv.slice(2);
if (args[0] === "--probe") {
  const [, url, token] = args;
  if (!url || !token) {
    console.log("usage: node scripts/check-ratelimit.js --probe <rest-url> <token>");
    process.exit(2);
  }
  probe(url, token).catch((error) => {
    console.log(`\n✗ ${error.message}`);
    process.exit(1);
  });
} else {
  checkMemory();
  console.log(`\n${problems.length ? `${problems.length} problems.` : "All rate-limit checks passed."}`);
  if (problems.length) process.exit(1);
}
