import { activePackId } from "./packs";

/**
 * Where this app's privacy policy lives.
 *
 * Each pack has its own page, because they do genuinely different things with
 * data — a scanner takes photographs, the lecture app records a room, the
 * programs collect nothing — and a policy that describes the wrong one is
 * worse than no policy at all. App Review compares what the page claims
 * against the permissions the binary declares.
 *
 * The host is overridable so a preview deployment can be pointed at without a
 * rebuild; the default is the production site.
 */
const SITE = (process.env.EXPO_PUBLIC_SITE_URL || "https://luka-ai.vercel.app").replace(
  /\/$/,
  "",
);

export const privacyUrl = () => `${SITE}/privacy/${activePackId}`;
