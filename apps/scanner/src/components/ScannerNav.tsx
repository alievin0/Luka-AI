import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { pack, isScanner } from "../packs";
import { t } from "../i18n";
import { ui } from "../i18n/ui";
import { BG, BORDER, TEXT, TEXT_FAINT, ACCENT, FONT, TYPE, SP, TAP } from "../scanner-ui";

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
    /* The reticle, not a camera: the same four brackets the viewfinder draws,
       so the tab and the thing it opens carry one mark. */
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
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
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
            {/* The active tab is marked by a rule above it as well as by
                colour, so which one you are on survives a colour-blind eye
                and a sunlit screen. */}
            <View style={[styles.mark, active && styles.markOn]} />
            <Feather name={item.icon} size={20} color={active ? ACCENT : TEXT_FAINT} />
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
export const NAV_CLEARANCE = 80;

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  /* TAP is 44, the smallest a target may be, and the bar sits exactly on it:
     with 48 entries in the guide every point above that is a row nobody
     sees. */
  item: { flex: 1, minHeight: TAP, alignItems: "center", justifyContent: "center", gap: 3 },
  mark: {
    position: "absolute",
    top: 0,
    height: 2,
    width: 28,
    borderRadius: 1,
    backgroundColor: "transparent",
  },
  markOn: { backgroundColor: ACCENT },
  label: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.regular },
  labelActive: { color: TEXT, fontFamily: FONT.medium },
});
