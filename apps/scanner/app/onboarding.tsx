import { useState } from "react";
import {
  Linking,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { pack, activePackId, isAudio, isScanner, optionLabel, optionValue } from "../src/packs";
import { t } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { FONTS } from "../src/type";
import { theme, withAlpha } from "../src/theme";
import { completeOnboarding, type Profile } from "../src/storage";
import { CountryField } from "../src/components/CountryField";
import { privacyUrl } from "../src/legal";
import type { Country } from "../src/countries";

/** Every pack that has a generated mark shows it on the intro. A pack absent
 *  from this map opens on a wordless screen, which reads as an unfinished
 *  app on the one screen that has to earn the next tap. */
const MARKS: Record<string, ReturnType<typeof require>> = {
  dashlight: require("../assets/dashlight/splash-icon.png"),
  bugscan: require("../assets/bugscan/splash-icon.png"),
  goldscan: require("../assets/goldscan/splash-icon.png"),
  womensfit: require("../assets/womensfit/splash-icon.png"),
  dogtrain: require("../assets/dogtrain/splash-icon.png"),
  mahdar: require("../assets/mahdar/splash-icon.png"),
};

/**
 * Intro → questions → country → disclosure → home.
 *
 * The questions are not theatre: the country sets the currency used for cost
 * estimates and narrows what's plausible for the region, and every answer is
 * passed to the vision prompt as user context.
 */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>({});
  const [saving, setSaving] = useState(false);

  const questions = pack.onboarding;
  const INTRO = 0;
  const COUNTRY = questions.length + 1;
  const CONSENT = questions.length + 2;
  const total = questions.length + 3;

  const next = () => setStep((s) => s + 1);

  const answer = (key: string, value: string) => {
    Haptics.selectionAsync();
    setProfile((p) => ({ ...p, [key]: value }));
    next();
  };

  const pickCountry = (country: Country) => {
    setProfile((p) => ({ ...p, region: country.name }));
    next();
  };

  const finish = async () => {
    setSaving(true);
    await completeOnboarding(profile);
    router.replace("/");
  };

  const isQuestion = step > INTRO && step < COUNTRY;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[withAlpha(theme.accent, 0.16), theme.bg, theme.bg]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(step / total) * 100}%` }]} />
        </View>

        {step === INTRO ? (
          <View style={styles.intro}>
            <Image source={MARKS[activePackId]} style={styles.mark} resizeMode="contain" />
            <Text style={styles.appName}>{t(pack.appName)}</Text>
            <Text style={styles.tagline}>{t(pack.tagline)}</Text>
            <Text style={styles.introNote}>
              {t(ui.quickQuestions)}
            </Text>
          </View>
        ) : isQuestion ? (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.stepLabel}>
              {t(ui.questionOf)} {step} {t(ui.of)} {questions.length + 1}
            </Text>
            <Text style={styles.question}>{t(questions[step - 1].question)}</Text>
            <View style={styles.options}>
              {questions[step - 1].options.map((option) => (
                <Pressable
                  key={t(optionLabel(option))}
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                  onPress={() =>
                    answer(questions[step - 1].key, optionValue(option, t))
                  }
                >
                  <Text style={styles.optionText}>{t(optionLabel(option))}</Text>
                  <Text style={styles.chevron}>‹</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : step === COUNTRY ? (
          <View style={styles.body}>
            <Text style={styles.stepLabel}>
              {t(ui.questionOf)} {questions.length + 1} {t(ui.of)} {questions.length + 1}
            </Text>
            <Text style={styles.question}>{t(ui.whereAreYou)}</Text>
            <Text style={styles.subQuestion}>
              {isScanner(pack) && pack.showCost
                ? t(ui.whyCountryCost)
                : t(ui.whyCountryRegion)}
            </Text>
            <CountryField onSelect={pickCountry} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.question}>{t(ui.beforeWeStart)}</Text>
            <View style={styles.consentCard}>
              <Text style={styles.consentText}>
                {t(isAudio(pack) ? ui.aiNoticeAudio : ui.aiNotice)}
              </Text>
              <Text style={styles.consentText}>
                {t(isAudio(pack) ? ui.privacyNoticeAudio : ui.privacyNotice)}
              </Text>
              <Text style={styles.consentWarn}>{t(pack.disclaimer)}</Text>
              <Pressable
                onPress={() => Linking.openURL(privacyUrl()).catch(() => undefined)}
                hitSlop={8}
              >
                <Text style={styles.consentLink}>{t(ui.readPrivacyPolicy)}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {(step === INTRO || step === CONSENT) && (
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              onPress={step === INTRO ? next : finish}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={theme.bg} />
              ) : (
                <Text style={styles.ctaText}>
                  {step === INTRO ? t(ui.letsStart) : t(ui.agreeAndStart)}
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1 },
  progressTrack: {
    height: 3,
    backgroundColor: theme.surfaceAlt,
    marginHorizontal: 24,
    borderRadius: 2,
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: { height: 3, backgroundColor: theme.accent, borderRadius: 2 },

  intro: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  mark: { width: 116, height: 116, marginBottom: 32 },
  appName: { color: theme.text, fontSize: 38, fontFamily: FONTS.displayBold, textAlign: "center" },
  tagline: {
    color: theme.textSoft,
    fontSize: 18, fontFamily: FONTS.body,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 31,
  },
  introNote: { color: theme.textFaint, fontSize: 14, fontFamily: FONTS.body, textAlign: "center", marginTop: 26 },

  body: { padding: 24, paddingTop: 36, flexGrow: 1 },
  stepLabel: { color: theme.accent, fontSize: 13, fontFamily: FONTS.displayBold },
  question: {
    color: theme.text,
    fontSize: 27,
    fontFamily: FONTS.displayBold,
    marginTop: 10,
    lineHeight: 40,
  },
  subQuestion: { color: theme.textSoft, fontSize: 15, fontFamily: FONTS.body, marginTop: 6, lineHeight: 26 },
  options: { marginTop: 26, gap: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  optionPressed: { backgroundColor: theme.surfaceAlt, borderColor: theme.accent },
  optionText: { color: theme.text, fontSize: 17, fontFamily: FONTS.body, flex: 1 },
  chevron: { color: theme.textFaint, fontSize: 22, fontFamily: FONTS.body, marginRight: 6 },

  consentCard: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    marginTop: 24,
    gap: 14,
  },
  consentText: { color: theme.textSoft, fontSize: 15, fontFamily: FONTS.body, lineHeight: 27 },
  consentLink: {
    color: theme.accent,
    fontSize: 14, fontFamily: FONTS.body,
    textDecorationLine: "underline",
    marginTop: 4,
  },
  consentWarn: {
    color: theme.textFaint,
    fontSize: 13, fontFamily: FONTS.body,
    lineHeight: 23,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 14,
  },

  footer: { padding: 24 },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { color: theme.bg, fontSize: 17, fontFamily: FONTS.displayBold },
});
