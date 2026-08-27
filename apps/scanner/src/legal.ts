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
 * CONFIRM BEFORE SUBMITTING TO A STORE. The default below is inferred from
 * the Vercel project name and has not been loaded — this container's network
 * policy blocks the host, so it could not be checked from here. A privacy
 * policy that 404s is a guaranteed App Review rejection. Open
 * <default>/privacy/dashlight in a browser once; if the production domain
 * differs, set EXPO_PUBLIC_SITE_URL rather than editing this line.
 */
const SITE = (process.env.EXPO_PUBLIC_SITE_URL || "https://luka-ai.vercel.app").replace(
  /\/$/,
  "",
);

export const privacyUrl = () => `${SITE}/privacy/${activePackId}`;

/** One document covers every app; the subscription terms are identical. */
export const termsUrl = () => `${SITE}/terms`;

/** The App Store requires a reachable support URL for every listing. */
export const supportUrl = () => `${SITE}/support`;
