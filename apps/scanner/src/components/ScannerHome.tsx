import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  Animated,
  Easing,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { activePackId, type ScannerPack } from "../packs";
import {
  FREE_SCANS,
  addToHistory,
  bumpScanCount,
  currencyFor,
  getProfile,
  getScanCount,
  profileSummary,
} from "../storage";
import { scanImage, ScanError } from "../api";
import { isPro } from "../purchases";
import { t, fill } from "../i18n";
import { ui } from "../i18n/ui";
import { useReducedMotion } from "../motion";
import {
  BG,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  ACCENT,
  ACTION,
  ACTION_TEXT,
  FONT,
  TYPE,
  SP,
  RADIUS,
  TAP,
} from "../scanner-ui";
import { Pill, Button } from "./scanner-kit";

/**
 * The camera is the app.
 *
 * It opens straight into the viewfinder — no feed, no menu, no welcome —
 * because the only reason anyone launches this is that a light just came on.
 * Everything else is a low-contrast pill along the top that gets out of the
 * way of the one thing that matters: framing the symbol and pressing the
 * button.
 */

/**
 * Downscale + compress before upload. A full-res phone photo is several MB
 * and adds seconds of latency for no accuracy gain — 1024px wide is plenty
 * for reading a dashboard symbol or an insect.
 */
async function prepare(uri: string) {
  const context = ImageManipulator.ImageManipulator.manipulate(uri).resize({
    width: 1024,
  });
  const image = await context.renderAsync();
  const result = await image.saveAsync({
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return { uri: result.uri, base64: result.base64 ?? "" };
}

/** The stages of a scan, in the order they actually happen. */
type Stage = "preparing" | "reading" | null;

export function ScannerHome({ pack }: { pack: ScannerPack }) {
  const router = useRouter();
  /** Arriving with pick=1 means the driver chose "from gallery" on a photo we
   *  could not read; open the picker for them rather than making them find it
   *  again in the corner of the camera screen. */
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const openedPicker = useRef(false);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [scansLeft, setScansLeft] = useState<number | null>(null);

  const busy = stage !== null;

  const refreshQuota = async () => {
    if (await isPro()) return setScansLeft(Infinity);
    setScansLeft(Math.max(0, FREE_SCANS - (await getScanCount())));
  };

  useEffect(() => {
    refreshQuota();
  }, []);

  const run = async (uri: string) => {
    setShot(uri);
    setStage("preparing");
    try {
      const { uri: readyUri, base64 } = await prepare(uri);
      const profile = await getProfile();
      setStage("reading");

      const result = await scanImage({
        packId: activePackId,
        base64,
        currency: currencyFor(profile),
        profile: profileSummary(profile),
      });

      Haptics.notificationAsync(
        result.detected
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );

      /* A photo we could not read is still a scan the driver made, so it is
       * saved and shown on the result screen with instructions for retaking
       * it — rather than thrown away behind an alert they have to dismiss
       * before they can see what went wrong. It does not spend the quota. */
      if (result.detected) await bumpScanCount();

      const entry = { id: String(Date.now()), at: Date.now(), imageUri: readyUri, result };
      await addToHistory(entry);
      await refreshQuota();
      router.push({ params: { id: entry.id }, pathname: "/result" });
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        t(ui.somethingWrong),
        error instanceof ScanError ? error.message : t(ui.tryAgain),
      );
    } finally {
      setStage(null);
      setShot(null);
    }
  };

  const guardQuota = async () => {
    if (await isPro()) return true;
    if ((await getScanCount()) >= FREE_SCANS) {
      router.push("/paywall");
      return false;
    }
    return true;
  };

  const shoot = async () => {
    if (busy || !cameraRef.current) return;
    if (!(await guardQuota())) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
    if (photo?.uri) await run(photo.uri);
  };

  const pickFromLibrary = async () => {
    if (busy) return;
    if (!(await guardQuota())) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!picked.canceled && picked.assets[0]?.uri) await run(picked.assets[0].uri);
  };

  /* Opened once per arrival, so returning to the camera later does not keep
   * springing the picker open. */
  useEffect(() => {
    if (pick !== "1" || openedPicker.current || !permission) return;
    openedPicker.current = true;
    void pickFromLibrary();
    // pickFromLibrary is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, permission]);

  if (!permission) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={TEXT_SOFT} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permission} edges={["top", "bottom"]}>
        <Text style={styles.permTitle}>{t(ui.cameraNeeded)}</Text>
        <Text style={styles.permBody}>{t(pack.captureHint)}</Text>
        <Button label={t(ui.allowCamera)} variant="primary" block onPress={requestPermission} />
        <Pressable onPress={pickFromLibrary} hitSlop={10} accessibilityRole="button">
          <Text style={styles.link}>{t(ui.orPickPhoto)}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none" edges={["top", "bottom"]}>
        <View style={styles.topBar} pointerEvents="box-none">
          <View style={styles.pills}>
            <Pill label={t(ui.history)} onPress={() => router.push("/history")} />
            {pack.library?.length ? (
              <Pill
                label={pack.libraryTitle ? t(pack.libraryTitle) : t(ui.guide)}
                onPress={() => router.push("/library")}
              />
            ) : null}
            {pack.id === "goldscan" ? (
              <Pill label={t(ui.priceCheck)} onPress={() => router.push("/price-check")} />
            ) : null}
            <Pill label="⚙" onPress={() => router.push("/settings")} />
          </View>
          {scansLeft !== null && scansLeft !== Infinity ? (
            <Pressable onPress={() => router.push("/paywall")} accessibilityRole="button">
              <Text style={styles.quota}>
                {scansLeft === 0
                  ? t(ui.scanQuotaNone)
                  : scansLeft === 1
                    ? t(ui.scanQuotaOne)
                    : fill(ui.scanQuotaMany, { n: scansLeft })}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Four brackets, not a box: they say "put the symbol here" without
            covering the thing being framed. */}
        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.reticle}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.hint}>{t(pack.captureHint)}</Text>
        </View>

        <View style={styles.controls} pointerEvents="box-none">
          <Pressable
            onPress={pickFromLibrary}
            hitSlop={12}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t(ui.gallery)}
            style={styles.side}
          >
            <Text style={styles.sideText}>{t(ui.gallery)}</Text>
          </Pressable>

          <Pressable
            onPress={shoot}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t(ui.analysing)}
            style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}
          >
            <View style={styles.shutterInner} />
          </Pressable>

          {/* A dashboard at night is lit, but the symbol is small and the
              phone shadows it. The torch is the difference between a readable
              photo and a retake. */}
          <Pressable
            onPress={() => setTorch((on) => !on)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityState={{ selected: torch }}
            accessibilityLabel={t(torch ? ui.torchOn : ui.torchOff)}
            style={styles.side}
          >
            <Text style={[styles.torch, torch && { color: ACCENT }]}>{torch ? "☀" : "☼"}</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {busy ? <Analysing photo={shot} stage={stage} /> : null}
    </View>
  );
}

/**
 * The wait, with the photo still on screen.
 *
 * Keeping the shot visible is the point: the driver sees what was sent, so if
 * the answer comes back wrong they already know whether the photo was the
 * problem. The ring is indeterminate because we do not know how long the
 * model will take — a percentage here would be a number we invented.
 */
function Analysing({ photo, stage }: { photo: string | null; stage: Stage }) {
  const spin = useRef(new Animated.Value(0)).current;
  const still = useReducedMotion();

  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, still]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.analysing}>
      {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={styles.scrim} />
      <SafeAreaView style={styles.analysingBody} edges={["top", "bottom"]}>
        <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
        <Text style={styles.analysingTitle}>{t(ui.analysing)}</Text>
        <Text style={styles.analysingStage}>
          {stage === "preparing" ? t(ui.holdSteady) : t(ui.takesSeconds)}
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  loading: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, justifyContent: "space-between" },

  permission: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: "center",
    gap: SP.lg,
    padding: SP.xl,
  },
  permTitle: { color: TEXT, ...TYPE.title, fontFamily: FONT.bold, textAlign: "center" },
  permBody: { color: TEXT_SOFT, ...TYPE.body, fontFamily: FONT.regular, textAlign: "center" },
  link: { color: TEXT_SOFT, ...TYPE.caption, fontFamily: FONT.medium, textAlign: "center" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
  },
  pills: { flexDirection: "row", gap: SP.sm, flexShrink: 1 },
  quota: { color: TEXT, ...TYPE.small, fontFamily: FONT.medium },

  reticleWrap: { alignItems: "center", gap: SP.xl },
  reticle: { width: 232, height: 168 },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "rgba(242,244,248,0.9)",
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  hint: {
    color: TEXT,
    ...TYPE.body,
    fontFamily: FONT.medium,
    textAlign: "center",
    maxWidth: 280,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 8,
  },

  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SP.xl,
    paddingBottom: SP.lg,
  },
  side: { minWidth: 72, minHeight: TAP, alignItems: "center", justifyContent: "center" },
  sideText: {
    color: TEXT,
    ...TYPE.caption,
    fontFamily: FONT.medium,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
  },
  torch: { color: TEXT, fontSize: 24 },

  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "rgba(242,244,248,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: ACTION },

  analysing: { ...StyleSheet.absoluteFillObject, backgroundColor: BG },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(12,14,19,0.82)" },
  analysingBody: { flex: 1, alignItems: "center", justifyContent: "center", gap: SP.lg },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: "rgba(242,244,248,0.14)",
    borderTopColor: ACTION,
  },
  analysingTitle: { color: TEXT, ...TYPE.section, fontFamily: FONT.semibold, textAlign: "center" },
  analysingStage: { color: TEXT_FAINT, ...TYPE.caption, fontFamily: FONT.regular, textAlign: "center" },
});
