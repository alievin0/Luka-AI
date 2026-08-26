import Constants from "expo-constants";
import { PACKS } from "./registry";
import { dashlight } from "./dashlight";
import type { ScannerPack } from "./types";

/** Resolved from app.config.ts `extra.scannerId` (set by the SCANNER env var). */
export const activePackId: string =
  (Constants.expoConfig?.extra?.scannerId as string) || "dashlight";

export const pack: ScannerPack = PACKS[activePackId] ?? dashlight;

export { PACKS };
export * from "./types";
