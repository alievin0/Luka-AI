import type { ExpoConfig } from "expo/config";

/**
 * One codebase, several shipped apps. `SCANNER` picks which pack builds:
 *   SCANNER=dashlight npx expo start   → لمبات السيارة
 *   SCANNER=bugscan   npx expo start   → ماسح الحشرات
 *
 * Each pack gets its own name, slug and bundle id so they're separate
 * listings on the stores while sharing every screen and the scan API.
 */
const VARIANTS = {
  dashlight: {
    name: "Dash Light Scanner",
    slug: "dashlight",
    bundleId: "com.dashlight.scanner",
    accent: "#F2A33C",
    splashBg: "#14171F",
    cameraPermission:
      "نحتاج الكاميرا لتصوير لوحة القيادة والتعرّف على اللمبة التحذيرية.",
    photosPermission: "We need photo access so you can pick a dashboard photo.",
  },
  goldscan: {
    name: "Gold Hallmark Scanner",
    slug: "goldscan",
    bundleId: "com.goldscan.hallmark",
    accent: "#D9A441",
    splashBg: "#1A1509",
    cameraPermission: "We need the camera to photograph the hallmark stamped on your gold.",
    photosPermission: "We need photo access so you can pick a photo of the piece.",
  },
  womensfit: {
    name: "Home Workouts",
    slug: "womensfit",
    bundleId: "com.womensfit.home",
    accent: "#C9738F",
    splashBg: "#171014",
    cameraPermission: "Not used by this app.",
    photosPermission: "Not used by this app.",
  },
  dogtrain: {
    name: "Dog Training",
    slug: "dogtrain",
    bundleId: "com.dogtrain.coach",
    accent: "#5A8DEE",
    splashBg: "#0E1420",
    cameraPermission: "Not used by this app.",
    photosPermission: "Not used by this app.",
  },
  mahdar: {
    name: "Mahdar",
    slug: "mahdar",
    bundleId: "com.mahdar.lectures",
    accent: "#D9BE83",
    splashBg: "#0E0D0B",
    cameraPermission: "Not used by this app.",
    photosPermission: "Not used by this app.",
    micPermission:
      "مَحضَر بيحتاج المايك عشان يسجّل المحاضرة ويحوّلها لنص وملخص.",
    speechPermission:
      "مَحضَر بيحوّل كلام الدكتور لنص على جهازك لحظة بلحظة.",
  },
  bugscan: {
    name: "Insect Identifier",
    slug: "bugscan",
    bundleId: "com.bugscan.identifier",
    accent: "#5BC08A",
    splashBg: "#0F1714",
    cameraPermission: "We need the camera to photograph the insect or bite.",
    photosPermission: "We need photo access so you can pick a photo of the insect or bite.",
  },
} as const;

type VariantId = keyof typeof VARIANTS;

const id = (process.env.SCANNER as VariantId) || "dashlight";
const v = VARIANTS[id] ?? VARIANTS.dashlight;

/** Only the lecture app records; the scanners must not ask for a microphone
 *  they never use, and stores reject permissions a build can't justify. */
const recordsAudio = id === "mahdar";
const micPermission =
  "micPermission" in v ? v.micPermission : "Not used by this app.";
const speechPermission =
  "speechPermission" in v ? v.speechPermission : "Not used by this app.";

const config: ExpoConfig = {
  name: v.name,
  slug: v.slug,
  version: "0.1.0",
  orientation: "portrait",
  icon: `./assets/${id}/icon.png`,
  scheme: v.slug,
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  splash: {
    image: `./assets/${id}/splash-icon.png`,
    resizeMode: "contain",
    backgroundColor: v.splashBg,
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: v.bundleId,
    infoPlist: {
      NSCameraUsageDescription: v.cameraPermission,
      NSPhotoLibraryUsageDescription: v.photosPermission,
      ...(recordsAudio
        ? {
            NSMicrophoneUsageDescription: micPermission,
            NSSpeechRecognitionUsageDescription: speechPermission,
          }
        : {}),
    },
  },
  android: {
    package: v.bundleId,
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: `./assets/${id}/adaptive-icon.png`,
      backgroundColor: v.splashBg,
    },
    permissions: recordsAudio
      ? ["RECORD_AUDIO", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MICROPHONE", "POST_NOTIFICATIONS"]
      : ["CAMERA", "READ_MEDIA_IMAGES"],
  },
  web: { output: "server", favicon: `./assets/${id}/favicon.png` },
  plugins: [
    "expo-router",
    ["expo-camera", { cameraPermission: v.cameraPermission }],
    ["expo-image-picker", { photosPermission: v.photosPermission }],
    // Recording has to survive the screen locking — a student puts the phone
    // down the moment the lecture starts. enableBackgroundRecording is what
    // writes UIBackgroundModes on iOS and the foreground-service permissions
    // on Android; it needs a dev build, since plugins don't apply in Expo Go.
    ...(recordsAudio
      ? ([
          [
            "expo-audio",
            { microphonePermission: micPermission, enableBackgroundRecording: true },
          ],
          ["expo-speech-recognition", { speechRecognitionPermission: speechPermission }],
        ] as NonNullable<ExpoConfig["plugins"]>)
      : []),
  ],
  experiments: { typedRoutes: true },
  extra: { scannerId: id, accent: v.accent },
};

export default config;
