import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { pack } from "../src/scanners";
import { theme } from "../src/theme";
import { completeOnboarding, type Profile } from "../src/storage";

/**
 * Intro → questions → AI disclosure → "preparing" → home.
 *
 * The questions are not theatre: `region` sets the currency used for cost
 * estimates and narrows which species/models are likely, and the answers are
 * passed to the vision prompt as user context.
 */
export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>({});
  const [saving, setSaving] = useState(false);

  const INTRO = 0;
  const questionCount = pack.onboarding.length;
  const CONSENT = questionCount + 1;
  const total = questionCount + 2;

  const next = () => setStep((s) => s + 1);

  const answer = (key: string, value: string) => {
    Haptics.selectionAsync();
    setProfile((p) => ({ ...p, [key]: value }));
    next();
  };

  const finish = async () => {
    setSaving(true);
    await completeOnboarding(profile);
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.progressTrack}>
        <View
          style={[styles.progressFill, { width: `${(step / total) * 100}%` }]}
        />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {step === INTRO && (
          <View style={styles.center}>
            <Text style={styles.appName}>{pack.appName}</Text>
            <Text style={styles.tagline}>{pack.tagline}</Text>
            <Text style={styles.introNote}>
              أربع أسئلة سريعة منشان نضبط النتائج على حالتك.
            </Text>
          </View>
        )}

        {step > INTRO && step < CONSENT && (
          <View>
            <Text style={styles.stepLabel}>
              سؤال {step} من {questionCount}
            </Text>
            <Text style={styles.question}>
              {pack.onboarding[step - 1].question}
            </Text>
            <View style={styles.options}>
              {pack.onboarding[step - 1].options.map((option) => (
                <Pressable
                  key={option}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                  onPress={() => answer(pack.onboarding[step - 1].key, option)}
                >
                  <Text style={styles.optionText}>{option}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === CONSENT && (
          <View>
            <Text style={styles.question}>قبل ما نبدأ</Text>
            <View style={styles.consentCard}>
              <Text style={styles.consentText}>
                لما تصوّر، بنرسل الصورة لخدمة ذكاء اصطناعي خارجية
                (Anthropic Claude) عشان تحللها وترجع النتيجة.
              </Text>
              <Text style={styles.consentText}>
                ما بنخزّن صورك على خوادمنا، وما بنربطها باسمك. الفحوصات
                بتنحفظ على جهازك بس.
              </Text>
              <Text style={styles.consentWarn}>{pack.disclaimer}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {(step === INTRO || step === CONSENT) && (
        <View style={styles.footer}>
          <Pressable
            style={styles.cta}
            onPress={step === INTRO ? next : finish}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#0C0E13" />
            ) : (
              <Text style={styles.ctaText}>
                {step === INTRO ? "يلا نبدأ" : "موافق، ابدأ"}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  progressTrack: {
    height: 3,
    backgroundColor: theme.surfaceAlt,
    marginHorizontal: 20,
    borderRadius: 2,
    marginTop: 8,
  },
  progressFill: { height: 3, backgroundColor: theme.accent, borderRadius: 2 },
  body: { padding: 24, paddingTop: 40, flexGrow: 1 },
  center: { flex: 1, justifyContent: "center" },
  appName: {
    color: theme.text,
    fontSize: 40,
    fontWeight: "800",
    textAlign: "center",
  },
  tagline: {
    color: theme.textSoft,
    fontSize: 18,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 30,
  },
  introNote: {
    color: theme.textFaint,
    fontSize: 14,
    textAlign: "center",
    marginTop: 28,
  },
  stepLabel: { color: theme.accent, fontSize: 13, fontWeight: "600" },
  question: {
    color: theme.text,
    fontSize: 26,
    fontWeight: "700",
    marginTop: 10,
    lineHeight: 38,
  },
  options: { marginTop: 28, gap: 10 },
  option: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  optionPressed: { backgroundColor: theme.surfaceAlt, borderColor: theme.accent },
  optionText: { color: theme.text, fontSize: 17 },
  consentCard: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    marginTop: 24,
    gap: 14,
  },
  consentText: { color: theme.textSoft, fontSize: 15, lineHeight: 26 },
  consentWarn: {
    color: theme.textFaint,
    fontSize: 13,
    lineHeight: 22,
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
  ctaText: { color: "#0C0E13", fontSize: 17, fontWeight: "700" },
});
