import Constants from "expo-constants";

const accent = (Constants.expoConfig?.extra?.accent as string) || "#F2A33C";

export const theme = {
  accent,
  bg: "#0C0E13",
  surface: "#161A22",
  surfaceAlt: "#1E232D",
  border: "#2A3039",
  text: "#F2F4F8",
  textSoft: "#9AA3B2",
  textFaint: "#69717F",
  critical: "#E5484D",
  criticalBg: "#2A1417",
  warning: "#F2A33C",
  warningBg: "#2A1F11",
  info: "#4CC38A",
  infoBg: "#122318",
  radius: 14,
  space: (n: number) => n * 4,
} as const;

/** Hex colour with an alpha channel, for gradients and glows. */
export const withAlpha = (hex: string, alpha: number) => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
};

export const severityStyle = (s: "critical" | "warning" | "info") =>
  s === "critical"
    ? { color: theme.critical, bg: theme.criticalBg, label: "خطر" }
    : s === "warning"
      ? { color: theme.warning, bg: theme.warningBg, label: "تحذير" }
      : { color: theme.info, bg: theme.infoBg, label: "معلومة" };

export const verdictStyle = (v: "stop" | "caution" | "ok") =>
  v === "stop"
    ? { color: theme.critical, bg: theme.criticalBg }
    : v === "caution"
      ? { color: theme.warning, bg: theme.warningBg }
      : { color: theme.info, bg: theme.infoBg };
