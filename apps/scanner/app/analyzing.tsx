import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack, isAudio, activePackId } from "../src/packs";
import { t, locale } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { getProfile, profileSummary } from "../src/storage";
import {
  emphasisCandidates,
  getLecture,
  transcriptOfSegments,
  updateLecture,
} from "../src/lectures";
import { analyseLecture, transcribeLecture, LectureError } from "../src/lecture-api";
import { GOLD, audio as s } from "../src/components/audio-theme";

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
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [spin]);

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

        // The accurate pass runs when the student asked for it, or when the
        // live writer produced nothing worth analysing — never on top of a
        // transcript that is already usable.
        const needsTranscription =
          retranscribe === "1" || transcriptOfSegments(segments).length < 40;

        if (needsTranscription && lecture.audioUri) {
          const result = await transcribeLecture({ audioUri: lecture.audioUri });
          if (cancelled) return;
          segments = result.segments;
          await updateLecture(lecture.id, { segments });
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

  return (
    <View style={s.root}>
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
              <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
              <Text style={styles.title}>{t(pack.voice.analysing)}</Text>
              <Text style={styles.step}>{t(steps[step % steps.length])}</Text>
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
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: "#2A2519",
    borderTopColor: GOLD,
  },
  title: {
    color: "#F5EEDF",
    fontSize: 34,
    fontWeight: "600",
    fontStyle: "italic",
    textAlign: "center",
  },
  step: { color: "#8E8676", fontSize: 15, textAlign: "center" },
  errorTitle: { color: "#E8E0CE", fontSize: 17, lineHeight: 32, textAlign: "center" },
  errorActions: { flexDirection: "row", gap: 10 },
  retry: { backgroundColor: GOLD, borderRadius: 999, paddingVertical: 15, paddingHorizontal: 24 },
  retryText: { color: "#0E0D0B", fontSize: 15, fontWeight: "700" },
  ghost: {
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 24,
  },
  ghostText: { color: "#E8E0CE", fontSize: 15, fontWeight: "600" },
});
