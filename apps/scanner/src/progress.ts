import AsyncStorage from "@react-native-async-storage/async-storage";
import { activePackId } from "./packs";

/** Program progress: which sessions are done, and the streak that keeps
 *  someone opening the app tomorrow. Namespaced per pack. */

const k = (name: string) => `@${activePackId}:${name}`;
const KEYS = { completed: k("completed") };

export type Completion = { sessionId: string; at: number };

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export async function getCompletions(): Promise<Completion[]> {
  const raw = await AsyncStorage.getItem(KEYS.completed);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Completion[];
  } catch {
    return [];
  }
}

export async function markComplete(sessionId: string) {
  const completions = [...(await getCompletions()), { sessionId, at: Date.now() }];
  await AsyncStorage.setItem(KEYS.completed, JSON.stringify(completions));
  return completions;
}

export async function resetProgress() {
  await AsyncStorage.removeItem(KEYS.completed);
}

/** Consecutive days ending today or yesterday. Yesterday still counts so a
 *  streak isn't destroyed before the day someone trains is even over. */
export function streakFrom(completions: Completion[]): number {
  if (completions.length === 0) return 0;
  const days = new Set(completions.map((c) => dayKey(c.at)));

  const today = new Date();
  const todayKey = dayKey(today.getTime());
  const yesterday = new Date(today.getTime() - 86_400_000);

  let cursor = days.has(todayKey) ? today : yesterday;
  if (!days.has(dayKey(cursor.getTime()))) return 0;

  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return streak;
}

export const isDoneToday = (completions: Completion[]) =>
  completions.some((c) => dayKey(c.at) === dayKey(Date.now()));

/** Next session in the plan: the first not yet completed, wrapping to the
 *  start once the plan is finished so the app never dead-ends. */
export function nextSessionIndex(completions: Completion[], total: number): number {
  const done = new Set(completions.map((c) => c.sessionId));
  return done.size >= total ? completions.length % total : done.size;
}
