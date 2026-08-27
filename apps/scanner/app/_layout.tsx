import { useEffect, useState } from "react";
import { I18nManager, View, ActivityIndicator } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { theme } from "../src/theme";
import { isOnboarded } from "../src/storage";
import { pack, isProgram, isScanner } from "../src/packs";
import { t, isRTL } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { initPurchases } from "../src/purchases";

// Layout direction follows the device language, not the app. Forcing RTL
// unconditionally would mirror the entire English UI.
I18nManager.allowRTL(true);
if (I18nManager.isRTL !== isRTL) {
  I18nManager.forceRTL(isRTL);
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initPurchases();
  }, []);

  // Re-read on every navigation rather than caching once at mount: finishing
  // onboarding writes to storage and navigates, and a cached `false` here
  // would bounce the user straight back to onboarding forever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const done = await isOnboarded();
      if (cancelled) return;
      if (!done && segments[0] !== "onboarding") {
        router.replace("/onboarding");
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: "center" }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: "600" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen
          name="paywall"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen name="result" options={{ title: t(ui.result) }} />
        <Stack.Screen name="history" options={{ title: t(ui.pastScans) }} />
        <Stack.Screen
          name="library"
          options={{ title: isScanner(pack) && pack.libraryTitle ? t(pack.libraryTitle) : t(ui.guide) }}
        />
        <Stack.Screen name="settings" options={{ title: t(ui.settings) }} />
        <Stack.Screen name="session" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="plan" options={{ title: isProgram(pack) ? t(pack.nouns.plan) : t(ui.noPlan) }} />
      </Stack>
    </SafeAreaProvider>
  );
}
