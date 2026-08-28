import { useEffect, useState } from "react";
import { I18nManager, View, ActivityIndicator } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { theme } from "../src/theme";
import { isOnboarded } from "../src/storage";
import { pack, isAudio, isProgram, isScanner } from "../src/packs";
import { t, isRTL } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { initPurchases } from "../src/purchases";
import { syncTrialEndingReminder } from "../src/reminders";
import { useAppFonts } from "../src/type";
import { recoverInterruptedLectures } from "../src/lectures";
import { useReducedMotion } from "../src/motion";

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
  const fontsReady = useAppFonts();
  const stillness = useReducedMotion();

  useEffect(() => {
    // Awaited, not fired and forgotten: the reminder reads the entitlement,
    // and asking before RevenueCat is configured answers "no trial" every
    // time. Re-synced on every launch because auto-renewal can be turned off
    // outside the app, and a warning about a charge that is no longer coming
    // is the same false claim as promising a trial nobody can have.
    initPurchases().then(() => void syncTrialEndingReminder());
    // A lecture still marked "recording" at launch is one the app was killed
    // during; without this the home list shows it as live forever.
    if (isAudio(pack)) recoverInterruptedLectures();
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

  if (!ready || !fontsReady) {
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
          /* A push that appears instantly reads as the screen having been
             replaced rather than entered. Someone who has asked for less
             movement gets a fade instead of nothing. */
          animation: stillness ? "fade" : "slide_from_right",
          /* 250ms is the band where a transition reads as motion without
             reading as a wait: under about 180 it snaps, over about 350 the
             user is watching an animation instead of using an app. Android's
             default is slower than that, so it is set rather than inherited. */
          animationDuration: 250,
        }}
      >
        {/* The tab destinations live in the (tabs) group and are drawn by
            their own navigator; everything below is pushed over them. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        {/* The answer does not slide in from the side like another page in a
            list. It replaces the photo that produced it, so it fades. */}
        <Stack.Screen name="result" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="change-country" options={{ headerShown: false }} />
        <Stack.Screen name="light/[id]" options={{ headerShown: false }} />
        <Stack.Screen
          name="paywall"
          options={{ presentation: "modal", headerShown: false }}
        />
        {/* The scanner screens paint their own header and their own bottom
            bar, so a stack header over them would be a second, competing set
            of chrome. Mahdar's shell does the same. */}
        <Stack.Screen name="session" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="price-check" options={{ title: t(ui.priceCheck) }} />
        <Stack.Screen name="plan" options={{ title: isProgram(pack) ? t(pack.nouns.plan) : t(ui.noPlan) }} />
        {/* The lecture screens paint their own chrome on a near-black ground;
            a stack header over it would break the design in two. */}
        <Stack.Screen
          name="record"
          options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }}
        />
        <Stack.Screen
          name="analyzing"
          options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }}
        />
        <Stack.Screen name="lecture" options={{ headerShown: false }} />
        <Stack.Screen name="paste" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
