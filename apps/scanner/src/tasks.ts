import { getLectures } from "./lectures";
import type { Lecture, LectureTask } from "./packs";

/**
 * Tasks across the whole semester, not one lecture at a time.
 *
 * A student does not think in lectures when they are planning a week — they
 * think in deadlines. But a deadline with no memory of where it came from is
 * just a to-do item, and they already have somewhere to put those. So every
 * task carries its lecture back with it, and the moment it was set.
 */

export type SourcedTask = {
  /** Stable across renders and safe as a list key. */
  key: string;
  task: LectureTask;
  /** Index into the lecture's own task list, which is what `done` records. */
  index: number;
  lectureId: string;
  lectureTitle: string;
  lectureAt: number;
  done: boolean;
  /** Parsed deadline, when the lecturer gave one precise enough to resolve. */
  due: number | null;
};

export type TaskBucket = "overdue" | "today" | "soon" | "later" | "undated" | "done";

const DAY = 86_400_000;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Which group a task belongs to, from the student's point of view rather
 *  than the calendar's: "soon" is the next week, which is the horizon anyone
 *  actually plans against. */
export function bucketOf(task: SourcedTask, now = Date.now()): TaskBucket {
  if (task.done) return "done";
  if (task.due === null) return "undated";
  const today = startOfDay(now);
  const due = startOfDay(task.due);
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= today + 7 * DAY) return "soon";
  return "later";
}

/**
 * Whether a lecture's extracted work has been put to the student yet.
 *
 * Lectures analysed before task confirmation existed have no `accepted` list
 * at all. Those are legacy: everything in them was already showing as a real
 * task, and quietly demoting a semester of work back to "unconfirmed" would
 * be the app losing the student's data in front of them. So absent means
 * "already accepted", and only lectures that went through the new flow — which
 * writes an empty list — have candidates.
 */
const decided = (lecture: Lecture) => lecture.accepted;

const sourced = (lecture: Lecture, task: LectureTask, index: number, done: Set<number>): SourcedTask => {
  const parsed = task.dueISO ? Date.parse(task.dueISO) : NaN;
  return {
    key: `${lecture.id}:${index}`,
    task,
    index,
    lectureId: lecture.id,
    lectureTitle: lecture.title,
    lectureAt: lecture.at,
    done: done.has(index),
    due: Number.isFinite(parsed) ? parsed : null,
  };
};

/**
 * Every confirmed task, newest lecture first.
 *
 * Confirmed means the student either accepted it or it predates the
 * confirmation step. Anything they said was not a task is gone from here for
 * good — being asked twice about the same wrong sentence is worse than not
 * being asked at all.
 */
export function tasksOf(lectures: Lecture[]): SourcedTask[] {
  const out: SourcedTask[] = [];

  for (const lecture of lectures) {
    const done = new Set(lecture.done ?? []);
    const dismissed = new Set(lecture.dismissed ?? []);
    const accepted = decided(lecture);
    (lecture.analysis?.tasks ?? []).forEach((task, index) => {
      if (dismissed.has(index)) return;
      if (accepted !== undefined && !accepted.includes(index)) return;
      out.push(sourced(lecture, task, index, done));
    });
  }

  return out;
}

/**
 * Work the lecturer mentioned that the student has not ruled on yet.
 *
 * These are offered, not imposed. "Solve chapter four" said as an aside in a
 * digression is not an assignment, and a to-do list that fills itself with
 * things nobody agreed to is one a student stops trusting — and then stops
 * reading.
 */
export function candidatesOf(lectures: Lecture[]): SourcedTask[] {
  const out: SourcedTask[] = [];

  for (const lecture of lectures) {
    const accepted = decided(lecture);
    if (accepted === undefined) continue;
    const dismissed = new Set(lecture.dismissed ?? []);
    const done = new Set(lecture.done ?? []);
    (lecture.analysis?.tasks ?? []).forEach((task, index) => {
      if (dismissed.has(index) || accepted.includes(index)) return;
      out.push(sourced(lecture, task, index, done));
    });
  }

  return out;
}

export const allTasks = async () => tasksOf(await getLectures());

const ORDER: TaskBucket[] = ["overdue", "today", "soon", "later", "undated", "done"];

/** Grouped and sorted for display: dated tasks by how soon, undated by how
 *  recently the lecture was, so the newest lecture's work is at the top. */
export function groupTasks(tasks: SourcedTask[], now = Date.now()) {
  const groups = new Map<TaskBucket, SourcedTask[]>();
  for (const task of tasks) {
    const bucket = bucketOf(task, now);
    const list = groups.get(bucket) ?? [];
    list.push(task);
    groups.set(bucket, list);
  }

  for (const [bucket, list] of groups) {
    list.sort((a, b) => {
      if (a.due !== null && b.due !== null) return a.due - b.due;
      if (a.due !== null) return -1;
      if (b.due !== null) return 1;
      return b.lectureAt - a.lectureAt;
    });
    groups.set(bucket, list);
  }

  return ORDER.filter((bucket) => (groups.get(bucket)?.length ?? 0) > 0).map((bucket) => ({
    bucket,
    tasks: groups.get(bucket)!,
  }));
}

/** What the home screen needs to say "here is what today looks like". */
export function taskSummary(tasks: SourcedTask[], now = Date.now()) {
  const open = tasks.filter((task) => !task.done);
  const counted = (bucket: TaskBucket) =>
    open.filter((task) => bucketOf(task, now) === bucket).length;
  return {
    open: open.length,
    overdue: counted("overdue"),
    today: counted("today"),
    soon: counted("soon"),
    done: tasks.length - open.length,
  };
}
