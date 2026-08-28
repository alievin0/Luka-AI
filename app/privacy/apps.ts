/**
 * What each shipped app actually does with data.
 *
 * Kept as data rather than prose so the policy cannot drift from the app: a
 * pack that asks for the microphone has to say so here, and a pack that asks
 * for nothing must not claim otherwise. App Review compares the policy against
 * the permissions the binary declares.
 */

export type AppId =
  | "dashlight"
  | "goldscan"
  | "bugscan"
  | "womensfit"
  | "dogtrain"
  | "mahdar";

type Policy = {
  name: string;
  /** Which archetype this app is. The terms and support pages show only the
   *  sections that apply — a scanner has no recording-consent question, and a
   *  program has neither. */
  kind: "scanner" | "audio" | "program";
  updated: string;
  summary: string;
  collects: string[];
  leaves: string;
  sends: string;
  extraProcessor?: string;
  /** Set on every app that talks to our server at all. What the request
   *  itself reveals, separately from what you chose to send — an address is
   *  personal data whether or not anyone meant to collect it. */
  serverSide?: string;
  /** Set on every app that sells a subscription. Purchase data leaves the
   *  device even when nothing else does, so an app cannot say "nothing leaves"
   *  and sell a subscription in the same breath. */
  subscription?: string;
  notes: string[];
  contact: string;
};

/** Named rather than described. Apple expects a policy to say who receives
 *  user data, and "an AI provider" is not an answer a reviewer can check. */
export const AI_PROVIDER = {
  name: "Anthropic",
  policy: "https://www.anthropic.com/legal/privacy",
};

/**
 * Shared by every app that reaches our API.
 *
 * Written from the code, not from intent. `clientKey()` in
 * src/rate-limit.ts reads the caller's address from the request headers and
 * `checkRateLimit()` hashes it into the key that is counted — so an address
 * is processed, and a digest of it is stored for an hour. The route also
 * writes one line per scan with the token counts. Neither is a copy of your
 * photograph, and neither carries a name; both are more than "nothing", which
 * is what the earlier draft of this policy claimed.
 */
const SERVER_SIDE =
  "Our API sees your device's network address, as any web request does. We use it only to " +
  "limit how often the paid endpoints can be called: it is hashed and the hash is counted " +
  "for one hour, then deleted. We also log the size and cost of each request — the model " +
  "used and the number of tokens — with no photograph, no text and nothing naming you. " +
  "Our hosting provider keeps its own request logs under its own retention policy.";

/** Shared by every app with a paid plan, which is all six. */
const SUBSCRIPTION =
  "There is no account to create. Subscription purchases are handled through Apple or " +
  "Google and through our subscription provider, RevenueCat, which the app uses to check " +
  "whether a subscription is active. RevenueCat generates an anonymous identifier for that " +
  "purpose and receives purchase and device information; it is not linked to a name or an " +
  "email address by us. See revenuecat.com/privacy.";

/** One address for every app in this repository, and the only place it is
 *  written — six policies point here, so a change reaches eighteen pages. It is
 *  deliberately not a personal address: it goes on a public store listing, and
 *  on the EU trader declaration beside a name, an address and a phone number. */
const CONTACT = "lukai.help@gmail.com";
/** Printed as "Last updated" on all three legal pages, so it moves whenever
 *  what they say changes — the contact clause changed on this date. */
const UPDATED = "28 August 2026";

const SCANNER_COLLECTS = (what: string) => [
  `The photograph you choose to ${what}. It is sent to our AI processing provider to produce the answer. We do not store it on our own servers after the scan completes.`,
  "The few setup answers you gave when you first opened the app, so results are relevant to you. They stay on your device.",
  "A local history of your past scans, kept on your device so you can look back at them.",
];

export const APPS: Record<AppId, Policy> = {
  dashlight: {
    name: "Dash Light Scanner",
    kind: "scanner",
    updated: UPDATED,
    summary:
      "You take a photo of a dashboard warning light and we send it to our AI processing provider to generate a scan result. We do not store your dashboard photos on our own servers after the scan completes. There is no account to create, and there is no advertising and no analytics or tracking SDK in the app.",
    collects: SCANNER_COLLECTS("take of your dashboard"),
    leaves:
      "The photograph of your dashboard, and the setup answers you gave (such as your country and your car), because both change the answer. We do not intentionally send your name, email address, phone number or any other directly identifying information as part of a scan, and we do not attach an account to it. What a request reveals regardless is described below.",
    sends: "the photograph of your dashboard",
    serverSide: SERVER_SIDE,
    subscription: SUBSCRIPTION,
    notes: [
      "This app reads a warning light. It cannot diagnose a fault, and it is not a substitute for a mechanic or for a proper diagnostic scan.",
      "You decide whether and when to keep driving. If your vehicle is smoking, overheating, leaking, making an unusual noise, smells of burning, or is driving differently, stop in a safe place and get professional help — whatever the app says. The app is working from one photograph of one lamp and cannot see, hear or feel any of that.",
      "Repair cost ranges are estimates for orientation, not quotations.",
    ],
    contact: CONTACT,
  },
  goldscan: {
    name: "Gold Hallmark Scanner",
    kind: "scanner",
    updated: UPDATED,
    summary:
      "You photograph a hallmark and we send it to our AI processing provider to generate a reading, and you can check a price against the metal value. We do not store your photos on our own servers after the scan completes. There is no account to create, and no advertising.",
    collects: SCANNER_COLLECTS("take of the piece"),
    leaves:
      "The photograph of the hallmark, and the setup answers you gave (such as your country, which sets the currency). Prices and weights you type in for a valuation are calculated on your device and are not sent anywhere.",
    sends: "the photograph of the hallmark",
    serverSide: SERVER_SIDE,
    subscription: SUBSCRIPTION,
    notes: [
      "A photograph cannot prove that gold is solid rather than plated — only an acid, XRF or density test can. This app reads the stamp and checks the arithmetic on a price.",
      "Nothing here is financial advice or a valuation you should rely on for a purchase.",
    ],
    contact: CONTACT,
  },
  bugscan: {
    name: "Insect Identifier",
    kind: "scanner",
    updated: UPDATED,
    summary:
      "You photograph an insect or a bite and we send it to our AI processing provider to generate an identification and first-aid guidance. We do not store your photos on our own servers after the scan completes. There is no account to create, and no advertising.",
    collects: SCANNER_COLLECTS("take of the insect or bite"),
    leaves:
      "The photograph, and the setup answers you gave (such as your region, since which species are plausible depends on where you are).",
    sends: "the photograph",
    serverSide: SERVER_SIDE,
    subscription: SUBSCRIPTION,
    notes: [
      "This app is not medical advice. If a bite is worsening, if you have trouble breathing, or if you are worried, contact a doctor or emergency services — do not wait on an app.",
    ],
    contact: CONTACT,
  },
  womensfit: {
    name: "Home Workouts",
    kind: "program",
    updated: UPDATED,
    summary:
      "Your plan, your progress and your streak are stored on your device and never leave it. None of it is sent to us, and the app has no advertising and carries no analytics or tracking SDK. The one exception is the subscription, described below.",
    collects: [
      "The setup answers you gave when you first opened the app, stored on your device.",
      "Which sessions you have completed and your streak, stored on your device.",
      "Your reminder time, if you set one. Reminders are scheduled locally by your phone; no server is involved.",
    ],
    leaves:
      "Nothing you create. This app has no network features: your plan, your progress and your reminders are handled entirely on your device, including offline. Subscription purchases are the exception and are described below.",
    sends: "nothing — this app does not contact any server of ours",
    subscription: SUBSCRIPTION,
    notes: [
      "This app is not medical advice. If you are pregnant, recovering from injury, or have a health condition, speak to a doctor before starting.",
    ],
    contact: CONTACT,
  },
  dogtrain: {
    name: "Dog Training",
    kind: "program",
    updated: UPDATED,
    summary:
      "Your sessions, your progress and your streak are stored on your device and never leave it. None of it is sent to us, and the app has no advertising and carries no analytics or tracking SDK. The one exception is the subscription, described below.",
    collects: [
      "The setup answers you gave when you first opened the app, stored on your device.",
      "Which sessions you have completed and your streak, stored on your device.",
      "Your reminder time, if you set one. Reminders are scheduled locally by your phone; no server is involved.",
    ],
    leaves:
      "Nothing you create. This app has no network features: your plan, your progress and your reminders are handled entirely on your device, including offline. Subscription purchases are the exception and are described below.",
    sends: "nothing — this app does not contact any server of ours",
    subscription: SUBSCRIPTION,
    notes: [
      "Training guidance is general and is not a substitute for a qualified behaviourist, particularly where aggression or fear is involved.",
    ],
    contact: CONTACT,
  },
  mahdar: {
    name: "Mahdar",
    kind: "audio",
    updated: UPDATED,
    summary:
      "You record a lecture and get a summary, the assignments and what the exam is likely to ask. The recording stays on your device. The text of the lecture is sent to our AI processing provider to be summarised. There is no account to create, and no advertising.",
    collects: [
      "The audio you record, stored on your device only. We never receive a copy unless you ask for the accurate transcription described below.",
      "The transcript, produced on your device while the lecture is happening, and stored on your device.",
      "The few setup answers you gave when you first opened the app, so the summary fits what you study.",
    ],
    leaves:
      "The text of the lecture, so it can be summarised. The recording itself stays on your device unless you tap “re-transcribe from the recording”, which uploads that audio for a more accurate transcription and is the only time audio leaves your phone. We do not attach your name, email address or an account to either.",
    sends: "the text of your lecture",
    extraProcessor:
      "If you ask for the accurate transcription, the audio is sent to ElevenLabs, a speech-to-text provider, for that purpose only. We do not link it to a name or an account. Its own retention is governed by its policy at elevenlabs.io/privacy.",
    serverSide: SERVER_SIDE,
    subscription: SUBSCRIPTION,
    notes: [
      "Recording a lecture may require permission from your instructor or your institution, and in some places the law requires the consent of the people being recorded. Please check before you record — that responsibility is yours, not the app's.",
      "The microphone is used only while a lecture is recording, and the app shows you clearly when it is running.",
      "Mahdar summarises what it heard. It can mishear, and it is not a substitute for attending or for your lecturer's own material.",
    ],
    contact: CONTACT,
  },
};
