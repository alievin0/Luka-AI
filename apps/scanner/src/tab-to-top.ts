import { useEffect, useRef } from "react";
import type { FlatList } from "react-native";
import { useNavigation } from "expo-router";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

/**
 * Tapping the tab you are already on takes you back to the top of it.
 *
 * Both bottom bars already emit `tabPress` before they decide whether to
 * navigate, and both stop short when the tab is the focused one — so the
 * press on the current tab has always produced an event and never an effect.
 * The guide is forty-eight entries long; reaching the top of it meant
 * scrolling the whole way back.
 *
 * The listener belongs to the screen rather than to the bar because only the
 * screen knows what "the top" is, and because a bar that scrolled its
 * children would have to hold a ref to each of them.
 */
export function useTabToTop<T>() {
  const list = useRef<FlatList<T>>(null);
  const navigation = useNavigation<BottomTabNavigationProp<Record<string, undefined>>>();

  useEffect(() => {
    const unsubscribe = navigation.addListener("tabPress", () => {
      /* The bar emits on every press, including the one that brings you to
         this screen from another tab. That press should land you where you
         left off, not at the top — only the press on the tab already showing
         is the one this is for. */
      if (navigation.isFocused()) list.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return unsubscribe;
  }, [navigation]);

  return list;
}
