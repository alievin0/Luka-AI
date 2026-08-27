import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { activePackId, type ScannerPack } from "../packs";
import { theme } from "../theme";
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
import { t } from "../i18n";
import { ui } from "../i18n/ui";

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

export function ScannerHome({ pack }: { pack: ScannerPack }) {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [scansLeft, setScansLeft] = useState<number | null>(null);

  const refreshQuota = async () => {
    if (await isPro()) return setScansLeft(Infinity);
    setScansLeft(Math.max(0, FREE_SCANS - (await getScanCount())));
  };

  useEffect(() => {
    refreshQuota();
  }, []);

  const run = async (uri: string) => {
    setBusy(true);
    try {
      const { uri: readyUri, base64 } = await prepare(uri);
      const profile = await getProfile();

      const result = await scanImage({
        packId: activePackId,
        base64,
        currency: currencyFor(profile),
        profile: profileSummary(profile),
      });

      if (!result.detected) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          t(ui.couldNotIdentify),
          result.notDetectedReason || t(ui.tryClearerPhoto),
        );
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await bumpScanCount();
      const entry = {
        id: String(Date.now()),
        at: Date.now(),
        imageUri: readyUri,
        result,
      };
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
      setBusy(false);
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

  if (!permission) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permission}>
        <Text style={styles.permTitle}>{t(ui.cameraNeeded)}</Text>
        <Text style={styles.permBody}>{t(pack.captureHint)}</Text>
        <Pressable style={styles.cta} onPress={requestPermission}>
          <Text style={styles.ctaText}>{t(ui.allowCamera)}</Text>
        </Pressable>
        <Pressable onPress={pickFromLibrary}>
          <Text style={styles.link}>{t(ui.orPickPhoto)}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <View style={styles.topLeft}>
            <Pressable style={styles.pill} onPress={() => router.push("/history")} hitSlop={8}>
              <Text style={styles.pillText}>{t(ui.history)}</Text>
            </Pressable>
            {pack.library ? (
              <Pressable style={styles.pill} onPress={() => router.push("/library")} hitSlop={8}>
                <Text style={styles.pillText}>{pack.libraryTitle ? t(pack.libraryTitle) : t(ui.guide)}</Text>
              </Pressable>
            ) : null}
            {pack.showCost && pack.id === "goldscan" ? (
              <Pressable style={styles.pill} onPress={() => router.push("/price-check")} hitSlop={8}>
                <Text style={styles.pillText}>{t(ui.priceCheck)}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.pill} onPress={() => router.push("/settings")} hitSlop={8}>
              <Text style={styles.pillText}>⚙</Text>
            </Pressable>
          </View>
          {scansLeft !== null && scansLeft !== Infinity && (
            <Pressable style={styles.pill} onPress={() => router.push("/paywall")}>
              <Text style={styles.pillText}>
                {scansLeft > 0 ? `${scansLeft} ${t(ui.scansLeft)}` : t(ui.upgrade)}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.reticle}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.hint}>{t(pack.captureHint)}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable onPress={pickFromLibrary} hitSlop={12} disabled={busy}>
            <Text style={styles.secondary}>{t(ui.gallery)}</Text>
          </Pressable>

          <Pressable
            style={[styles.shutter, busy && styles.shutterBusy]}
            onPress={shoot}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={theme.bg} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>

          <View style={styles.spacer} />
        </View>

        {busy && (
          <View style={styles.busyBanner} pointerEvents="none">
            <Text style={styles.busyText}>{t(ui.analysing)}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.bg, justifyContent: "center" },
  overlay: { flex: 1, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 16,
    gap: 10,
  },
  topLeft: { flexDirection: "row", gap: 8, flexShrink: 1, flexWrap: "wrap" },
  pill: {
    backgroundColor: "rgba(12,14,19,0.72)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pillText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  reticleWrap: { alignItems: "center", gap: 16 },
  reticle: { width: 268, height: 196 },
  corner: {
    position: "absolute",
    width: 34,
    height: 34,
    borderColor: theme.accent,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
  hint: {
    color: theme.text,
    fontSize: 15,
    textAlign: "center",
    backgroundColor: "rgba(12,14,19,0.72)",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    overflow: "hidden",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingBottom: 24,
  },
  secondary: { color: theme.text, fontSize: 15, width: 60 },
  spacer: { width: 60 },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterBusy: { opacity: 0.6 },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 3,
    borderColor: theme.bg,
  },
  busyBanner: { position: "absolute", bottom: 130, left: 0, right: 0 },
  busyText: {
    color: theme.text,
    textAlign: "center",
    backgroundColor: "rgba(12,14,19,0.85)",
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 15,
  },
  permission: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: "center",
    padding: 28,
    gap: 16,
  },
  permTitle: {
    color: theme.text,
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  permBody: {
    color: theme.textSoft,
    fontSize: 16,
    textAlign: "center",
    lineHeight: 28,
  },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 8,
  },
  ctaText: { color: "#0C0E13", fontSize: 17, fontWeight: "700" },
  link: { color: theme.textSoft, fontSize: 15, textAlign: "center", marginTop: 4 },
});
