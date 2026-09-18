#!/usr/bin/env node
/**
 * Trigger a deal hunt and publish the results.
 *
 * Deliberately a thin HTTP client rather than a second copy of the logic: it
 * drives the same /api/deals endpoint the scheduler calls, so what you test
 * locally is exactly what runs in production.
 *
 * Usage:
 *   node scripts/post-deals.mjs --dry-run
 *   node scripts/post-deals.mjs --category "سماعات" --region "الأردن" --limit 5
 *
 * Environment:
 *   LUKA_URL     base URL of the running app (default http://localhost:3000)
 *   CRON_SECRET  the same secret the server is configured with
 */

const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : "true";
}

const base = (process.env.LUKA_URL || "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("✗ CRON_SECRET is not set. Export the same value the server uses.");
  process.exit(1);
}

const payload = {
  category: flag("category"),
  region: flag("region"),
  language: flag("language"),
  currency: flag("currency"),
  limit: flag("limit"),
  mode: flag("mode"),
  heading: flag("heading"),
  dryRun: args.includes("--dry-run") ? "true" : undefined,
};

for (const key of Object.keys(payload)) {
  if (payload[key] === undefined) delete payload[key];
}

console.log(`→ ${base}/api/deals`, payload);

try {
  const res = await fetch(`${base}/api/deals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    console.error(`✗ Request failed (${res.status}):`, data?.error ?? "no response body");
    process.exit(1);
  }

  if (data.summary) console.log(`\n${data.summary}`);

  for (const deal of data.deals ?? []) {
    const price = deal.price !== undefined ? `${deal.price} ${deal.currency ?? ""}` : "—";
    const tag = deal.network ? `[${deal.network}]` : "[untagged]";
    console.log(`  • ${deal.title} — ${price} ${tag}`);
    console.log(`    ${deal.affiliateUrl || deal.url}`);
  }

  if (data.dryRun) {
    console.log("\n✓ Dry run — nothing was posted.");
  } else if (data.published !== undefined) {
    console.log(`\n✓ Published ${data.published} post(s) to Telegram.`);
    if (data.failed) console.error(`✗ ${data.failed} failed:`, data.errors);
  }

  process.exit(data.ok === false ? 1 : 0);
} catch (err) {
  console.error("✗ Could not reach the app:", err.message);
  console.error("  Is it running? Try `npm run dev` first, or set LUKA_URL.");
  process.exit(1);
}
