import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { pack, isScanner } from "../packs";
import { t } from "../i18n";
import { ui } from "../i18n/ui";
import { SURFACE, BORDER, TEXT_FAINT, ACCENT, FONT, TYPE, TAP } from "../scanner-ui";

/**
 * The way back to the camera.
 *
 * The camera screen does not carry this bar — it is full-bleed and its only
 * job is framing a symbol. Everywhere else does, because the guide, the
 * history and the settings are places a driver browses between emergencies.
 *
 * Rendered as the tab navigator's own bar, so a press activates a screen that
 * is already mounted rather than rebuilding it. The router fallback is for the
 * one case where the bar is drawn outside the navigator.
 */

/**
 * The tab bar's own palette and metrics, as the design specifies them.
 *
 * Three of these sit within a few percent of tokens the app already has —
 * accent #F2A33C, surface #182028, ground #0C0E13 — close enough that no eye
 * separates them. They are written out rather than mapped onto those tokens so
 * the bar matches its spec exactly and the difference is visible here rather
 * than buried. The one that genuinely differs is the inactive grey: #8B949E
 * against the app's #69717F, which is a real step lighter.
 */
const SPEC = {
  accent: "#F5A623",
  idle: "#8B949E",
  pill: "#1A2128",
  height: 72,
  radius: 24,
  inset: 20,
} as const;

type Item = { name: string; path: string; label: string; icon: React.ComponentProps<typeof Feather>["name"] };

export function ScannerNav(props: Partial<BottomTabBarProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { state, navigation } = props;

  const items: Item[] = [
    /* The reticle, not a camera: the spec draws the brackets the viewfinder
       itself uses, so the tab and the thing it opens are the same mark. */
    { name: "index", path: "/", label: t(ui.scanTab), icon: "maximize" },
    ...(isScanner(pack) && pack.library?.length
      ? [
          {
            name: "library",
            path: "/library",
            label: pack.libraryTitle ? t(pack.libraryTitle) : t(ui.guide),
            icon: "book-open" as const,
          },
        ]
      : []),
    { name: "history", path: "/history", label: t(ui.history), icon: "clock" },
    { name: "settings", path: "/settings", label: t(ui.settings), icon: "settings" },
  ];

  const current = state ? state.routes[state.index]?.name : null;

  const go = (item: Item) => {
    if (state && navigation) {
      const route = state.routes.find((r) => r.name === item.name);
      const focused = current === item.name;
      const event = navigation.emit({ type: "tabPress", target: route?.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(item.name);
      return;
    }
    router.navigate(item.path as never);
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.pill}>
        {items.map((item) => {
          const active = current ? current === item.name : pathname === item.path;
          return (
            <Pressable
              key={item.name}
              onPress={() => go(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={styles.item}
            >
              <Feather
                name={item.icon}
                size={24}
                color={active ? SPEC.accent : SPEC.idle}
              />
              <Text
                style={[styles.label, active && styles.labelOn]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
              {/* Which tab you are on, marked by shape as well as by colour so
                  it survives a colour-blind eye and a sunlit screen. */}
              <View style={[styles.dot, active && styles.dotOn]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** What scrolling content must clear so the bar never covers the last row. */
export const NAV_CLEARANCE = 104;

const styles = StyleSheet.create({
  /* The bar floats. Its own view is padding and nothing else, so the ground
     and whatever is scrolling over it show through around the pill. */
  wrap: { paddingHorizontal: 32, paddingTop: 2, backgroundColor: "transparent" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    height: SPEC.height,
    backgroundColor: SPEC.pill,
    borderRadius: SPEC.radius,
    paddingHorizontal: SPEC.inset,
    /* A hairline, not a stroke. Around a floating surface a full border reads
       as a drawn box rather than as where the surface ends. */
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  item: { flex: 1, minHeight: TAP, alignItems: "center", justifyContent: "center", gap: 4 },
  label: { color: SPEC.idle, ...TYPE.small, fontFamily: FONT.regular },
  labelOn: { color: SPEC.accent, fontFamily: FONT.medium },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent" },
  dotOn: { backgroundColor: SPEC.accent },
});
