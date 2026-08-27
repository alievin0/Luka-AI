import { dashlight } from "./dashlight";
import { bugscan } from "./bugscan";
import { goldscan } from "./goldscan";
import type { ScannerPack } from "./types";

/** Server-safe pack lookup — no Expo runtime imports. */
export const PACKS: Record<string, ScannerPack> = { dashlight, bugscan, goldscan };
