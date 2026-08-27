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

type Item = { name: string; path: string; label: string; icon: React.ComponentProps<typeof Feather>["name"] };

export function ScannerNav(props: Partial<BottomTabBarProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { state, navigation } = props;

  const items: Item[] = [
    { name: "index", path: "/", label: t(ui.scanTab), icon: "camera" },
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
          const scan = item.name === "index";
          return (
            <Pressable
              key={item.name}
              onPress={() => go(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={styles.item}
            >
              {scan ? (
                /* Amber, deliberately, and the one place in these apps where
                   it is. The rule everywhere else is that amber is the caution
                   grade and may not double as an action, because a driver who
                   mistakes a button for a warning is the failure this app
                   cannot afford. A navigation affordance carries no severity,
                   so the rule does not reach it — do not "correct" this. */
                <View style={styles.ring}>
                  <Feather name="maximize" size={20} color={ACCENT} />
                </View>
              ) : (
                <Feather name={item.icon} size={20} color={active ? ACCENT : TEXT_FAINT} />
              )}
              <Text
                style={[styles.label, (active || scan) && styles.labelOn]}
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
export const NAV_CLEARANCE = 112;

const styles = StyleSheet.create({
  /* The bar floats. Its own view is padding and nothing else, so the ground
     and whatever is scrolling over it show through around the pill. */
  wrap: { paddingHorizontal: 32, paddingTop: 4, backgroundColor: "transparent" },
  pill: {
    flexDirection: "row",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 30,
    paddingVertical: 8,
    /* Bottom-aligned, which is what puts all four labels on one line while
       the taller scan ring rises above the other three. */
    alignItems: "flex-end",
  },
  item: { flex: 1, minHeight: TAP, alignItems: "center", gap: 3 },
  ring: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.regular },
  labelOn: { color: ACCENT, fontFamily: FONT.medium },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent" },
  dotOn: { backgroundColor: ACCENT },
});
