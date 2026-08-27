import Constants from "expo-constants";
import { locale } from "./i18n";
import type { LectureAnalysis, Segment } from "./packs";

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
    const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new LectureError(parsed?.error ?? "server");
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
  audioUri: string;
  mimeType?: string;
}): Promise<{ segments: Segment[] }> {
  // uploadAsync streams from disk natively. fetch + FormData with a file part
  // is unreliable for bodies this size on iOS, and reading the file into JS
  // first would put ~20MB of a lecture through the heap for nothing. It only
  // exists on the legacy surface — expo-file-system's default export in SDK 54
  // is the new sync File API, which has no upload.
  const legacy = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");

  let result: { status: number; body: string };
  try {
    result = await legacy.uploadAsync(`${apiBase()}/api/transcribe`, input.audioUri, {
      httpMethod: "POST",
      uploadType: legacy.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: input.mimeType ?? "audio/m4a",
    });
  } catch {
    throw new LectureError("offline");
  }

  const parsed = (() => {
    try {
      return JSON.parse(result.body) as { segments?: Segment[]; error?: string };
    } catch {
      return null;
    }
  })();

  if (result.status < 200 || result.status >= 300) {
    throw new LectureError(parsed?.error ?? "server");
  }
  if (!parsed?.segments?.length) {
    throw new LectureError(parsed?.error ?? "empty");
  }
  return { segments: parsed.segments };
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
