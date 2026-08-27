import Constants from "expo-constants";
import { locale, remote } from "./i18n";
import type { AudioChunk, LectureAnalysis, Segment } from "./packs";
import { offsetSegments } from "./lectures";

/** Same origin resolution as the scan client: explicit in production, the
 *  Expo dev host otherwise so a phone on the same Wi-Fi reaches the laptop. */
function apiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const hostUri =
    Constants.expoConfig?.hostUri ?? (Constants as any).expoGoConfig?.debuggerHost;
  if (hostUri) return `http://${String(hostUri).split("/")[0]}`;
  return "http://localhost:8081";
}

export class LectureError extends Error {}

/** Generous: this is a whole lecture going up over a phone connection, and
 *  the server then waits on the transcription. But not unbounded — a request
 *  that never settles is indistinguishable from a frozen app. */
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LectureError("offline")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new LectureError("offline");
  }
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: unknown } | null;
    // The route sends a whole Text pair; the device picks the language. When
    // there is nothing usable in the body, "server" is a sentinel the screens
    // recognise and replace with their own copy.
    throw new LectureError(remote(parsed?.error) ?? "server");
  }
  return (await res.json()) as T;
}

/**
 * The accurate pass over the saved audio.
 *
 * The live writer already produced a transcript for free; this exists because
 * on-device recognition drops technical terms and struggles when a lecturer
 * switches between Arabic and English mid-sentence, which is most of them.
 * It costs real money per hour, so it runs when the student asks for it or
 * when the live writer produced nothing at all — never automatically on top
 * of a transcript that is already good enough.
 */
export async function transcribeLecture(input: {
  chunks: AudioChunk[];
  mimeType?: string;
}): Promise<{ segments: Segment[] }> {
  // uploadAsync streams from disk natively. fetch + FormData with a file part
  // is unreliable for bodies this size on iOS, and reading the file into JS
  // first would put the audio through the heap for nothing. It only exists on
  // the legacy surface — expo-file-system's default export in SDK 54 is the
  // new sync File API, which has no upload.
  const legacy = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");

  const all: Segment[] = [];
  let reachedAny = false;
  let lastError: string | null = null;

  // Sequential, not parallel: these are multi-megabyte uploads over a phone
  // connection, and running them at once makes every one of them slower and
  // more likely to time out.
  for (const chunk of input.chunks) {
    let result: { status: number; body: string };
    try {
      result = await withTimeout(
        legacy.uploadAsync(`${apiBase()}/api/transcribe`, chunk.uri, {
          httpMethod: "POST",
          uploadType: legacy.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          mimeType: input.mimeType ?? "audio/m4a",
          // The default is a background session, which by design never fails
          // when the server or the connection is down — it retries silently
          // forever. On campus Wi-Fi behind a captive portal that leaves the
          // analysing screen spinning with no error and no way out.
          sessionType: legacy.FileSystemSessionType.FOREGROUND,
        }),
        UPLOAD_TIMEOUT_MS,
      );
    } catch {
      lastError = "offline";
      continue;
    }

    const parsed = (() => {
      try {
        return JSON.parse(result.body) as { segments?: Segment[]; error?: unknown };
      } catch {
        return null;
      }
    })();

    if (result.status < 200 || result.status >= 300) {
      lastError = remote(parsed?.error) ?? "server";
      continue;
    }
    if (!parsed?.segments?.length) {
      // A slice of silence is a normal thing to record, not a failure.
      reachedAny = true;
      continue;
    }

    reachedAny = true;
    // Each chunk is transcribed on its own and comes back starting at zero.
    all.push(...offsetSegments(parsed.segments, chunk.at));
  }

  if (all.length === 0) throw new LectureError(reachedAny ? "empty" : lastError ?? "server");
  return { segments: all };
}

export function analyseLecture(input: {
  packId: string;
  segments: Segment[];
  emphasis: { at: number; text: string; marked?: boolean }[];
  profile: string;
  duration: number;
  recordedAt: number;
}) {
  return post<{ title: string; analysis: LectureAnalysis }>("/api/analyze", {
    ...input,
    locale,
  });
}

export type StudyAnswer = {
  /** False when the student's own lectures do not cover the question. */
  answered: boolean;
  answer: string;
  /** Verified server-side against the excerpts that were sent. */
  citations: { lectureId: string; atSeconds?: number; quote?: string }[];
};

/**
 * Ask a question of the student's own lectures.
 *
 * The evidence is chosen on the device and travels with the question, so the
 * answer can only be built from transcripts the student recorded — and the
 * server can check every quotation against exactly what it was given.
 */
export function askLectures(input: {
  packId: string;
  question: string;
  excerpts: { lectureId: string; lectureTitle: string; at: number; text: string }[];
  overview: { id: string; title: string; at: number; summary: string; terms: string[] }[];
}) {
  return post<StudyAnswer>("/api/ask", { ...input, locale });
}
