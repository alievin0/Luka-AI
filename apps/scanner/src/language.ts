import { I18nManager, Alert } from "react-native";
import { LOCALES, locale, localeName, rememberLocale, type Locale } from "./i18n";
import { t } from "./i18n";
import { ui } from "./i18n/ui";

/**
 * Switching the app's language.
 *
 * The layout direction is decided by the native layer when the app starts, so
 * flipping between Arabic and English is not something that can happen on a
 * running screen — every already-mounted view keeps the old direction and the
 * result is half a mirrored app. The honest version is: record the choice,
 * turn the direction around, restart.
 *
 * The restart is done for the user rather than asked of them wherever the
 * runtime allows it; Expo Go and dev builds both do.
 */
export async function switchLanguage(next: Locale) {
  if (next === locale) return;

  rememberLocale(next);
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(next === "ar");

  try {
    const Updates = require("expo-updates") as typeof import("expo-updates");
    await Updates.reloadAsync();
    return;
  } catch {
    // No updates runtime (a bare debug build, say). Fall through.
  }

  try {
    const { DevSettings } = require("react-native") as typeof import("react-native");
    DevSettings.reload();
    return;
  } catch {
    // Nothing can restart the app from here — tell the user plainly rather
    // than leaving them on a screen that half-changed.
  }

  Alert.alert(t(ui.languageChanged), t(ui.restartToApply));
}

/**
 * The language list, running language first.
 *
 * This used to be `otherLocale()` — a toggle, which is the right shape for two
 * languages and the wrong one for eight. Callers that offered "switch to the
 * other language" now offer a list.
 */
export const languageChoices = (): { code: Locale; name: string; current: boolean }[] =>
  LOCALES.map((l) => ({ code: l.code, name: l.name, current: l.code === locale }));

export const currentLanguageName = () => localeName();
