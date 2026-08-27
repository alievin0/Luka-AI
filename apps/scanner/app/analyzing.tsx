import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack, isAudio, activePackId } from "../src/packs";
import { t } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { getProfile, profileSummary } from "../src/storage";
import {
  emphasisCandidates,
  getLecture,
  mergeTranscript,
  transcriptOfSegments,
  updateLecture,
} from "../src/lectures";
import {
  analyseLecture,
  transcribeLecture,
  LectureError,
  lectureErrorText,
} from "../src/lecture-api";
import { useReducedMotion } from "../src/motion";
import {
  GOLD,
  GOLD_DEEP,
  BLOOM,
  TEXT,
  audio as s,
} from "../src/components/audio-theme";
import { ErrorState, LoadingState, type Step } from "../src/components/kit";
import { FONTS } from "../src/type";

/**
 * The stages of turning an hour of speech into something studyable.
 *
 * These are the real phases of the work, not a carousel of encouraging
 * sentences: the screen advances because a stage genuinely finished. A
 * student who has just recorded a lecture they cannot afford to lose deserves
 * to know which part is happening, not to watch a spinner and guess.
 */
type Phase = "saved" | "transcribing" | "understanding" | "extracting" | "ready";

const PHASES: Phase[] = ["saved", "transcribing", "understanding", "extracting", "ready"];

const PHASE_LABEL: Record<Exclude<Phase, "ready">, typeof ui.stepSaved> = {
  saved: ui.stepSaved,
  transcribing: ui.stepTranscribing,
  understanding: ui.stepMoments,
  extracting: ui.stepTasks,
};

export default function Analyzing() {
  const router = useRouter();
  const { id, retranscribe } = useLocalSearchParams<{ id: string; retranscribe?: string }>();
  const [phase, setPhase] = useState<Phase>("saved");
  const [error, setError] = useState<string | null>(null);
  const spin = useRef(new Animated.Value(0)).current;
  const stillness = useReducedMotion();

  useEffect(() => {
    // The rings are the only continuous movement left in the app, and a
    // spinner someone cannot look at is worse than no spinner: the stage list
    // below already says what is happening.
    if (stillness) return;
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
  }, [spin, stillness]);

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
          setPhase("transcribing");
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

        setPhase("understanding");
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
        setPhase("extracting");

        await updateLecture(lecture.id, {
          segments,
          analysis,
          // A title the student already typed is theirs; never overwrite it.
          title: lecture.title || title || t(ui.untitledLecture),
          // done[] holds indices into the previous task list. A re-analysis
          // returns a different list, so keeping them would tick off whatever
          // now sits at those positions — unrelated tasks, silently. The same
          // reasoning retires the student's earlier accept/dismiss decisions.
          done: [],
          // Extracted work starts as a suggestion. An empty list is what makes
          // these candidates rather than tasks nobody agreed to.
          accepted: [],
          dismissed: [],
          status: "ready",
          error: undefined,
        });
        router.replace({ pathname: "/lecture", params: { id: lecture.id } });
      } catch (caught) {
        if (cancelled) return;
        const message = lectureErrorText(caught, ui.serverError);
        await updateLecture(String(id), { status: "failed", error: message });
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, retranscribe, router]);

  if (!isAudio(pack)) return null;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const counter = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });

  const reached = PHASES.indexOf(phase);
  const steps: Step[] = (Object.keys(PHASE_LABEL) as (keyof typeof PHASE_LABEL)[]).map(
    (key, index) => ({
      label: t(PHASE_LABEL[key]),
      state: index < reached ? "done" : index === reached ? "active" : "waiting",
    }),
  );
  // Named last because it is the outcome rather than a stage, and it is only
  // ever shown as still to come — the screen navigates away when it lands.
  steps.push({ label: t(ui.stepStudyView), state: "waiting" });

  return (
    <View style={s.root}>
      <LinearGradient colors={BLOOM} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.wordmarkWrap}>
          <Text style={s.wordmarkArabic}>{t(pack.appName)}</Text>
          <Text style={s.wordmarkDot}>·</Text>
          <Text style={s.wordmarkLatin}>{pack.wordmark}</Text>
        </View>

        <View style={styles.centre}>
          {error ? (
            /* The recording is already on disk by the time this screen runs,
               so the first thing the student is told is that it is safe. The
               failure is the second thing, and it comes with a way out. */
            <ErrorState
              title={t(ui.savedButAnalysisFailed)}
              body={error}
              action={t(ui.retryAnalysis)}
              onAction={() => router.replace({ pathname: "/analyzing", params: { id: String(id) } })}
              secondary={t(ui.tabTranscript)}
              onSecondary={() =>
                router.replace({ pathname: "/lecture", params: { id: String(id) } })
              }
            />
          ) : (
            <>
              <View style={styles.rings}>
                <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
                <Animated.View style={[styles.ringInner, { transform: [{ rotate: counter }] }]} />
                <View style={styles.ringCore} />
              </View>
              <Text style={styles.title}>{t(pack.voice.analysing)}</Text>
              <View style={styles.steps}>
                <LoadingState steps={steps} />
              </View>
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
    color: TEXT,
    fontSize: 34,
    fontFamily: FONTS.scriptItalic,
    lineHeight: 56,
    textAlign: "center",
  },
  /* Wide enough for the stage list to breathe, capped so five short labels
     do not stretch across a tablet. */
  steps: { alignSelf: "stretch", maxWidth: 380, width: "100%" },
});
