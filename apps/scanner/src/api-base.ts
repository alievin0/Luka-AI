import Constants from "expo-constants";

/**
 * Where the API routes are served from.
 *
 * The scan, analyse, transcribe and ask routes live in `app/api/*+api.ts` and
 * are served by the Expo server output — a deployment separate from the app
 * bundle. Three ways to find it, in order:
 *
 *   1. `EXPO_PUBLIC_API_URL`, inlined by Metro at build time. This is the only
 *      one that works in a shipped app.
 *   2. The Expo dev-server host, so a phone on the same Wi-Fi reaches the
 *      laptop running `expo start` rather than its own localhost.
 *   3. `localhost:8081`, for a simulator or the browser during design review.
 *
 * The third one used to apply in release builds too, which meant a build with
 * `EXPO_PUBLIC_API_URL` unset pointed every request at the phone itself and
 * failed in a way indistinguishable from a bad connection — the user is told
 * to check their network, and the network is fine. Outside `__DEV__` there is
 * no such thing as a sensible default, so this returns `null` instead and the
 * callers report a server that was never configured. `app.config.ts` also
 * refuses an EAS production build without it, so this should be unreachable.
 */
export function apiBase(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ?? (Constants as any).expoGoConfig?.debuggerHost;
  if (hostUri) return `http://${String(hostUri).split("/")[0]}`;

  return __DEV__ ? "http://localhost:8081" : null;
}
