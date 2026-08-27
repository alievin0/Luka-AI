import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { activePackId, pack } from "./packs";

/**
 * A single daily local reminder.
 *
 * Streak-based programs live or die on people coming back, and a local
 * notification is the only retention lever that works without a server.
 * Local only — no push tokens, no backend, and it keeps working offline.
 */

const KEY = `@${activePackId}:reminderHour`;
const IDENTIFIER = `${activePackId}-daily`;

export const DEFAULT_HOUR = 19;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function getReminderHour(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw === null) return null;
  const hour = Number(raw);
  return Number.isFinite(hour) ? hour : null;
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function cancelReminder() {
  await Notifications.cancelScheduledNotificationAsync(IDENTIFIER).catch(() => {});
  await AsyncStorage.removeItem(KEY);
}

/** Returns the hour that was actually scheduled, or null if permission was refused. */
export async function scheduleReminder(hour: number): Promise<number | null> {
  if (!(await ensurePermission())) return null;

  await Notifications.cancelScheduledNotificationAsync(IDENTIFIER).catch(() => {});

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("daily", {
      name: "التذكير اليومي",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: IDENTIFIER,
    content: {
      title: pack.appName,
      body:
        pack.kind === "program"
          ? `وقت ${pack.nouns.session} اليوم — لا تكسر السلسلة`
          : "افتح التطبيق وشوف الجديد",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
      channelId: "daily",
    },
  });

  await AsyncStorage.setItem(KEY, String(hour));
  return hour;
}
