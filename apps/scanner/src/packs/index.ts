import Constants from "expo-constants";
import { PACKS } from "./registry";
import { dashlight } from "./dashlight";
import type { Pack } from "./types";

/** Resolved from app.config.ts `extra.scannerId` (set by the SCANNER env var). */
export const activePackId: string =
  (Constants.expoConfig?.extra?.scannerId as string) || "dashlight";

export const pack: Pack = PACKS[activePackId] ?? dashlight;

export { PACKS };
export * from "./types";
export { t, L, locale, isRTL, type Text } from "../i18n";
