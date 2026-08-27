import { apiBase } from "./api-base";
import { locale, remote, t } from "./i18n";
import { apiError } from "./i18n/errors";
import { ui } from "./i18n/ui";
import type { ScanResult } from "./packs";

export class ScanError extends Error {}

export async function scanImage(input: {
  packId: string;
  base64: string;
  currency: string;
  profile: string;
}): Promise<ScanResult> {
  const payload = { ...input, locale };

  // Not "offline": a build that shipped without EXPO_PUBLIC_API_URL has no
  // server to be offline from, and telling the driver to check their
  // connection would send them looking in the wrong place.
  const base = apiBase();
  if (!base) throw new ScanError(t(apiError.notConfigured));

  let res: Response;
  try {
    res = await fetch(`${base}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ScanError(t(ui.offline));
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    // The route sends a whole Text pair; the device picks the language.
    throw new ScanError(remote(body?.error) ?? t(ui.serverError));
  }

  return (await res.json()) as ScanResult;
}
