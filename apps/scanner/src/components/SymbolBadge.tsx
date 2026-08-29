import { View, Image, StyleSheet } from "react-native";
import { symbolFor } from "../symbols";

/**
 * The warning light itself.
 *
 * This app exists because someone is looking at a shape they don't recognise.
 * Showing them a coloured dot and a paragraph asks them to do the matching in
 * their head; showing them the symbol lets them match it at a glance, which is
 * the entire job.
 *
 * The asset is a white mask and the colour comes from the entry's severity, so
 * the two can never disagree — a critical light cannot render amber because
 * someone edited one of them and not the other.
 */
export function SymbolBadge({
  glyph,
  colour,
  background,
  size = 34,
}: {
  glyph?: string;
  colour: string;
  background?: string;
  size?: number;
}) {
  const source = symbolFor(glyph);

  return (
    <View
      style={[
        styles.badge,
        {
          width: size + 14,
          height: size + 14,
          borderRadius: (size + 14) / 4,
          backgroundColor: background ?? "transparent",
        },
      ]}
    >
      {source ? (
        <Image
          source={source}
          style={{ width: size, height: size, tintColor: colour }}
          resizeMode="contain"
          // The symbol carries the meaning; the label beside it already says
          // what it is, so announcing it twice is noise for a screen reader.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : (
        <View style={[styles.fallback, { backgroundColor: colour }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center" },
  fallback: { width: 10, height: 10, borderRadius: 5 },
});
