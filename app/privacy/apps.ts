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
  notes: string[];
  contact: string;
};

const CONTACT = "alicpa2006@gmail.com";
const UPDATED = "27 August 2026";

const SCANNER_COLLECTS = (what: string) => [
  `The photograph you choose to ${what}. It is used to answer your question and is not stored on our servers.`,
  "The few setup answers you gave when you first opened the app, so results are relevant to you. They stay on your device.",
  "A local history of your past scans, kept on your device so you can look back at them.",
];

export const APPS: Record<AppId, Policy> = {
  dashlight: {
    name: "Dash Light Scanner",
    kind: "scanner",
    updated: UPDATED,
    summary:
      "You photograph a warning light and get an answer. The photo is processed to produce that answer and is not kept by us. There is no account, no tracking and no advertising.",
    collects: SCANNER_COLLECTS("take of your dashboard"),
    leaves:
      "The photograph of your dashboard, and the setup answers you gave (such as your country and your car), because both change the answer. Nothing that identifies you personally is sent, and we do not attach a name, an account or a device identifier to it.",
    sends: "the photograph of your dashboard",
    notes: [
      "This app reads a warning light. It cannot diagnose a fault, and it is not a substitute for a mechanic or for a proper diagnostic scan. Never rely on it alone for a decision about whether a vehicle is safe to drive.",
      "Repair cost ranges are estimates for orientation, not quotations.",
    ],
    contact: CONTACT,
  },
  goldscan: {
    name: "Gold Hallmark Scanner",
    kind: "scanner",
    updated: UPDATED,
    summary:
      "You photograph a hallmark and get a reading, and you can check a price against the metal value. The photo is processed to produce that answer and is not kept by us.",
    collects: SCANNER_COLLECTS("take of the piece"),
    leaves:
      "The photograph of the hallmark, and the setup answers you gave (such as your country, which sets the currency). Prices and weights you type in for a valuation are calculated on your device and are not sent anywhere.",
    sends: "the photograph of the hallmark",
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
      "You photograph an insect or a bite and get an identification and first-aid guidance. The photo is processed to produce that answer and is not kept by us.",
    collects: SCANNER_COLLECTS("take of the insect or bite"),
    leaves:
      "The photograph, and the setup answers you gave (such as your region, since which species are plausible depends on where you are).",
    sends: "the photograph",
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
      "This app collects nothing. Your plan, your progress and your streak are stored on your device and never leave it. There is no account, no server, no tracking and no advertising.",
    collects: [
      "The setup answers you gave when you first opened the app, stored on your device.",
      "Which sessions you have completed and your streak, stored on your device.",
      "Your reminder time, if you set one. Reminders are scheduled locally by your phone; no server is involved.",
    ],
    leaves:
      "Nothing. This app has no network features. Everything happens on your device, including offline.",
    sends: "nothing — this app does not contact any server",
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
      "This app collects nothing. Your sessions, your progress and your streak are stored on your device and never leave it. There is no account, no server, no tracking and no advertising.",
    collects: [
      "The setup answers you gave when you first opened the app, stored on your device.",
      "Which sessions you have completed and your streak, stored on your device.",
      "Your reminder time, if you set one. Reminders are scheduled locally by your phone; no server is involved.",
    ],
    leaves:
      "Nothing. This app has no network features. Everything happens on your device, including offline.",
    sends: "nothing — this app does not contact any server",
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
      "You record a lecture and get a summary, the assignments and what the exam is likely to ask. The recording stays on your device. The text of the lecture is sent to be summarised. There is no account, no tracking and no advertising.",
    collects: [
      "The audio you record, stored on your device only. We never receive a copy unless you ask for the accurate transcription described below.",
      "The transcript, produced on your device while the lecture is happening, and stored on your device.",
      "The few setup answers you gave when you first opened the app, so the summary fits what you study.",
    ],
    leaves:
      "The text of the lecture, so it can be summarised. The recording itself stays on your device unless you tap “re-transcribe from the recording”, which uploads that audio for a more accurate transcription and is the only time audio leaves your phone. Nothing identifying you is attached to either.",
    sends: "the text of your lecture",
    extraProcessor:
      "If you ask for the accurate transcription, the audio is sent to a speech-to-text provider for that purpose only. It is not retained to train models and is not linked to you.",
    notes: [
      "Recording a lecture may require permission from your instructor or your institution, and in some places the law requires the consent of the people being recorded. Please check before you record — that responsibility is yours, not the app's.",
      "The microphone is used only while a lecture is recording, and the app shows you clearly when it is running.",
      "Mahdar summarises what it heard. It can mishear, and it is not a substitute for attending or for your lecturer's own material.",
    ],
    contact: CONTACT,
  },
};
