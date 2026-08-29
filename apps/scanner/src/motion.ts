import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the person using the app has asked for less movement.
 *
 * Some people get motion sick from a spinning element; some find it makes
 * text unreadable while it moves. The system already knows — every phone has
 * this switch — and honouring it costs one hook. An app that keeps spinning
 * anyway is telling those people it did not think about them.
 *
 * Defaults to false, so a device that cannot answer still gets the design as
 * drawn rather than a permanently frozen one.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => live && setReduced(on))
      .catch(() => {});
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) =>
      setReduced(on),
    );
    return () => {
      live = false;
      listener.remove();
    };
  }, []);

  return reduced;
}
