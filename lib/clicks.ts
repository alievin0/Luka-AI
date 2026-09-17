/**
 * Outbound click tracking.
 *
 * Affiliate networks report conversions, but only days later and without
 * telling you which recommendation produced them. Logging clicks on our side
 * is what makes "which products actually earn?" answerable, so the operator
 * can push more of what works.
 *
 * Storage is in-memory by default (per server instance — it resets on deploy).
 * Set LUKA_CLICK_LOG to a writable file path to also append newline-delimited
 * JSON that survives restarts.
 */

import { appendFile } from "node:fs/promises";

export type ClickRecord = {
  at: string;
  /** Destination host, e.g. "amazon.ae". */
  host: string;
  /** Affiliate program credited, or null for an untagged link. */
  network: string | null;
  /** Product title, when the click came from a product card. */
  title?: string;
  /** Where the click happened: "chat", "cart", "telegram", … */
  source?: string;
  /** Opaque session id, so repeat clicks from one shopper are distinguishable. */
  session?: string;
};

const MAX_RECENT = 500;
const recent: ClickRecord[] = [];

export function recordClick(record: ClickRecord): void {
  recent.push(record);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);

  const logPath = process.env.LUKA_CLICK_LOG?.trim();
  if (logPath) {
    // Fire-and-forget: a logging failure must never break the redirect.
    appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8").catch((err) => {
      console.warn("[clicks] could not append to LUKA_CLICK_LOG:", err?.message ?? err);
    });
  }
}

export function getRecentClicks(limit = 100): ClickRecord[] {
  return recent.slice(-Math.max(1, limit)).reverse();
}

export type ClickStats = {
  total: number;
  byNetwork: Array<{ network: string; clicks: number }>;
  byHost: Array<{ host: string; clicks: number }>;
  topProducts: Array<{ title: string; clicks: number }>;
};

export function getClickStats(): ClickStats {
  const networks = new Map<string, number>();
  const hosts = new Map<string, number>();
  const products = new Map<string, number>();

  for (const click of recent) {
    const network = click.network ?? "(untagged)";
    networks.set(network, (networks.get(network) ?? 0) + 1);
    hosts.set(click.host, (hosts.get(click.host) ?? 0) + 1);
    if (click.title) products.set(click.title, (products.get(click.title) ?? 0) + 1);
  }

  const rank = <K extends string>(map: Map<string, number>, key: K) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, clicks]) => ({ [key]: name, clicks })) as Array<
      Record<K, string> & { clicks: number }
    >;

  return {
    total: recent.length,
    byNetwork: rank(networks, "network"),
    byHost: rank(hosts, "host"),
    topProducts: rank(products, "title").slice(0, 20),
  };
}
