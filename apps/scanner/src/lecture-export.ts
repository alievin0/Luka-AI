import * as Notifications from "expo-notifications";
import { t } from "./i18n";
import { ui } from "./i18n/ui";
import type { Lecture } from "./packs";
import { clock, transcriptOfSegments } from "./lectures";

/** Markdown, calendar files and reminders — the three ways a lecture leaves
 *  the app and lands somewhere the student actually works. */

export function toMarkdown(lecture: Lecture): string {
  const a = lecture.analysis;
  const date = new Date(lecture.at).toLocaleDateString();
  const lines: string[] = [`# ${lecture.title || t(ui.untitledLecture)}`, "", `_${date}_`, ""];

  if (a) {
    lines.push("## " + t(ui.tabSummary), "", a.summary, "");

    if (a.keyPoints.length) {
      lines.push("## " + t(ui.keyPoints), "", ...a.keyPoints.map((p) => `- ${p}`), "");
    }
    if (a.tasks.length) {
      lines.push(
        "## " + t(ui.tabTasks),
        "",
        ...a.tasks.map((task) => `- [ ] ${task.text}${task.due ? ` — ${task.due}` : ""}`),
        "",
      );
    }
    if (a.examPredictions.length) {
      lines.push(
        "## " + t(ui.tabExam),
        "",
        ...a.examPredictions.map((p) => `- **${p.topic}** (${p.confidence}) — ${p.why}`),
        "",
      );
    }
    if (a.emphasised.length) {
      lines.push(
        "## " + t(ui.tabTone),
        "",
        ...a.emphasised.map((e) => `- \`${clock(e.atSeconds)}\` ${e.text} — _${e.reason}_`),
        "",
      );
    }
    if (a.terms.length) {
      lines.push("## " + t(ui.tabTerms), "", ...a.terms.map((x) => `- **${x.term}** — ${x.definition}`), "");
    }
    if (a.chapters.length) {
      lines.push("## " + t(ui.tabMap), "");
      for (const chapter of a.chapters) {
        lines.push(`### ${clock(chapter.atSeconds)} — ${chapter.title}`, "");
        lines.push(...chapter.points.map((p) => `- ${p}`), "");
      }
    }
  }

  lines.push("## " + t(ui.tabTranscript), "", transcriptOfSegments(lecture.segments), "");
  return lines.join("\n");
}

/** RFC 5545 escaping: commas, semicolons and backslashes are separators, and
 *  a raw newline ends the property. Getting this wrong silently corrupts the
 *  whole file in most calendar apps rather than failing loudly. */
const esc = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** UTF-8 length of a single code point. Arabic sits in the two-byte range,
 *  so a line well under 75 characters can already be over 75 octets. */
const utf8Len = (codePoint: number) =>
  codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;

/**
 * Folds a content line to RFC 5545's 75-octet recommendation.
 *
 * The limit is octets, not characters, so this walks code points and counts
 * their encoded width — which also means a character can never be split down
 * the middle, the way a naive byte slice would split an Arabic letter into
 * two invalid halves. Continuation lines begin with a single space.
 *
 * Deliberately written without Buffer or TextEncoder: this module runs on the
 * device, and neither is guaranteed in the React Native runtime.
 */
function fold(line: string): string {
  const pieces: string[] = [];
  let current = "";
  let used = 0;
  // 75 for the first line; continuations spend one octet on the leading space.
  let budget = 75;

  // for..of iterates by code point, so surrogate pairs stay whole.
  for (const character of line) {
    const width = utf8Len(character.codePointAt(0)!);
    if (used + width > budget) {
      pieces.push(current);
      current = "";
      used = 0;
      budget = 74;
    }
    current += character;
    used += width;
  }
  pieces.push(current);

  return pieces.join("\r\n ");
}

/** Tasks the lecturer dated precisely enough to put in a calendar. */
export const datedTasks = (lecture: Lecture) =>
  (lecture.analysis?.tasks ?? [])
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => {
      if (!task.dueISO) return false;
      const time = Date.parse(task.dueISO);
      return Number.isFinite(time);
    });

export function toIcs(lecture: Lecture): string | null {
  const dated = datedTasks(lecture);
  if (dated.length === 0) return null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mahdar//Lecture tasks//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const { task, index } of dated) {
    const due = new Date(task.dueISO!);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${lecture.id}-${index}@mahdar`,
      `DTSTAMP:${stamp(new Date(lecture.at))}`,
      `DTSTART:${stamp(due)}`,
      `DTEND:${stamp(new Date(due.getTime() + 30 * 60 * 1000))}`,
      `SUMMARY:${esc(task.text)}`,
      `DESCRIPTION:${esc(`${lecture.title}${task.due ? ` — ${task.due}` : ""}`)}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT12H",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(task.text)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 wants CRLF; some calendar apps reject LF-only files.
  return lines.map(fold).join("\r\n");
}

/**
 * Schedules one local notification per dated task, twelve hours ahead.
 *
 * Only tasks with a resolved date get one: a reminder that fires at the wrong
 * time trains someone to ignore every future reminder. Returns how many were
 * actually scheduled so the UI can say so instead of claiming success.
 */
export async function scheduleTaskReminders(lecture: Lecture): Promise<number> {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    const asked = await Notifications.requestPermissionsAsync();
    if (!asked.granted) return 0;
  }

  let scheduled = 0;
  for (const { task, index } of datedTasks(lecture)) {
    const due = Date.parse(task.dueISO!);
    if (due <= Date.now()) continue;
    // Twelve hours ahead where there is room, otherwise as soon as we can:
    // a deadline inside the next twelve hours is the one a student most needs
    // telling about, and skipping it was leaving exactly those silent.
    const lead = due - 12 * 60 * 60 * 1000;
    const when = new Date(Math.max(lead, Date.now() + 60_000));
    if (when.getTime() >= due) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${lecture.id}-task-${index}`,
        content: { title: lecture.title || t(ui.untitledLecture), body: task.text },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
        },
      });
      scheduled += 1;
    } catch {
      // One bad date shouldn't cost the student the other reminders.
    }
  }
  return scheduled;
}

/** Whether this lecture currently has reminders scheduled. Read on load so
 *  the button reflects the real state rather than resetting to "off" every
 *  time the screen is opened. */
export async function remindersScheduled(lecture: Lecture): Promise<boolean> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.some((n) => n.identifier.startsWith(`${lecture.id}-task-`));
  } catch {
    return false;
  }
}

export async function cancelTaskReminders(lecture: Lecture) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(`${lecture.id}-task-`))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** Writes a file into cache and hands it to the OS share sheet. Cache is
 *  right here: the file only has to survive long enough to be shared. */
export async function shareFile(name: string, contents: string, mimeType: string) {
  const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
  const Sharing = require("expo-sharing") as typeof import("expo-sharing");

  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);

  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file.uri, { mimeType, UTI: mimeType });
  return true;
}
