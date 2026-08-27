import { useEffect, useState } from "react";
import { I18nManager, View, ActivityIndicator } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { theme } from "../src/theme";
import { isOnboarded } from "../src/storage";
import { pack } from "../src/scanners";
import { initPurchases } from "../src/purchases";

// The whole UI is Arabic — force RTL before the first render.
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
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
        <Stack.Screen name="result" options={{ title: "النتيجة" }} />
        <Stack.Screen name="history" options={{ title: "الفحوصات السابقة" }} />
        <Stack.Screen name="library" options={{ title: pack.libraryTitle ?? "الدليل" }} />
        <Stack.Screen name="settings" options={{ title: "الإعدادات" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
