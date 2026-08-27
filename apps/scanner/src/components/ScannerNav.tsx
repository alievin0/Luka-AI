import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pack, isScanner } from "../packs";
import { t } from "../i18n";
import { ui } from "../i18n/ui";
import { BG, BORDER, TEXT, TEXT_FAINT, ACCENT, FONT, TYPE, SP, TAP } from "../scanner-ui";

/**
 * The way back to the camera.
 *
 * The camera screen does not carry this bar — it is full-bleed and its only
 * job is framing a symbol. Everywhere else does, because the guide, the
 * history and the settings are places a driver browses between emergencies,
 * and from any of them the fastest route back to scanning should be one tap
 * rather than a chain of back gestures.
 */

type Item = { path: string; label: string; glyph: string };

export function ScannerNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const items: Item[] = [
    { path: "/", label: t(ui.scanTab), glyph: "◎" },
    ...(isScanner(pack) && pack.library?.length
      ? [
          {
            path: "/library",
            label: pack.libraryTitle ? t(pack.libraryTitle) : t(ui.guide),
            glyph: "▤",
          },
        ]
      : []),
    { path: "/history", label: t(ui.history), glyph: "◷" },
    { path: "/settings", label: t(ui.settings), glyph: "⚙" },
  ];

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
      {items.map((item) => {
        const active = pathname === item.path;
        return (
          <Pressable
            key={item.path}
            onPress={() => router.replace(item.path as never)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            style={styles.item}
          >
            <Text style={[styles.glyph, active && { color: ACCENT }]}>{item.glyph}</Text>
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** What scrolling content must clear so the bar never covers the last row. */
export const NAV_CLEARANCE = 84;

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: SP.sm,
  },
  item: { flex: 1, minHeight: TAP, alignItems: "center", justifyContent: "center", gap: 3 },
  glyph: { color: TEXT_FAINT, fontSize: 19 },
  label: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.regular },
  labelActive: { color: TEXT, fontFamily: FONT.medium },
});
