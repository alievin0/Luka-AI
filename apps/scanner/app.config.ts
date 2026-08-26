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
    name: "لمبات السيارة",
    slug: "dashlight",
    bundleId: "com.dashlight.scanner",
    accent: "#F2A33C",
    cameraPermission:
      "نحتاج الكاميرا لتصوير لوحة القيادة والتعرّف على اللمبة التحذيرية.",
    photosPermission: "نحتاج الوصول للصور لاختيار صورة لوحة القيادة.",
  },
  bugscan: {
    name: "ماسح الحشرات",
    slug: "bugscan",
    bundleId: "com.bugscan.identifier",
    accent: "#5BC08A",
    cameraPermission: "نحتاج الكاميرا لتصوير الحشرة أو اللدغة والتعرّف عليها.",
    photosPermission: "نحتاج الوصول للصور لاختيار صورة الحشرة أو اللدغة.",
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
  scheme: v.slug,
  userInterfaceStyle: "dark",
  newArchEnabled: true,
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
    permissions: ["CAMERA", "READ_MEDIA_IMAGES"],
  },
  web: { output: "server" },
  plugins: [
    "expo-router",
    ["expo-camera", { cameraPermission: v.cameraPermission }],
    ["expo-image-picker", { photosPermission: v.photosPermission }],
  ],
  experiments: { typedRoutes: true },
  extra: { scannerId: id, accent: v.accent },
};

export default config;
