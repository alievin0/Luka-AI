import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { activePackId, pack } from "./packs";
import { t, fill } from "./i18n";
import { ui } from "./i18n/ui";
import { currentTrial } from "./purchases";

/**
 * A single daily local reminder.
 *
 * Streak-based programs live or die on people coming back, and a local
 * notification is the only retention lever that works without a server.
 * Local only — no push tokens, no backend, and it keeps working offline.
 */

const KEY = `@${activePackId}:reminderHour`;
const IDENTIFIER = `${activePackId}-daily`;
const TRIAL_ID = `${activePackId}-trial-ending`;

export const DEFAULT_HOUR = 19;

/* ------------------------------------------------------ where a tap belongs

   A notification is a sentence about one screen, and tapping it should open
   that screen. Both of these used to open wherever the app was last left —
   which for the trial notice meant reading "you will be charged tomorrow" and
   landing on the camera, with the setting that stops the charge two taps away
   and unnamed.

   The route travels in the notification's own payload, so it survives the app
   being killed between the schedule and the tap. That payload is data, not
   code: it is matched against this list rather than handed to the router, so
   a route can never arrive from anywhere but here. */

const ROUTES = ["/", "/settings"] as const;
export type ReminderRoute = (typeof ROUTES)[number];

export function routeOfNotification(data: unknown): ReminderRoute | null {
  const route = (data as { route?: unknown } | null | undefined)?.route;
  return typeof route === "string" && (ROUTES as readonly string[]).includes(route)
    ? (route as ReminderRoute)
    : null;
}

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
      name: t(ui.dailyReminder),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: IDENTIFIER,
    content: {
      title: t(pack.appName),
      body:
        pack.kind === "program"
          ? t(ui.reminderBody)
          : t(ui.reminderBodyScanner),
      data: { route: "/" satisfies ReminderRoute },
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

/* --------------------------------------------------------- the trial notice */

/**
 * One notification, a day before a free trial turns into a charge.
 *
 * This is here to lose revenue on purpose. A weekly plan on an app people
 * open two to four times a year will collect from anyone who loses track of
 * the date, and the decision recorded in the runbook's §4a is that it should
 * not: someone pays because the app was worth it, or they do not pay. Telling
 * them plainly, a day out, is what that decision costs.
 *
 * It re-syncs rather than schedules once, because the thing it describes can
 * stop being true — cancel auto-renewal and the charge is not coming, and a
 * notification insisting otherwise is exactly the false claim this app spends
 * so much effort not making. `currentTrial()` returns null in that case, and
 * this cancels.
 *
 * Silent when notifications were never permitted. Asking for permission over
 * a warning that a charge is due reads as a threat rather than a courtesy, so
 * it only schedules where the daily reminder already earned the grant.
 */
export async function syncTrialEndingReminder(): Promise<boolean> {
  await Notifications.cancelScheduledNotificationAsync(TRIAL_ID).catch(() => {});

  const trial = await currentTrial();
  if (!trial) return false;

  const when = new Date(trial.endsAt - 24 * 60 * 60 * 1000);
  // A trial shorter than a day, or one already inside its final day, has no
  // "tomorrow" to warn about. Saying so late is worse than not saying it.
  if (when.getTime() <= Date.now()) return false;

  const granted = (await Notifications.getPermissionsAsync()).granted;
  if (!granted) return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("trial", {
      name: t(ui.trialEndsTitle),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: TRIAL_ID,
    content: {
      title: t(ui.trialEndsTitle),
      body: trial.price
        ? fill(ui.trialEndsBody, { price: trial.price })
        : t(ui.trialEndsBodyNoPrice),
      /* Settings, not the camera: the screen this sentence is about is the
         one carrying Restore and the link out to the subscription. */
      data: { route: "/settings" satisfies ReminderRoute },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: "trial" },
  });
  return true;
}
