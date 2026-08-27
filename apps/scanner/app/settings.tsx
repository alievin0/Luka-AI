import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, Linking } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { pack, activePackId, isAudio, isProgram, isScanner } from "../src/packs";
import { privacyUrl, supportUrl, termsUrl } from "../src/legal";
import { switchLanguage, otherLocale } from "../src/language";
import { t, locale } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { FONTS } from "../src/type";
import { theme } from "../src/theme";
import { clearHistory, getProfile, updateProfile, type Profile } from "../src/storage";
import { resetProgress } from "../src/progress";
import { DEFAULT_HOUR, cancelReminder, getReminderHour, scheduleReminder } from "../src/reminders";
import { purchasesAvailable, restore } from "../src/purchases";
import { CountryField } from "../src/components/CountryField";

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

export default function Settings() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [editingCountry, setEditingCountry] = useState(false);
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
        "الإشعارات مقفولة",
        "فعّل الإشعارات لهذا التطبيق من إعدادات جهازك عشان يشتغل التذكير.",
      );
    }
  };

  const shiftReminder = async () => {
    const next = ((reminderHour ?? DEFAULT_HOUR) + 1) % 24;
    const scheduled = await scheduleReminder(next);
    if (scheduled !== null) setReminderHour(scheduled);
  };

  const confirmReset = () =>
    Alert.alert("تصفير التقدّم؟", "رح يرجع كل شي للبداية، والسلسلة رح تنكسر.", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "صفّر",
        style: "destructive",
        onPress: async () => {
          await resetProgress();
          Alert.alert("انصفّر", "رجعت للبداية.");
        },
      },
    ]);

  const confirmClear = () =>
    Alert.alert("مسح كل الفحوصات؟", "رح تنمسح كل الفحوصات المحفوظة على جهازك. ما في رجعة.", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "امسح",
        style: "destructive",
        onPress: async () => {
          await clearHistory();
          Alert.alert("انمسحت", "ما ضل ولا فحص محفوظ.");
        },
      },
    ]);

  const doRestore = async () => {
    if (!purchasesAvailable()) {
      Alert.alert("غير متاح", "الاشتراكات مش مفعّلة بهالنسخة.");
      return;
    }
    const restored = await restore();
    Alert.alert(
      restored ? "تمت الاستعادة" : "ما لقينا اشتراك",
      restored ? "اشتراكك رجع فعّال." : "ما في اشتراك سابق على هذا الحساب.",
    );
  };

  if (editingCountry) {
    return (
      <View style={styles.screen}>
        <View style={styles.pickerHead}>
          <Text style={styles.pickerTitle}>غيّر بلدك</Text>
          <Pressable onPress={() => setEditingCountry(false)} hitSlop={10}>
            <Text style={styles.cancel}>إلغاء</Text>
          </Pressable>
        </View>
        <View style={styles.pickerBody}>
          <CountryField
            onSelect={async (country) => {
              setProfile(await updateProfile({ region: country.name }));
              setEditingCountry(false);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.section}>عام</Text>
      <View style={styles.group}>
        <Row
          label="بلدك"
          value={profile.region || "غير محدد"}
          onPress={() => setEditingCountry(true)}
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
          <Text style={styles.section}>التذكير اليومي</Text>
          <View style={styles.group}>
            <Row
              label={reminderHour !== null ? "التذكير مفعّل" : "فعّل التذكير اليومي"}
              value={reminderHour !== null ? `${reminderHour}:00` : "مطفي"}
              onPress={toggleReminder}
            />
            {reminderHour !== null ? (
              <Row label="أخّر ساعة" onPress={shiftReminder} />
            ) : null}
          </View>
          <Text style={styles.note}>
            تذكير محلي على جهازك — ما بيمر على أي خادم.
          </Text>
        </>
      ) : null}

      <Text style={styles.section}>{t(ui.language)}</Text>
      <View style={styles.group}>
        <Row
          label={locale === "ar" ? "العربية" : "English"}
          value={t(ui.language)}
          onPress={() =>
            Alert.alert(t(ui.language), t(ui.confirmSwitchLanguage), [
              { text: t(ui.home), style: "cancel" },
              {
                text: otherLocale() === "ar" ? "العربية" : "English",
                onPress: () => void switchLanguage(otherLocale()),
              },
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
        {isProgram(pack) ? (
          <Row label={t(ui.resetProgress)} onPress={confirmReset} danger />
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 48 },
  section: {
    color: theme.textFaint,
    fontSize: 12,
    fontFamily: FONTS.displayBold,
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
  note: { color: theme.textFaint, fontSize: 13, fontFamily: FONTS.body, lineHeight: 22, marginTop: 10, paddingHorizontal: 4 },
  disclaimer: {
    color: theme.textFaint,
    fontSize: 12, fontFamily: FONTS.body,
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
  pickerTitle: { color: theme.text, fontSize: 20, fontFamily: FONTS.displayBold },
  cancel: { color: theme.accent, fontSize: 16 },
  pickerBody: { flex: 1, paddingHorizontal: 16 },
});
