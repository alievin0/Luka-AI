import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { t } from "../i18n";
import { ui } from "../i18n/ui";
import { FONTS, SCALE } from "../type";
import { GOLD, GOLD_BRIGHT, GOLD_DEEP, INK, TEXT_FAINT, SP, RADIUS, glow } from "./audio-theme";

/**
 * The application shell.
 *
 * Until now every screen was a push onto one stack, so the app had no shape:
 * a student could not tell where they were or move sideways between their
 * lectures, their deadlines and today. Three destinations is the whole app —
 * more would be navigation for its own sake.
 *
 * Recording is not one of them. It is the thing the app is for, it starts a
 * full-screen session rather than a place you browse, and it belongs under
 * the thumb — so it sits raised in the middle rather than pretending to be a
 * fourth tab.
 */

type Tab = { path: string; label: string; glyph: string };

export function TabBar({ onRecord }: { onRecord: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const tabs: Tab[] = [
    { path: "/", label: t(ui.tabHome), glyph: "◈" },
    { path: "/lectures", label: t(ui.tabLibrary), glyph: "◫" },
    { path: "/tasks", label: t(ui.navTasks), glyph: "◪" },
  ];

  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  const item = (tab: Tab) => {
    const active = pathname === tab.path;
    return (
      <Pressable
        key={tab.path}
        style={styles.item}
        onPress={() => router.replace(tab.path as never)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={tab.label}
        hitSlop={6}
      >
        <Text style={[styles.glyph, active && styles.glyphActive]}>{tab.glyph}</Text>
        <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
          {tab.label}
        </Text>
        {/* The active mark is a shape as well as a colour, so the current tab
            is still legible without relying on the gold. */}
        <View style={[styles.pip, active && styles.pipActive]} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
      <LinearGradient
        colors={["rgba(14,13,11,0)", "rgba(14,13,11,0.92)", INK]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.row}>
        {left.map(item)}

        <Pressable
          style={({ pressed }) => [styles.recordWrap, pressed && { transform: [{ scale: 0.94 }] }]}
          onPress={onRecord}
          accessibilityRole="button"
          accessibilityLabel={t(ui.tabRecord)}
        >
          <LinearGradient
            colors={[GOLD_BRIGHT, GOLD, GOLD_DEEP]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={styles.record}
          >
            <View style={styles.recordDot} />
          </LinearGradient>
          <Text style={styles.recordLabel} numberOfLines={1}>
            {t(ui.tabRecord)}
          </Text>
        </Pressable>

        {right.map(item)}
      </View>
    </View>
  );
}

/** Height the scrolling content must clear so the bar never covers the last row. */
export const TAB_CLEARANCE = 104;

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: SP.xl },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    paddingHorizontal: SP.md,
  },

  item: { alignItems: "center", gap: 3, flex: 1, paddingVertical: SP.xs },
  glyph: { color: "#4E4838", fontSize: 17 },
  glyphActive: { color: GOLD },
  label: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body },
  labelActive: { color: "#D9CFB6", fontFamily: FONTS.bodyMedium },
  pip: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent", marginTop: 1 },
  pipActive: { backgroundColor: GOLD },

  recordWrap: { alignItems: "center", gap: 5, flex: 1, marginBottom: 2 },
  record: {
    width: 54,
    height: 54,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
    ...glow(GOLD, 18, 0.3),
  },
  recordDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: "#8C2F22" },
  recordLabel: { color: "#C7BB9C", fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },
});
