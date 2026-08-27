import Constants from "expo-constants";
import { locale } from "./i18n";
import type { ScanResult } from "./packs";

/**
 * Resolves the scan API origin.
 *
 * Production: set EXPO_PUBLIC_API_URL to the deployed origin (EAS Hosting,
 * Vercel, wherever the `app/api/scan+api.ts` route is served from).
 * Dev: derived from the Expo dev-server host so a phone on the same Wi-Fi
 * reaches your laptop instead of its own localhost.
 */
function apiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ?? (Constants as any).expoGoConfig?.debuggerHost;
  if (hostUri) return `http://${String(hostUri).split("/")[0]}`;

  return "http://localhost:8081";
}

export class ScanError extends Error {}

export async function scanImage(input: {
  packId: string;
  base64: string;
  currency: string;
  profile: string;
}): Promise<ScanResult> {
  const payload = { ...input, locale };
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ScanError("ما قدرنا نوصل للخادم. تأكد من اتصالك بالإنترنت وجرّب كمان مرة.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ScanError(
      (body as { error?: string } | null)?.error ??
        "صار خطأ أثناء التحليل. جرّب كمان مرة.",
    );
  }

  return (await res.json()) as ScanResult;
}
