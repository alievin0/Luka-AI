/**
 * Outbound link construction.
 *
 * Product links are not handed to the browser directly — they are wrapped in
 * `/api/go`, which records the click and then redirects to the affiliate-tagged
 * destination. That indirection is what makes click data possible, and it means
 * the affiliate tag is applied server-side where it cannot be stripped.
 *
 * A redirector that forwards to an arbitrary URL is an open redirect, useful
 * for phishing (a link on *your* domain that lands on an attacker's page). Two
 * independent guards prevent that, and a link is followed only if it passes at
 * least one:
 *
 *   1. A signature. When LUKA_LINK_SECRET is set, links we generate carry an
 *      HMAC; anything not signed by us is rejected outright.
 *   2. A destination allowlist. Hosts covered by a configured affiliate rule,
 *      well-known retailers, and LUKA_ALLOWED_REDIRECT_HOSTS entries.
 *
 * The allowlist alone keeps links working out of the box (including across
 * serverless instances that don't share an in-memory secret); setting the
 * secret is the stricter posture and is what the setup guide recommends.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getAffiliateRules, monetizeUrl } from "./affiliate";

/** Retailers Luka commonly finds, so links work before any program is set up. */
const KNOWN_STORES = [
  "amazon.com", "amazon.ae", "amazon.sa", "amazon.eg", "amazon.co.uk",
  "amazon.de", "amazon.fr", "amazon.it", "amazon.es", "amazon.nl",
  "amazon.com.tr", "amazon.ca", "amazon.co.jp", "amazon.in", "amazon.sg",
  "amazon.com.au", "amzn.to", "amzn.eu",
  "noon.com", "namshi.com", "jarir.com", "extra.com", "sharafdg.com",
  "carrefouruae.com", "carrefourjordan.com", "luluhypermarket.com",
  "aliexpress.com", "aliexpress.us", "ebay.com", "ebay.co.uk", "ebay.de",
  "walmart.com", "bestbuy.com", "target.com", "newegg.com", "etsy.com",
  "ikea.com", "apple.com", "samsung.com", "dell.com", "hp.com", "lenovo.com",
  "shein.com", "temu.com", "trendyol.com", "hepsiburada.com",
  "mdstore.jo", "smartbuy-me.com", "leaders.jo", "opensooq.com",
];

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function hostAllowed(hostname: string): boolean {
  const host = normalizeHost(hostname);

  const extra = (process.env.LUKA_ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map((h) => normalizeHost(h.trim()))
    .filter(Boolean);

  // Hosts named by configured affiliate rules are, by definition, stores the
  // operator intends to send traffic to.
  const ruleHosts: string[] = [];
  for (const rule of getAffiliateRules()) {
    for (const m of rule.match) ruleHosts.push(normalizeHost(m));
    if (rule.type === "deeplink") {
      // The network's own redirect domain is the actual destination here.
      try {
        ruleHosts.push(normalizeHost(new URL(rule.template.split("{")[0]).hostname));
      } catch {
        /* a template without a parseable prefix simply contributes no host */
      }
    }
  }

  return [...KNOWN_STORES, ...ruleHosts, ...extra].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function secret(): string | null {
  const value = process.env.LUKA_LINK_SECRET?.trim();
  return value ? value : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type ClickLinkInput = {
  url: string;
  title?: string;
  /** Where the link is being shown: "chat", "cart", "telegram", … */
  source?: string;
  session?: string;
};

/**
 * Wrap a product URL in the tracking redirector.
 *
 * Returns the monetized URL directly if the link can't be parsed or the click
 * route wouldn't accept it — a working link always beats a tracked dead one.
 */
export function buildClickUrl(input: ClickLinkInput): string {
  const monetized = monetizeUrl(input.url);
  if (!monetized.url) return input.url;

  let parsed: URL;
  try {
    parsed = new URL(monetized.url);
  } catch {
    return input.url;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return input.url;

  const key = secret();
  if (!key && !hostAllowed(parsed.hostname)) {
    // Unsigned and unrecognized: /api/go would reject it, so link straight out.
    return monetized.url;
  }

  const encoded = Buffer.from(monetized.url, "utf8").toString("base64url");
  const params = new URLSearchParams({ u: encoded });
  if (monetized.network) params.set("n", monetized.network);
  if (input.title) params.set("t", input.title.slice(0, 120));
  if (input.source) params.set("s", input.source);
  if (input.session) params.set("sid", input.session);
  if (key) params.set("sig", sign(encoded, key));

  const base = (process.env.LUKA_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}/api/go?${params.toString()}`;
}

export type ResolvedTarget =
  | { ok: true; url: URL }
  | { ok: false; reason: "missing" | "malformed" | "rejected" };

/** Validate and decode a `/api/go` request's destination. */
export function resolveTarget(params: URLSearchParams): ResolvedTarget {
  const encoded = params.get("u");
  if (!encoded) return { ok: false, reason: "missing" };

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Only ever follow real web links, and never one carrying embedded
  // credentials — `https://store.com@evil.example` reads as the store.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "rejected" };
  }
  if (url.username || url.password) return { ok: false, reason: "rejected" };

  const key = secret();
  if (key) {
    const provided = params.get("sig");
    if (!provided || !signaturesMatch(provided, sign(encoded, key))) {
      return { ok: false, reason: "rejected" };
    }
    return { ok: true, url };
  }

  if (!hostAllowed(url.hostname)) return { ok: false, reason: "rejected" };
  return { ok: true, url };
}
