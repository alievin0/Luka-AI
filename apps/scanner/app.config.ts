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
    },
  },
  android: {
    package: v.bundleId,
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: `./assets/${id}/adaptive-icon.png`,
      backgroundColor: v.splashBg,
    },
    permissions: ["CAMERA", "READ_MEDIA_IMAGES"],
  },
  web: { output: "server", favicon: `./assets/${id}/favicon.png` },
  plugins: [
    "expo-router",
    ["expo-camera", { cameraPermission: v.cameraPermission }],
    ["expo-image-picker", { photosPermission: v.photosPermission }],
  ],
  experiments: { typedRoutes: true },
  extra: { scannerId: id, accent: v.accent },
};

export default config;
