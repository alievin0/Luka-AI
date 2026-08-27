import { useWindowDimensions } from "react-native";
import { SP } from "./components/audio-theme";

/**
 * How much room the app has.
 *
 * Mahdar runs on a phone in a lecture hall and on a laptop in a library, and
 * those are not the same product with different margins. A phone needs the
 * record button under the thumb; a laptop needs somewhere to stand still, so
 * the destinations move to the side and stop competing with the content.
 *
 * The breakpoints are chosen from what fits rather than from device names:
 * below 600 there is no room beside the content at all, and below 900 a
 * sidebar with labels would take a third of the screen.
 */

export const BREAK = { tablet: 600, desktop: 900 } as const;

/**
 * The widest a column of prose is allowed to get.
 *
 * A transcript set across 1400 points is unreadable — the eye loses the line
 * on the way back. This is roughly 80 characters at our body size, which is
 * where typesetters have landed for about five hundred years.
 */
export const MAX_READING = 720;
/** Cards and grids can be wider than prose, but not unboundedly. */
export const MAX_CONTENT = 1040;

export type Layout = {
  width: number;
  height: number;
  /** Sidebar, no bottom bar. */
  desktop: boolean;
  /** Icon rail, no bottom bar. */
  tablet: boolean;
  /** Bottom bar with the record button in the middle. */
  phone: boolean;
  /** Page gutter — wider when there is width to spend. */
  gutter: number;
  /** How many cards fit across. */
  columns: number;
};

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const desktop = width >= BREAK.desktop;
  const tablet = !desktop && width >= BREAK.tablet;
  return {
    width,
    height,
    desktop,
    tablet,
    phone: !desktop && !tablet,
    gutter: desktop ? SP.section : tablet ? SP.xxl : SP.xl,
    columns: desktop ? 3 : tablet ? 2 : 1,
  };
}
