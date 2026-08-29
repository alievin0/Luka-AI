/**
 * The Dash Light design's own artwork.
 *
 * These are the exact files from the design, not redrawings of them: the
 * three grade marks, the five benefit marks, and the night road behind the
 * header. Metro resolves `require` at build time, so each has to be named
 * here to be bundled at all.
 *
 * Unlike the dashboard pictograms in `symbols.ts`, these are **not** white on
 * transparent and must not be tinted — the grade marks arrive already red,
 * amber and green, and the wallet is deliberately amber where the other four
 * benefit marks are white. Tinting them would flatten a distinction the
 * design makes on purpose.
 *
 * Sizes are the element boxes from the design file, converted from its
 * 711-wide canvas to points on a 390-wide phone.
 */
const SCALE = 711 / 390;

const at = (w: number, h: number) => ({ width: w / SCALE, height: h / SCALE });

export const DESIGN = {
  gradeStop: { source: require("../assets/dashlight/grade-stop.png"), ...at(115, 101) },
  gradeCaution: { source: require("../assets/dashlight/grade-caution.png"), ...at(97, 84) },
  gradeOk: { source: require("../assets/dashlight/grade-ok.png"), ...at(115, 84) },

  benefitSeconds: { source: require("../assets/dashlight/benefit-seconds.png"), ...at(66, 68) },
  benefitCar: { source: require("../assets/dashlight/benefit-car.png"), ...at(66, 51) },
  benefitGuide: { source: require("../assets/dashlight/benefit-guide.png"), ...at(65, 51) },
  benefitCost: { source: require("../assets/dashlight/benefit-cost.png"), ...at(66, 68) },
  benefitSteps: { source: require("../assets/dashlight/benefit-steps.png"), ...at(50, 51) },

  /** The night road. It sits behind the header at low alpha in the file
   *  itself, so it needs no opacity of its own here. */
  scene: { source: require("../assets/dashlight/scene.png"), ...at(711, 736), top: 83 / SCALE },
} as const;

export type DesignAsset = keyof typeof DESIGN;

/** The marks a pack's paywall bullets refer to, by the name they use. */
export const designAsset = (name?: string) =>
  name && name in DESIGN ? DESIGN[name as DesignAsset] : undefined;
