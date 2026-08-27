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
    splashBg: "#14171F",
    cameraPermission:
      "نحتاج الكاميرا لتصوير لوحة القيادة والتعرّف على اللمبة التحذيرية.",
    photosPermission: "نحتاج الوصول للصور لاختيار صورة لوحة القيادة.",
  },
  goldscan: {
    name: "فاحص الذهب",
    slug: "goldscan",
    bundleId: "com.goldscan.hallmark",
    accent: "#D9A441",
    splashBg: "#1A1509",
    cameraPermission: "نحتاج الكاميرا لتصوير الدمغة المحفورة على قطعة الذهب.",
    photosPermission: "نحتاج الوصول للصور لاختيار صورة قطعة الذهب.",
  },
  womensfit: {
    name: "تمارين البيت",
    slug: "womensfit",
    bundleId: "com.womensfit.home",
    accent: "#C9738F",
    splashBg: "#171014",
    cameraPermission: "غير مستخدم بهذا التطبيق.",
    photosPermission: "غير مستخدم بهذا التطبيق.",
  },
  dogtrain: {
    name: "تدريب الكلاب",
    slug: "dogtrain",
    bundleId: "com.dogtrain.coach",
    accent: "#5A8DEE",
    splashBg: "#0E1420",
    cameraPermission: "غير مستخدم بهذا التطبيق.",
    photosPermission: "غير مستخدم بهذا التطبيق.",
  },
  bugscan: {
    name: "ماسح الحشرات",
    slug: "bugscan",
    bundleId: "com.bugscan.identifier",
    accent: "#5BC08A",
    splashBg: "#0F1714",
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
