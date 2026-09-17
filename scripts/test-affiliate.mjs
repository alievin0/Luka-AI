#!/usr/bin/env node
/**
 * Checks for the money path: affiliate tagging and redirect safety.
 *
 * A silent bug here means links that look fine and earn nothing, so this runs
 * the real modules rather than mocking them. Run it after changing any
 * affiliate configuration:
 *
 *   npm test
 */

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "luka-check-"));

try {
  execFileSync(
    "npx",
    ["tsc", "lib/affiliate.ts", "lib/links.ts", "--outDir", outDir,
     "--module", "commonjs", "--target", "es2020", "--moduleResolution", "node",
     "--esModuleInterop", "--skipLibCheck", "--strict"],
    { stdio: "inherit" },
  );
} catch {
  console.error("✗ Could not compile the modules under test.");
  process.exit(1);
}

const { monetizeUrl, affiliateStatus } = await import(
  pathToFileURL(join(outDir, "affiliate.js")).href
);
const { buildClickUrl, resolveTarget } = await import(
  pathToFileURL(join(outDir, "links.js")).href
);


let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}
function reset() {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("AFF_") || k.startsWith("LUKA_")) delete process.env[k];
  }
}

console.log("\n── no configuration: nothing changes ──");
reset();
check("an unconfigured link is returned untouched", () => {
  const r = monetizeUrl("https://www.amazon.ae/dp/B0CHX1W1XY");
  assert.strictEqual(r.url, "https://www.amazon.ae/dp/B0CHX1W1XY");
  assert.strictEqual(r.network, null);
});
check("status reports nothing configured", () => {
  assert.strictEqual(affiliateStatus().configured, false);
});

console.log("\n── Amazon Associates ──");
reset();
process.env.AFF_AMAZON_TAG = "luka-20";
check("the tag is applied to an Amazon link", () => {
  const u = new URL(monetizeUrl("https://www.amazon.ae/dp/B0CHX1W1XY").url);
  assert.strictEqual(u.searchParams.get("tag"), "luka-20");
});
check("the credited network is reported", () => {
  assert.strictEqual(monetizeUrl("https://amazon.com/dp/X").network, "amazon");
});
check("someone else's tag is overwritten, not kept", () => {
  const u = new URL(monetizeUrl("https://amazon.com/dp/X?tag=rival-20").url);
  assert.strictEqual(u.searchParams.get("tag"), "luka-20");
});
check("existing product parameters survive", () => {
  const u = new URL(monetizeUrl("https://amazon.com/s?k=laptop&rh=n%3A123").url);
  assert.strictEqual(u.searchParams.get("k"), "laptop");
  assert.strictEqual(u.searchParams.get("rh"), "n:123");
});
check("upstream campaign tracking is stripped", () => {
  const u = new URL(monetizeUrl("https://amazon.com/dp/X?utm_source=blog&fbclid=abc").url);
  assert.strictEqual(u.searchParams.get("utm_source"), null);
  assert.strictEqual(u.searchParams.get("fbclid"), null);
});
check("a non-Amazon store is left alone", () => {
  assert.strictEqual(monetizeUrl("https://noon.com/uae-en/p/1").network, null);
});
check("a lookalike domain is NOT tagged", () => {
  assert.strictEqual(monetizeUrl("https://amazon.com.evil.test/dp/X").network, null);
});
check("a subdomain of a real marketplace is tagged", () => {
  assert.strictEqual(monetizeUrl("https://smile.amazon.com/dp/X").network, "amazon");
});

console.log("\n── per-marketplace tags ──");
reset();
process.env.AFF_AMAZON_TAG = "default-20";
process.env.AFF_AMAZON_TAGS = JSON.stringify({ "amazon.ae": "gulf-21" });
check("a marketplace-specific tag wins", () => {
  assert.strictEqual(new URL(monetizeUrl("https://amazon.ae/dp/X").url).searchParams.get("tag"), "gulf-21");
});
check("other marketplaces fall back to the default", () => {
  assert.strictEqual(new URL(monetizeUrl("https://amazon.com/dp/X").url).searchParams.get("tag"), "default-20");
});

console.log("\n── deeplink networks (Admitad / Awin / ArabClicks) ──");
reset();
process.env.AFF_RULES = JSON.stringify([
  { network: "admitad-noon", match: ["noon.com"], type: "deeplink",
    template: "https://ad.admitad.com/g/ABC/?ulp={url}" },
]);
check("the store URL is wrapped in the network redirect", () => {
  const r = monetizeUrl("https://www.noon.com/uae-en/p/999?x=1");
  assert.ok(r.url.startsWith("https://ad.admitad.com/g/ABC/?ulp="));
  assert.strictEqual(r.network, "admitad-noon");
});
check("the wrapped target round-trips exactly", () => {
  const r = monetizeUrl("https://www.noon.com/uae-en/p/999?x=1");
  const ulp = new URL(r.url).searchParams.get("ulp");
  assert.strictEqual(ulp, "https://www.noon.com/uae-en/p/999?x=1");
});
check("a malformed rule is ignored rather than crashing", () => {
  process.env.AFF_RULES = JSON.stringify([{ network: "broken" }]);
  assert.strictEqual(monetizeUrl("https://noon.com/p/1").network, null);
});
check("invalid JSON in AFF_RULES is survivable", () => {
  process.env.AFF_RULES = "{not json";
  assert.strictEqual(monetizeUrl("https://amazon.com/dp/X").network, null);
});

console.log("\n── malformed input ──");
reset();
process.env.AFF_AMAZON_TAG = "luka-20";
check("empty and junk URLs don't throw", () => {
  assert.strictEqual(monetizeUrl("").url, "");
  assert.strictEqual(monetizeUrl("not a url").network, null);
  assert.strictEqual(monetizeUrl("javascript:alert(1)").network, null);
});

console.log("\n── click links ──");
reset();
process.env.AFF_AMAZON_TAG = "luka-20";
check("a product link is wrapped in the click tracker", () => {
  const link = buildClickUrl({ url: "https://amazon.ae/dp/X", title: "Headphones", source: "chat" });
  assert.ok(link.startsWith("/api/go?"), link);
});
check("the tagged destination is recoverable from the link", () => {
  const link = buildClickUrl({ url: "https://amazon.ae/dp/X", title: "T" });
  const params = new URL(link, "https://luka.test").searchParams;
  const target = resolveTarget(params);
  assert.ok(target.ok, "target should resolve");
  assert.strictEqual(target.url.searchParams.get("tag"), "luka-20");
});
check("LUKA_PUBLIC_URL produces absolute links for Telegram", () => {
  process.env.LUKA_PUBLIC_URL = "https://luka.example.com/";
  assert.ok(buildClickUrl({ url: "https://amazon.ae/dp/X" })
    .startsWith("https://luka.example.com/api/go?"));
  delete process.env.LUKA_PUBLIC_URL;
});

console.log("\n── redirect safety ──");
reset();
const enc = (u) => Buffer.from(u, "utf8").toString("base64url");
check("an unknown host is refused (no secret configured)", () => {
  const p = new URLSearchParams({ u: enc("https://evil.test/phish") });
  assert.strictEqual(resolveTarget(p).ok, false);
});
check("a known store is allowed", () => {
  const p = new URLSearchParams({ u: enc("https://amazon.ae/dp/X") });
  assert.strictEqual(resolveTarget(p).ok, true);
});
check("a non-web scheme is refused", () => {
  const p = new URLSearchParams({ u: enc("javascript:alert(1)") });
  assert.strictEqual(resolveTarget(p).ok, false);
});
check("embedded credentials are refused", () => {
  const p = new URLSearchParams({ u: enc("https://amazon.ae@evil.test/x") });
  assert.strictEqual(resolveTarget(p).ok, false);
});
check("a missing target is refused", () => {
  assert.strictEqual(resolveTarget(new URLSearchParams()).ok, false);
});

console.log("\n── redirect safety with LUKA_LINK_SECRET ──");
reset();
process.env.LUKA_LINK_SECRET = "s3cret-value-for-testing";
process.env.AFF_AMAZON_TAG = "luka-20";
check("a link we signed is followed", () => {
  const link = buildClickUrl({ url: "https://amazon.ae/dp/X" });
  const p = new URL(link, "https://luka.test").searchParams;
  assert.ok(p.get("sig"), "expected a signature");
  assert.strictEqual(resolveTarget(p).ok, true);
});
check("a tampered destination is refused", () => {
  const link = buildClickUrl({ url: "https://amazon.ae/dp/X" });
  const p = new URL(link, "https://luka.test").searchParams;
  p.set("u", enc("https://evil.test/phish"));
  assert.strictEqual(resolveTarget(p).ok, false);
});
check("an unsigned link is refused even to a known store", () => {
  const p = new URLSearchParams({ u: enc("https://amazon.ae/dp/X") });
  assert.strictEqual(resolveTarget(p).ok, false);
});

console.log(`\n${process.exitCode ? "✗ FAILURES ABOVE" : "✓ all"} — ${passed} checks passed\n`);

rmSync(outDir, { recursive: true, force: true });
