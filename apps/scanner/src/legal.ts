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
 * The default below is the deployed production alias, confirmed by deploying
 * and loading it. It is not the name you would guess: Vercel appended `-psi`
 * because the bare project name was taken, so the inferred
 * `luka-ai.vercel.app` this used to default to would have 404'd — and a
 * privacy policy that 404s is a guaranteed App Review rejection.
 *
 * Set EXPO_PUBLIC_SITE_URL to override, which is what a custom domain would
 * use. Leave this default correct rather than relying on that variable: a
 * build made without the .env — CI, a fresh clone — has to ship a link that
 * resolves, not one that depends on someone remembering.
 */
const SITE = (process.env.EXPO_PUBLIC_SITE_URL || "https://luka-ai-psi.vercel.app").replace(
  /\/$/,
  "",
);

export const privacyUrl = () => `${SITE}/privacy/${activePackId}`;

/**
 * Terms and support are per-app too.
 *
 * The subscription clauses are identical across these apps, so one page used
 * to cover all of them — but that page then had to name every app and carry
 * every app's disclaimer, and someone opening the terms for a dashboard
 * scanner read paragraphs about gold hallmarks and lecture recordings, three
 * of which are not on any store. A reviewer reads these against one binary.
 */
export const termsUrl = () => `${SITE}/terms/${activePackId}`;

/** The App Store requires a reachable support URL for every listing. */
export const supportUrl = () => `${SITE}/support/${activePackId}`;
