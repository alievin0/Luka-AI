import type { ExpoConfig } from "expo/config";

/**
 * One codebase, several shipped apps. `SCANNER` picks which pack builds:
 *   SCANNER=dashlight npx expo start   → مصابيح السيارة
 *   SCANNER=bugscan   npx expo start   → ماسح الحشرات
 *
 * Each pack gets its own name, slug and bundle id so they're separate
 * listings on the stores while sharing every screen and the scan API.
 */
/**
 * The permission strings do not live here.
 *
 * iOS reads them from Info.plist before any JavaScript runs, so `t()` cannot
 * reach them — which is how Dash Light came to ship an Arabic camera line
 * beside an English photos line, one of them wrong for whoever was reading.
 * They live in `locales/<variant>/{en,ar}.json` instead, which Expo compiles
 * into `en.lproj/InfoPlist.strings` and `ar.lproj/InfoPlist.strings` at
 * prebuild. The English file is also read below as the base Info.plist, which
 * is what a device set to neither language sees.
 *
 * CFBundleDisplayName is in there too, so the icon on an Arabic phone is
 * labelled in Arabic. It is the home-screen label and iOS truncates it around
 * a dozen characters, so it is deliberately shorter than the store name: the
 * listing can say مصابيح السيارة where the icon says المصابيح.
 */
const strings = (variant: string, lang: "en" | "ar"): Record<string, string> =>
  require(`./locales/${variant}/${lang}.json`);

const VARIANTS = {
  dashlight: {
    name: "Dash Light Scanner",
    slug: "dashlight",
    bundleId: "com.dashlight.scanner",
    accent: "#F2A33C",
    splashBg: "#14171F",
  },
  goldscan: {
    name: "Gold Hallmark Scanner",
    slug: "goldscan",
    bundleId: "com.goldscan.hallmark",
    accent: "#D9A441",
    splashBg: "#1A1509",
  },
  womensfit: {
    name: "Home Workouts",
    slug: "womensfit",
    bundleId: "com.womensfit.home",
    accent: "#C9738F",
    splashBg: "#171014",
  },
  dogtrain: {
    name: "Dog Training",
    slug: "dogtrain",
    bundleId: "com.dogtrain.coach",
    accent: "#5A8DEE",
    splashBg: "#0E1420",
  },
  mahdar: {
    name: "Mahdar",
    slug: "mahdar",
    bundleId: "com.mahdar.lectures",
    accent: "#D9BE83",
    splashBg: "#0E0D0B",
  },
  bugscan: {
    name: "Insect Identifier",
    slug: "bugscan",
    bundleId: "com.bugscan.identifier",
    accent: "#5BC08A",
    splashBg: "#0F1714",
  },
} as const;

type VariantId = keyof typeof VARIANTS;

/* EXPO_PUBLIC_SCANNER is the same choice by another name: Metro inlines it
 * into the bundle, so the app can still tell which variant it is in contexts
 * where the manifest is not available. Either spelling works. */
const id = ((process.env.SCANNER || process.env.EXPO_PUBLIC_SCANNER) as VariantId) || "dashlight";
const v = VARIANTS[id] ?? VARIANTS.dashlight;

/** Only the lecture app records; the scanners must not ask for a microphone
 *  they never use, and stores reject permissions a build can't justify. */
const recordsAudio = id === "mahdar";

/** The base Info.plist values: English, and what a device localised to
 *  neither shipped language falls back to. */
const en = strings(id, "en");

/**
 * A production build with no API origin ships an app that cannot scan.
 *
 * `EXPO_PUBLIC_API_URL` is inlined by Metro at build time, so an unset value
 * cannot be noticed at runtime by anything except the user. Failing the build
 * is the last moment anyone is watching. Only EAS production profiles are
 * checked — `expo start` and preview builds resolve the origin from the dev
 * host (see src/api-base.ts).
 */
if (process.env.EAS_BUILD_PROFILE?.startsWith("production") && !process.env.EXPO_PUBLIC_API_URL) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. A production build without it cannot reach " +
      "the scan API — deploy app/api/ and set the origin in the EAS build profile " +
      "or as an EAS environment variable.",
  );
}

const config: ExpoConfig = {
  name: v.name,
  slug: v.slug,
  version: "0.1.0",
  // Six apps share this file, so a hardcoded ios.buildNumber would be the same
  // number for all of them. eas.json sets appVersionSource "remote" with
  // autoIncrement instead, which keeps a build counter per app on EAS.
  runtimeVersion: { policy: "appVersion" },
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
  // Expo compiles these into <lang>.lproj/InfoPlist.strings at prebuild and
  // adds them to the Xcode project, so the permission prompts and the icon's
  // label follow the phone's language rather than the build's.
  locales: { en: `./locales/${id}/en.json`, ar: `./locales/${id}/ar.json` },
  ios: {
    supportsTablet: false,
    bundleIdentifier: v.bundleId,
    infoPlist: {
      // Required for the .lproj strings to be consulted at all when the app's
      // development region and the device language disagree.
      CFBundleAllowMixedLocalizations: true,
      NSCameraUsageDescription: en.NSCameraUsageDescription,
      NSPhotoLibraryUsageDescription: en.NSPhotoLibraryUsageDescription,
      ...(recordsAudio
        ? {
            NSMicrophoneUsageDescription: en.NSMicrophoneUsageDescription,
            NSSpeechRecognitionUsageDescription: en.NSSpeechRecognitionUsageDescription,
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
    ["expo-camera", { cameraPermission: en.NSCameraUsageDescription }],
    ["expo-image-picker", { photosPermission: en.NSPhotoLibraryUsageDescription }],
    // Recording has to survive the screen locking — a student puts the phone
    // down the moment the lecture starts. enableBackgroundRecording is what
    // writes UIBackgroundModes on iOS and the foreground-service permissions
    // on Android; it needs a dev build, since plugins don't apply in Expo Go.
    ...(recordsAudio
      ? ([
          [
            "expo-audio",
            {
              microphonePermission: en.NSMicrophoneUsageDescription,
              enableBackgroundRecording: true,
            },
          ],
          [
            "expo-speech-recognition",
            { speechRecognitionPermission: en.NSSpeechRecognitionUsageDescription },
          ],
        ] as NonNullable<ExpoConfig["plugins"]>)
      : []),
  ],
  experiments: { typedRoutes: true },
  // `eas init` writes extra.eas.projectId and the top-level `owner` here on
  // first run. They are account-scoped, so they are not committed ahead of it;
  // without them `eas build` prompts to create the project interactively.
  extra: { scannerId: id, accent: v.accent },
};

export default config;
