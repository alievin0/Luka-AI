import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { lectureAllowed } from "../lectures";
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

type Tab = { name: string; path: string; label: string; glyph: string };

/**
 * Drawn by the tab navigator, so a press activates a screen that is already
 * mounted instead of rebuilding it. The record button is not a tab — it opens
 * a full-screen session — so it does its own paywall check here rather than
 * being handed down from whichever screen happens to be showing.
 */
export function TabBar(props: Partial<BottomTabBarProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { state, navigation } = props;

  const onRecord = async () => {
    if (await lectureAllowed()) router.push("/record");
    else router.push("/paywall");
  };

  const tabs: Tab[] = [
    { name: "index", path: "/", label: t(ui.tabHome), glyph: "⌂" },
    { name: "lectures", path: "/lectures", label: t(ui.tabLibrary), glyph: "▤" },
    { name: "tasks", path: "/tasks", label: t(ui.navTasks), glyph: "☑" },
    { name: "search", path: "/search", label: t(ui.tabSearch), glyph: "⌕" },
  ];

  const current = state ? state.routes[state.index]?.name : null;

  const go = (tab: Tab) => {
    if (state && navigation) {
      const route = state.routes.find((r) => r.name === tab.name);
      const focused = current === tab.name;
      const event = navigation.emit({ type: "tabPress", target: route?.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(tab.name);
      return;
    }
    router.navigate(tab.path as never);
  };

  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  const item = (tab: Tab) => {
    const active = current ? current === tab.name : pathname === tab.path;
    return (
      <Pressable
        key={tab.name}
        style={styles.item}
        onPress={() => go(tab)}
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
          onPress={() => void onRecord()}
          accessibilityRole="button"
          accessibilityLabel={t(ui.tabRecord)}
        >
          <LinearGradient
            colors={[GOLD_BRIGHT, GOLD, GOLD_DEEP]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={styles.record}
          >
            <Text style={styles.recordGlyph}>🎙</Text>
          </LinearGradient>
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

  recordWrap: { alignItems: "center", flex: 1, marginBottom: 6 },
  record: {
    width: 58,
    height: 58,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
    ...glow(GOLD, 18, 0.3),
  },
  recordGlyph: { fontSize: 23 },
});
