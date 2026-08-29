import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, Linking } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { pack, activePackId, isAudio, isProgram, isScanner } from "../../src/packs";
import { privacyUrl, supportUrl, termsUrl } from "../../src/legal";
import { switchLanguage, languageChoices, currentLanguageName } from "../../src/language";
import { t, locale } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import { UI_FONT } from "../../src/ui-font";
import { theme } from "../../src/theme";
import { clearHistory, getProfile, updateProfile, type Profile } from "../../src/storage";
import { resetProgress } from "../../src/progress";
import { deleteAllLectures } from "../../src/lectures";
import { DEFAULT_HOUR, cancelReminder, getReminderHour, scheduleReminder } from "../../src/reminders";
import { restoreAndReport } from "../../src/purchases";
import { CountryField } from "../../src/components/CountryField";
import { countryLabel } from "../../src/countries";
import { SafeAreaView } from "react-native-safe-area-context";
import { NAV_CLEARANCE } from "../../src/components/ScannerNav";
import { READ } from "../../src/scanner-ui";

function Row({
  label,
  value,
  onPress,
  danger,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Text style={[styles.rowLabel, danger && styles.danger]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
    </Pressable>
  );
}

/** Whether this build carries the scanner shell rather than a stack header. */
const scanner = isScanner(pack);

export default function Settings() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [reminderHour, setReminderHour] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      getProfile().then(setProfile);
      getReminderHour().then(setReminderHour);
    }, []),
  );

  const toggleReminder = async () => {
    if (reminderHour !== null) {
      await cancelReminder();
      setReminderHour(null);
      return;
    }
    const scheduled = await scheduleReminder(DEFAULT_HOUR);
    setReminderHour(scheduled);
    if (scheduled === null) {
      Alert.alert(
        t(ui.notificationsBlocked),
        t(ui.notificationsBlockedBody),
      );
    }
  };

  const shiftReminder = async () => {
    const next = ((reminderHour ?? DEFAULT_HOUR) + 1) % 24;
    const scheduled = await scheduleReminder(next);
    if (scheduled !== null) setReminderHour(scheduled);
  };

  const confirmReset = () =>
    Alert.alert(t(ui.resetProgressQ), t(ui.resetProgressBody), [
      { text: t(ui.cancel), style: "cancel" },
      {
        text: t(ui.resetDo),
        style: "destructive",
        onPress: async () => {
          await resetProgress();
          Alert.alert(t(ui.resetDone), t(ui.resetDoneBody));
        },
      },
    ]);

  const confirmClear = () =>
    Alert.alert(t(ui.clearScansQ), t(ui.clearScansBody), [
      { text: t(ui.cancel), style: "cancel" },
      {
        text: t(ui.clearDo),
        style: "destructive",
        onPress: async () => {
          await clearHistory();
          Alert.alert(t(ui.clearDone), t(ui.clearDoneBody));
        },
      },
    ]);

  const confirmClearLectures = () =>
    Alert.alert(t(ui.clearLecturesQ), t(ui.clearLecturesBody), [
      { text: t(ui.cancel), style: "cancel" },
      {
        text: t(ui.clearDo),
        style: "destructive",
        onPress: async () => {
          await deleteAllLectures();
          Alert.alert(t(ui.clearDone), t(ui.clearLecturesDoneBody));
        },
      },
    ]);

  // The alerts live with the purchase code so this screen and the paywall
  // cannot answer the same tap differently.
  const doRestore = () => void restoreAndReport();


  return (
    <View style={styles.screen}>
      {/* The scanners hide the stack header and carry their own chrome, so
          this screen supplies the title and the way back to the camera.
          Mahdar keeps its stack header, and gets neither. */}
      <SafeAreaView style={styles.screen} edges={scanner ? ["top"] : []}>
        {scanner ? <Text style={styles.pageTitle}>{t(ui.settings)}</Text> : null}
        <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>{t(ui.general)}</Text>
      <View style={styles.group}>
        <Row
          label={t(ui.yourCountry)}
          value={profile.region ? countryLabel(profile.region) : t(ui.notSet)}
          onPress={() => router.push("/change-country")}
        />
        {isScanner(pack) && pack.library ? (
          <Row label={pack.libraryTitle ? t(pack.libraryTitle) : t(ui.guide)} onPress={() => router.push("/library")} />
        ) : null}
        {isProgram(pack) ? (
          <Row label={t(pack.nouns.plan)} onPress={() => router.push("/plan")} />
        ) : null}
      </View>

      {isProgram(pack) ? (
        <>
          <Text style={styles.section}>{t(ui.dailyReminder)}</Text>
          <View style={styles.group}>
            <Row
              label={t(reminderHour !== null ? ui.reminderOn : ui.reminderEnable)}
              value={reminderHour !== null ? `${reminderHour}:00` : t(ui.reminderOff)}
              onPress={toggleReminder}
            />
            {reminderHour !== null ? (
              <Row label={t(ui.reminderLater)} onPress={shiftReminder} />
            ) : null}
          </View>
          <Text style={styles.note}>{t(ui.reminderLocalNote)}</Text>
        </>
      ) : null}

      <Text style={styles.section}>{t(ui.language)}</Text>
      <View style={styles.group}>
        <Row
          label={t(ui.language)}
          value={locale === "ar" ? "العربية" : "English"}
          onPress={() =>
            /* A list, not a toggle. Each language is named in itself, which is
               the only label a speaker of it can be relied on to recognise. */
            Alert.alert(t(ui.language), t(ui.confirmSwitchLanguage), [
              ...languageChoices()
                .filter((l) => !l.current)
                .map((l) => ({ text: l.name, onPress: () => void switchLanguage(l.code) })),
              { text: t(ui.home), style: "cancel" as const },
            ])
          }
        />
      </View>

      <Text style={styles.section}>{t(ui.sectionSubscription)}</Text>
      <View style={styles.group}>
        <Row label={t(ui.upgrade)} onPress={() => router.push("/paywall")} />
        <Row label={t(ui.restorePurchase)} onPress={doRestore} />
      </View>

      <Text style={styles.section}>{t(ui.sectionData)}</Text>
      <View style={styles.group}>
        {/* Three ways, like the note below it. This was a two-way branch, so
            an audio pack fell into the scanner arm: Mahdar offered "Delete all
            scans", and the handler cleared a key Mahdar never writes — it
            confirmed, said "Deleted", and left every lecture in place. */}
        {isProgram(pack) ? (
          <Row label={t(ui.resetProgress)} onPress={confirmReset} danger />
        ) : isAudio(pack) ? (
          <Row label={t(ui.clearLectures)} onPress={confirmClearLectures} danger />
        ) : (
          <Row label={t(ui.clearScans)} onPress={confirmClear} danger />
        )}
      </View>
      <Text style={styles.note}>
        {t(
          isProgram(pack)
            ? ui.dataStaysLocalProgram
            : isAudio(pack)
              ? ui.dataStaysLocalAudio
              : ui.dataStaysLocalScanner,
        )}
      </Text>

      <Text style={styles.section}>{t(ui.sectionAbout)}</Text>
      <View style={styles.group}>
        <Row label={t(ui.version)} value={Constants.expoConfig?.version ?? "—"} />
        <Row
          label={t(ui.privacyPolicy)}
          onPress={() =>
            Linking.openURL(privacyUrl()).catch(() =>
              Alert.alert(t(ui.couldNotOpen), privacyUrl()),
            )
          }
        />
        <Row
          label={t(ui.terms)}
          onPress={() =>
            Linking.openURL(termsUrl()).catch(() => Alert.alert(t(ui.couldNotOpen), termsUrl()))
          }
        />
        <Row
          label={t(ui.support)}
          onPress={() =>
            Linking.openURL(supportUrl()).catch(() =>
              Alert.alert(t(ui.couldNotOpen), supportUrl()),
            )
          }
        />
      </View>

      <Text style={styles.disclaimer}>{t(pack.disclaimer)}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: NAV_CLEARANCE },
  pageTitle: {
    color: theme.text,
    fontSize: 24,
    fontFamily: UI_FONT.bold,
    textAlign: READ,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  section: {
    color: theme.textFaint,
    fontSize: 12,
    fontFamily: UI_FONT.bold,
    marginTop: 22,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  group: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  rowLabel: { color: theme.text, fontSize: 16 },
  rowValue: { color: theme.textFaint, fontSize: 15 },
  danger: { color: theme.critical },
  note: { color: theme.textFaint, fontSize: 13, fontFamily: UI_FONT.regular, lineHeight: 22, marginTop: 10, paddingHorizontal: 4 },
  disclaimer: {
    color: theme.textFaint,
    fontSize: 12, fontFamily: UI_FONT.regular,
    lineHeight: 21,
    marginTop: 28,
    paddingHorizontal: 4,
  },
  pickerHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  pickerTitle: { color: theme.text, fontSize: 20, fontFamily: UI_FONT.bold },
  cancel: { color: theme.accent, fontSize: 16 },
  pickerBody: { flex: 1, paddingHorizontal: 16 },
});
