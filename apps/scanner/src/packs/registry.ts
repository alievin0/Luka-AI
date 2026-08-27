import { dashlight } from "./dashlight";
import { bugscan } from "./bugscan";
import { goldscan } from "./goldscan";
import { womensfit } from "./womensfit";
import { dogtrain } from "./dogtrain";
import { mahdar } from "./mahdar";
import type { Pack, ScannerPack } from "./types";

/** Server-safe pack lookup — no Expo runtime imports. */
export const PACKS: Record<string, Pack> = {
  dashlight,
  bugscan,
  goldscan,
  womensfit,
  dogtrain,
  mahdar,
};

/** The scan API only ever serves scanner packs. */
export const SCANNER_PACKS: Record<string, ScannerPack> = Object.fromEntries(
  Object.entries(PACKS).filter(([, p]) => p.kind === "scanner"),
) as Record<string, ScannerPack>;
