import Constants from "expo-constants";
import { PACKS } from "./registry";
import { dashlight } from "./dashlight";
import type { Pack } from "./types";

/**
 * Which of the shipped apps this build is.
 *
 * Normally `app.config.ts` puts it in `extra.scannerId`, set from the SCANNER
 * env var. But `Constants.expoConfig` is not populated in every context — it
 * is absent when the app is rendered on the web, which is how these screens
 * get looked at during design review — and a missing value there silently
 * fell back to a different app than the one that was built. So the id is also
 * inlined at build time: Metro substitutes `EXPO_PUBLIC_*` into the bundle on
 * every platform, which makes it available even where the manifest is not.
 */
export const activePackId: string =
  (Constants.expoConfig?.extra?.scannerId as string) ||
  process.env.EXPO_PUBLIC_SCANNER ||
  "dashlight";

export const pack: Pack = PACKS[activePackId] ?? dashlight;

export { PACKS };
export * from "./types";
export { t, L, locale, isRTL, type Text } from "../i18n";
