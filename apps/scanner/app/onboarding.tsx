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
  TextInput,
  type ImageSourcePropType,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { pack, activePackId, isAudio, isScanner, optionLabel, optionValue } from "../src/packs";
import { t, isRTL } from "../src/i18n";
import { switchLanguage, languageChoices } from "../src/language";
import { ui } from "../src/i18n/ui";
import { UI_FONT } from "../src/ui-font";
import { theme, withAlpha } from "../src/theme";
import { READ } from "../src/scanner-ui";
import { completeOnboarding, type Profile } from "../src/storage";
import { CountryField } from "../src/components/CountryField";
import { privacyUrl } from "../src/legal";
import type { Country } from "../src/countries";

/** Every pack that has a generated mark shows it on the intro. A pack absent
 *  from this map opens on a wordless screen, which reads as an unfinished
 *  app on the one screen that has to earn the next tap. */
const MARKS: Record<string, ImageSourcePropType> = {
  dashlight: require("../assets/dashlight/splash-icon.png"),
  bugscan: require("../assets/bugscan/splash-icon.png"),
  goldscan: require("../assets/goldscan/splash-icon.png"),
  womensfit: require("../assets/womensfit/splash-icon.png"),
  dogtrain: require("../assets/dogtrain/splash-icon.png"),
  mahdar: require("../assets/mahdar/splash-icon.png"),
};

/**
 * Intro → disclosure → home. Two screens, for a scanner.
 *
 * It used to ask its questions here, and for a scanner that was the wrong
 * moment. Someone opens this app because a light has just come on: seven
 * questions and a paywall stand between them and the one thing they came for,
 * and none of the answers improves the verdict — they sharpen the cost
 * estimate and the car-specific note, both of which are in the paid report.
 *
 * So the questions moved to the first result, where they have a reason: the
 * driver has an answer in front of them and is being offered a sharper one.
 * Same questions, same `pack.onboarding` content, asked when they are worth
 * answering.
 *
 * The AI disclosure stays here and cannot move. App Review has required it
 * before the first call since November 2025, and the first call is the first
 * scan.
 *
 * Programs and the lecture app keep the old flow. Their value is not one
 * photograph away — a workout plan is built out of the answers before there is
 * anything to show — so for them the questions are the product starting, not a
 * queue in front of it.
 */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>({});
  const [saving, setSaving] = useState(false);

  // A scanner earns the right to ask by answering first. See the note above.
  const asksUpFront = !isScanner(pack);
  const questions = asksUpFront ? pack.onboarding : [];
  const INTRO = 0;
  // The country is only asked where the questions are. Elsewhere it comes from
  // the device, which already knows it — see deviceCountry() in countries.ts.
  const COUNTRY = asksUpFront ? questions.length + 1 : -1;
  const CONSENT = questions.length + (asksUpFront ? 2 : 1);
  const total = questions.length + (asksUpFront ? 3 : 2);

  const next = () => setStep((s) => s + 1);

  const answer = (key: string, value: string) => {
    Haptics.selectionAsync();
    setProfile((p) => ({ ...p, [key]: value }));
    next();
  };

  const pickCountry = (country: Country) => {
    setProfile((p) => ({ ...p, region: country.code }));
    next();
  };

  const finish = async () => {
    setSaving(true);
    await completeOnboarding(profile);
    router.replace("/");
  };

  const isQuestion = step > INTRO && step < COUNTRY;
  const current = questions[step - 1];

  /** The typed answer for the step showing a field, cleared on the way out. */
  const [typed, setTyped] = useState("");
  const submitTyped = () => {
    const value = typed.trim();
    if (value) setProfile((p) => ({ ...p, [current.key]: value }));
    setTyped("");
    next();
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[withAlpha(theme.accent, 0.16), theme.bg, theme.bg]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        {/* Dots rather than a bar: four questions is a countable number, and
            seeing three left to go is more reassuring than a sliver of fill. */}
        <View style={styles.dots}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.dot, i <= step && styles.dotOn]} />
          ))}
        </View>

        {step === INTRO ? (
          <View style={styles.intro}>
            <Image source={MARKS[activePackId]} style={styles.mark} resizeMode="contain" />
            <Text style={styles.appName}>{t(pack.appName)}</Text>
            <Text style={styles.tagline}>{t(pack.tagline)}</Text>
            <Text style={styles.introNote}>
              {t(ui.quickQuestions)}
            </Text>

            {/* The language, offered before anything is asked rather than
                buried in Settings.

                It was reachable only after onboarding, so someone whose phone
                is set to English answered seven questions in English before
                finding out the app speaks Arabic — and switching then costs a
                reload, which is why it belongs here: nothing has been answered
                yet, so nothing is lost by restarting. */}
            <View style={styles.langRow}>
              {languageChoices().map((lang) => (
                <Pressable
                  key={lang.code}
                  onPress={() => void switchLanguage(lang.code)}
                  style={[styles.lang, lang.current && styles.langOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: lang.current }}
                >
                  <Text style={[styles.langText, lang.current && styles.langTextOn]}>
                    {lang.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : isQuestion ? (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.stepLabel}>
              {t(ui.questionOf)} {step} {t(ui.of)} {questions.length + 1}
            </Text>
            <Text style={styles.question}>{t(current.question)}</Text>
            {current.hint ? <Text style={styles.subQuestion}>{t(current.hint)}</Text> : null}

            {current.input ? (
              /* Some answers cannot be listed — there is no useful menu of
                 every car model — so those are typed. Continue stays enabled
                 on an empty field: this is worth asking, not worth blocking
                 someone on. */
              <View style={styles.typed}>
                <TextInput
                  style={styles.typedInput}
                  value={typed}
                  onChangeText={setTyped}
                  placeholder={t(current.input.placeholder)}
                  placeholderTextColor={theme.textFaint}
                  keyboardType={current.input.keyboard ?? "default"}
                  maxLength={current.input.maxLength}
                  textAlign={READ}
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={submitTyped}
                />
                <Pressable
                  style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
                  onPress={submitTyped}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaText}>{t(ui.continueLabel)}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.options}>
                {(current.options ?? []).map((option) => (
                  <Pressable
                    key={t(optionLabel(option))}
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                    onPress={() => answer(current.key, optionValue(option, t))}
                  >
                    <Text style={styles.optionText}>{t(optionLabel(option))}</Text>
                    <Text style={styles.chevron}>{isRTL ? "‹" : "›"}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Every answer improves the reading, none of them is required.
                Forcing a choice from someone who genuinely does not know
                their fuel type buys a wrong answer rather than a blank. */}
            <Pressable onPress={next} hitSlop={10} accessibilityRole="button" style={styles.skip}>
              <Text style={styles.skipText}>{t(ui.skipQuestion)}</Text>
            </Pressable>
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
                <ActivityIndicator color={theme.onAction} />
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
  langRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 26 },
  lang: {
    minWidth: 96,
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: withAlpha(theme.text, 0.22),
    alignItems: "center",
  },
  langOn: { borderColor: theme.accent, backgroundColor: withAlpha(theme.accent, 0.14) },
  langText: { color: withAlpha(theme.text, 0.7), fontSize: 15, fontFamily: UI_FONT.medium },
  langTextOn: { color: theme.text, fontFamily: UI_FONT.bold },

  dots: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginTop: 14,
    marginHorizontal: 24,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.surfaceAlt },
  dotOn: { backgroundColor: theme.accent },

  intro: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  mark: { width: 116, height: 116, marginBottom: 32 },
  appName: { color: theme.text, fontSize: 38, fontFamily: UI_FONT.bold, textAlign: "center" },
  tagline: {
    color: theme.textSoft,
    fontSize: 18, fontFamily: UI_FONT.regular,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 31,
  },
  introNote: { color: theme.textFaint, fontSize: 14, fontFamily: UI_FONT.regular, textAlign: "center", marginTop: 26 },

  body: { padding: 24, paddingTop: 36, flexGrow: 1 },
  stepLabel: { color: theme.accent, fontSize: 13, fontFamily: UI_FONT.bold },
  question: {
    color: theme.text,
    fontSize: 27,
    fontFamily: UI_FONT.bold,
    marginTop: 10,
    lineHeight: 40,
  },
  subQuestion: { color: theme.textSoft, fontSize: 15, fontFamily: UI_FONT.regular, marginTop: 6, lineHeight: 26 },
  options: { marginTop: 26, gap: 10 },
  typed: { marginTop: 26, gap: 14 },
  typedInput: {
    minHeight: 56,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingHorizontal: 18,
    color: theme.text,
    fontSize: 17,
    fontFamily: UI_FONT.regular,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  optionPressed: { backgroundColor: theme.surfaceAlt, borderColor: theme.accent },
  optionText: { color: theme.text, fontSize: 17, fontFamily: UI_FONT.regular, flex: 1 },
  chevron: { color: theme.textFaint, fontSize: 22, fontFamily: UI_FONT.regular },

  skip: { alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: 18 },
  skipText: { color: theme.textFaint, fontSize: 15, fontFamily: UI_FONT.medium },

  consentCard: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    marginTop: 24,
    gap: 14,
  },
  consentText: { color: theme.textSoft, fontSize: 15, fontFamily: UI_FONT.regular, lineHeight: 27 },
  consentLink: {
    color: theme.accent,
    fontSize: 14, fontFamily: UI_FONT.regular,
    textDecorationLine: "underline",
    marginTop: 4,
  },
  consentWarn: {
    color: theme.textFaint,
    fontSize: 13, fontFamily: UI_FONT.regular,
    lineHeight: 23,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 14,
  },

  footer: { padding: 24 },
  cta: {
    backgroundColor: theme.action,
    borderRadius: theme.radius,
    minHeight: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { color: theme.onAction, fontSize: 17, fontFamily: UI_FONT.bold },
});
