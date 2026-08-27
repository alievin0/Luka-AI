import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack, isAudio, activePackId } from "../src/packs";
import { t, locale } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { getProfile, profileSummary } from "../src/storage";
import {
  emphasisCandidates,
  getLecture,
  mergeTranscript,
  transcriptOfSegments,
  updateLecture,
} from "../src/lectures";
import { analyseLecture, transcribeLecture, LectureError } from "../src/lecture-api";
import {
  GOLD,
  GOLD_DEEP,
  BLOOM,
  TEXT_FAINT,
  audio as s,
} from "../src/components/audio-theme";
import { FONTS } from "../src/type";

/** How long each line of "what we're doing right now" stays up. */
const STEP_MS = 2600;

export default function Analyzing() {
  const router = useRouter();
  const { id, retranscribe } = useLocalSearchParams<{ id: string; retranscribe?: string }>();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [spin]);

  /* The line changes on a fade rather than a cut, so the screen reads as
   * working through something instead of flicking between labels. */
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [step, fade]);

  useEffect(() => {
    const timer = setInterval(() => setStep((n) => n + 1), STEP_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const lecture = await getLecture(String(id));
      if (!lecture) {
        if (!cancelled) router.replace("/");
        return;
      }

      try {
        let segments = lecture.segments;

        // The accurate pass runs when the student asked for it, when the live
        // writer stopped before the lecture did, or when it produced nothing
        // worth analysing — never on top of a transcript that is usable.
        const needsTranscription =
          retranscribe === "1" ||
          lecture.liveWriterFailed === true ||
          transcriptOfSegments(segments).length < 40;

        if (needsTranscription && lecture.audioChunks?.length) {
          const result = await transcribeLecture({ chunks: lecture.audioChunks });
          // Persist before honouring the cancel flag. This transcript has
          // already been paid for; dropping it because the student navigated
          // away means billing them again for the same audio.
          segments = mergeTranscript(result.segments, lecture.segments);
          await updateLecture(lecture.id, { segments, liveWriterFailed: false });
          if (cancelled) return;
        }

        if (transcriptOfSegments(segments).length < 20) {
          throw new LectureError("empty");
        }

        const profile = await getProfile();
        const { title, analysis } = await analyseLecture({
          packId: activePackId,
          segments,
          emphasis: emphasisCandidates(segments).map((seg) => ({
            at: seg.at,
            text: seg.text,
            marked: seg.marked,
          })),
          profile: profileSummary(profile),
          duration: lecture.duration,
          recordedAt: lecture.at,
        });
        if (cancelled) return;

        await updateLecture(lecture.id, {
          segments,
          analysis,
          // A title the student already typed is theirs; never overwrite it.
          title: lecture.title || title || t(ui.untitledLecture),
          // done[] holds indices into the previous task list. A re-analysis
          // returns a different list, so keeping them would tick off whatever
          // now sits at those positions — unrelated tasks, silently.
          done: [],
          status: "ready",
          error: undefined,
        });
        router.replace({ pathname: "/lecture", params: { id: lecture.id } });
      } catch (caught) {
        if (cancelled) return;
        const message =
          caught instanceof LectureError && caught.message === "offline"
            ? t(ui.offline)
            : caught instanceof LectureError && caught.message === "empty"
              ? t(ui.transcribeFailed)
              : caught instanceof LectureError
                ? caught.message
                : t(ui.serverError);
        await updateLecture(String(id), { status: "failed", error: message });
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, retranscribe, router]);

  if (!isAudio(pack)) return null;

  const steps = pack.voice.analysingSteps;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const counter = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });

  return (
    <View style={s.root}>
      <LinearGradient colors={BLOOM} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.wordmarkWrap}>
          <View style={s.langPill}>
            <Text style={s.langText}>{locale === "ar" ? "EN" : "ع"}</Text>
          </View>
          <Text style={s.wordmarkLatin}>{pack.wordmark}</Text>
          <Text style={s.wordmarkDot}>•</Text>
          <Text style={s.wordmarkArabic}>{t(pack.appName)}</Text>
        </View>

        <View style={styles.centre}>
          {error ? (
            <>
              <Text style={styles.errorTitle}>{error}</Text>
              <View style={styles.errorActions}>
                <Pressable
                  style={({ pressed }) => [styles.retry, pressed && s.pressed]}
                  onPress={() => router.replace({ pathname: "/lecture", params: { id: String(id) } })}
                >
                  <Text style={styles.retryText}>{t(ui.tabTranscript)}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.ghost, pressed && s.pressed]}
                  onPress={() => router.replace("/")}
                >
                  <Text style={styles.ghostText}>{t(ui.home)}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.rings}>
                <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
                <Animated.View style={[styles.ringInner, { transform: [{ rotate: counter }] }]} />
                <View style={styles.ringCore} />
              </View>
              <Text style={styles.title}>{t(pack.voice.analysing)}</Text>
              <Animated.Text style={[styles.step, { opacity: fade }]}>
                {t(steps[step % steps.length])}
              </Animated.Text>
            </>
          )}
        </View>

        <Text style={s.footer}>{t(pack.voice.footer)}</Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 30, paddingHorizontal: 32 },
  rings: { width: 104, height: 104, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 1.5,
    borderColor: "transparent",
    borderTopColor: GOLD,
    borderRightColor: "rgba(217,190,131,0.22)",
  },
  ringInner: {
    position: "absolute",
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 1.5,
    borderColor: "transparent",
    borderBottomColor: GOLD_DEEP,
  },
  ringCore: { width: 7, height: 7, borderRadius: 4, backgroundColor: GOLD, opacity: 0.85 },
  /* The manuscript face, used here and on the wordmark and nowhere else. */
  title: {
    color: "#F5EEDF",
    fontSize: 34,
    fontFamily: FONTS.scriptItalic,
    lineHeight: 56,
    textAlign: "center",
  },
  step: {
    color: TEXT_FAINT,
    fontSize: 14,
    textAlign: "center",
    fontFamily: FONTS.body,
    letterSpacing: 0.2,
  },
  errorTitle: {
    color: "#E8E0CE",
    fontSize: 16,
    lineHeight: 32,
    textAlign: "center",
    fontFamily: FONTS.body,
  },
  errorActions: { flexDirection: "row", gap: 10 },
  retry: { backgroundColor: GOLD, borderRadius: 999, paddingVertical: 15, paddingHorizontal: 24 },
  retryText: { color: "#0E0D0B", fontSize: 15, fontFamily: FONTS.displayBold },
  ghost: {
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 24,
  },
  ghostText: { color: "#E8E0CE", fontSize: 15, fontFamily: FONTS.bodyMedium },
});
