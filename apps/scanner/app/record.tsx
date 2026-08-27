import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  type RecordingOptions,
} from "expo-audio";
import { pack, isAudio, type Segment } from "../src/packs";
import { t, locale, isRTL } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { getProfile } from "../src/storage";
import { clock, newLectureId, persistRecording, saveLecture, scoreEnergy } from "../src/lectures";
import { startLiveWriter, recogniserLocale, liveWriterAvailable, type LiveWriter } from "../src/speech";
import { GOLD, INK, audio as s } from "../src/components/audio-theme";

/**
 * 16 kHz mono is not a compromise here — every speech recogniser downsamples
 * to exactly this before it does anything, so the 44.1 kHz stereo that
 * RecordingPresets.HIGH_QUALITY captures is thrown away on arrival. What it
 * costs is real: a 90-minute lecture is ~22 MB at these settings against
 * ~86 MB at the preset's, over a student's mobile data.
 *
 * `isMeteringEnabled` has to be set by hand — neither preset includes it, and
 * without it `metering` is silently absent rather than an error, which would
 * take the tone feature with it.
 */
const LECTURE_RECORDING: RecordingOptions = {
  isMeteringEnabled: true,
  extension: ".m4a",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: {
    outputFormat: "mpeg4",
    audioEncoder: "aac",
    // Android's automatic gain control flattens exactly the dynamic range the
    // tone feature measures. "unprocessed" is the only lever the library
    // exposes; it falls back silently on devices that don't support it.
    audioSource: "unprocessed",
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/webm", bitsPerSecond: 32000 },
};

/** Metering is dBFS: 0 is clipping, -160 is silence. Below this the lecturer
 *  is too far away for either the recogniser or a human to do much with. */
const WEAK_DBFS = -38;
/** Long enough that a pause between sentences doesn't split a thought,
 *  short enough that a timestamp still points at the right moment. */
const SEGMENT_GAP_MS = 1800;
/** A lecture is the one thing in this app that cannot be recreated, so the
 *  transcript is written to storage as it accumulates rather than only at the
 *  end — if the app is killed at minute 80, minute 79 is still there. */
const AUTOSAVE_MS = 15_000;

export default function Record() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  const recorder = useAudioRecorder(LECTURE_RECORDING);
  // One poller only. On Android `getMaxAmplitude()` resets on read, so a
  // second concurrent sampler would halve both readings' windows.
  const state = useAudioRecorderState(recorder, 250);

  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [ending, setEnding] = useState(false);

  const writer = useRef<LiveWriter | null>(null);
  const idRef = useRef(newLectureId());
  const scroller = useRef<ScrollView>(null);
  /** Peak loudness since the current utterance began. A ref because it is
   *  written five times a second and must never trigger a render. */
  const peak = useRef(-160);
  const utteranceStart = useRef(0);
  const lastFinalAt = useRef(0);
  /* durationMillis is the recorder's own clock — the same timeline the ASR
   * word timestamps are offsets into. A tick counter would drift over ninety
   * minutes and take every timestamp in the app with it. */
  const seconds = Math.floor((state.durationMillis ?? 0) / 1000);
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const segmentsRef = useRef<Segment[]>([]);
  segmentsRef.current = segments;
  const startedAtRef = useRef(Date.now());

  /* Metering runs whether or not the live writer exists — the tone analysis
   * is ours, and it is the one thing no competitor ships. */
  useEffect(() => {
    if (typeof state.metering === "number" && state.metering > peak.current) {
      peak.current = state.metering;
    }
  }, [state.metering]);

  /* Crash safety. The recording itself is a single .m4a with no index until
   * it is closed, so a kill mid-lecture loses the audio outright — but the
   * transcript is the part a student actually studies from, and it survives. */
  useEffect(() => {
    const timer = setInterval(() => {
      if (segmentsRef.current.length === 0) return;
      saveLecture({
        id: idRef.current,
        title: "",
        at: startedAtRef.current,
        duration: secondsRef.current,
        segments: segmentsRef.current,
        status: "recording",
      });
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, []);

  /* iOS pauses the recorder for an incoming call and never resumes it — only
   * players are restored. Without this a lecture silently stops recording the
   * moment someone rings, and the student finds out afterwards. */
  useEffect(() => {
    if (!ready || paused || ending) return;
    if (state.isRecording) return;
    const timer = setTimeout(() => {
      try {
        recorder.record();
      } catch {
        // Nothing to recover to; the autosaved transcript still stands.
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [ready, paused, ending, state.isRecording, recorder]);

  const weak =
    state.isRecording &&
    typeof state.metering === "number" &&
    state.metering < WEAK_DBFS;

  const pushSegment = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const at = utteranceStart.current;
    const energy = peak.current;
    // Read the previous final's time before stamping this one, or the gap
    // below is measured against this very call and is always zero.
    const sincePreviousFinal = Date.now() - lastFinalAt.current;
    peak.current = -160;
    utteranceStart.current = secondsRef.current;
    lastFinalAt.current = Date.now();
    setSegments((prev) => {
      // The recogniser re-emits a growing utterance as it revises it; two
      // finals this close where one extends the other are one thought.
      const last = prev[prev.length - 1];
      if (last && sincePreviousFinal < SEGMENT_GAP_MS && trimmed.startsWith(last.text)) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: trimmed, energy: Math.max(last.energy ?? -160, energy) },
        ];
      }
      return [...prev, { at, text: trimmed, energy }];
    });
    setInterim("");
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const permission = await requestRecordingPermissionsAsync().catch(() => null);
      if (!permission?.granted) {
        if (!cancelled) setDenied(true);
        return;
      }
      // Must come before prepare: on Android this is what turns on the
      // foreground service that keeps recording alive with the screen locked.
      // Background recording needs a dev build, so on a runtime that rejects
      // it (Expo Go) fall back rather than losing the recording entirely —
      // in the foreground it still records, which is what testing needs.
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          allowsBackgroundRecording: true,
        });
      } catch {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        }).catch(() => undefined);
      }

      try {
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      setReady(true);

      const profile = await getProfile();
      writer.current = await startLiveWriter({
        lang: recogniserLocale(profile.lectureLanguage),
        onResult: ({ text, isFinal }) => {
          if (cancelled) return;
          if (isFinal) pushSegment(text);
          else setInterim(text);
        },
      });
    })();

    return () => {
      cancelled = true;
      writer.current?.stop();
      writer.current = null;
    };
    // Mounted once: the recorder and the writer both own their own lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAudio(pack)) return null;

  const togglePause = async () => {
    Haptics.selectionAsync();
    if (paused) {
      recorder.record();
      setPaused(false);
    } else {
      recorder.pause();
      setPaused(true);
    }
  };

  /** Marks whatever is being said right now. The student presses this when
   *  the lecturer says something that matters but says it quietly. */
  const markImportant = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSegments((prev) => {
      if (prev.length === 0) return [{ at: seconds, text: "", marked: true, energy: peak.current }];
      return [...prev.slice(0, -1), { ...prev[prev.length - 1], marked: true }];
    });
  };

  const end = async () => {
    if (ending) return;
    setEnding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    writer.current?.stop();
    writer.current = null;

    const tail = interim.trim();
    const finished = tail
      ? [...segments, { at: utteranceStart.current, text: tail, energy: peak.current }]
      : segments;

    const id = idRef.current;
    let uri: string | undefined;

    try {
      await recorder.stop();
      uri = recorder.uri ? await persistRecording(recorder.uri, id) : undefined;
    } catch {
      // The recording is lost, but whatever the live writer captured is not.
      uri = undefined;
    }

    await saveLecture({
      id,
      title: "",
      at: startedAtRef.current,
      duration: seconds,
      audioUri: uri,
      // Raw dBFS goes to storage. Scoring here would write a 0–1 value into
      // the same field the scorer later reads as dBFS, and every later pass
      // would read those as clipping and zero the whole lecture.
      segments: finished.filter((seg) => seg.text.trim() || seg.marked),
      status: "processing",
    });

    router.replace({ pathname: "/analyzing", params: { id } });
  };

  const marked = scoreEnergy(segments)
    .map((seg, index) => ({ seg, index }))
    .filter(({ seg }) => seg.marked || seg.emphasis >= 0.5);

  const transcript = (
    <ScrollView
      ref={scroller}
      style={[s.panel, wide && styles.transcriptWide]}
      contentContainerStyle={styles.transcriptInner}
      onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
    >
      {segments.map((seg, index) => (
        <View key={index} style={styles.line}>
          <Text style={styles.stamp}>{clock(seg.at)}</Text>
          <Text style={[styles.lineText, seg.marked && styles.lineMarked]}>{seg.text}</Text>
        </View>
      ))}
      {interim ? <Text style={styles.interim}>{interim}</Text> : null}
      {segments.length === 0 && !interim ? (
        <Text style={styles.interim}>{t(pack.voice.listening)}</Text>
      ) : null}
    </ScrollView>
  );

  const moments = (
    <View style={[s.panel, styles.moments, wide && styles.momentsWide]}>
      <Text style={styles.momentsTitle}>{t(ui.importantMoments)}</Text>
      {marked.length === 0 ? (
        <Text style={styles.momentsEmpty}>—</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.momentsList}>
          {marked.slice(-8).reverse().map(({ seg, index }) => (
            <View key={index} style={styles.momentRow}>
              <Text style={styles.momentStamp}>{clock(seg.at)}</Text>
              <Text style={styles.momentText} numberOfLines={1}>
                {seg.text || t(ui.markedByYou)}
              </Text>
              <View style={[s.tag, seg.marked && styles.tagMarked]}>
                <Text style={s.tagText}>{seg.marked ? "★" : "◗"}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );

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

        <Text style={styles.writerHint}>
          {liveWriterAvailable() ? t(pack.voice.liveWriterReady) : t(ui.processing)}
        </Text>

        {weak ? (
          <View style={styles.warning}>
            <Text style={styles.warningText}>{t(pack.voice.micWeak)}</Text>
          </View>
        ) : (
          <View style={styles.timerWrap}>
            <View style={[styles.dot, paused && styles.dotPaused]} />
            <Text style={styles.timer}>{clock(seconds)}</Text>
          </View>
        )}

        {denied || failed ? (
          <View style={styles.centered}>
            <Text style={styles.deniedText}>
              {failed ? t(ui.serverError) : t(ui.micDenied)}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.ghost, pressed && s.pressed, styles.backButton]}
              onPress={() => router.replace("/")}
            >
              <Text style={styles.ghostText}>{t(ui.home)}</Text>
            </Pressable>
          </View>
        ) : !ready ? (
          <View style={styles.centered}>
            <ActivityIndicator color={GOLD} />
          </View>
        ) : (
          <View style={[styles.panels, wide && styles.panelsWide]}>
            {/* Wide RTL puts the first child on the right, where the web
                product keeps the transcript; stacked, the moments strip sits
                above it so it stays visible as the transcript grows. */}
            {wide && isRTL ? (
              <>
                {transcript}
                {moments}
              </>
            ) : (
              <>
                {moments}
                {transcript}
              </>
            )}
          </View>
        )}

        <View style={[styles.actions, (denied || failed) && styles.hidden]}>
          <Pressable
            style={({ pressed }) => [styles.end, pressed && s.pressed]}
            onPress={end}
            disabled={ending}
          >
            <Text style={styles.endGlyph}>◻</Text>
            <Text style={styles.endText}>{t(ui.endLecture)}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.ghost, pressed && s.pressed]}
            onPress={togglePause}
          >
            <Text style={styles.ghostGlyph}>{paused ? "▶" : "❙❙"}</Text>
            <Text style={styles.ghostText}>{paused ? t(ui.resume) : t(ui.pause)}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.ghost, pressed && s.pressed]}
            onPress={markImportant}
          >
            <Text style={styles.ghostGlyph}>☆</Text>
            <Text style={styles.ghostText}>{t(ui.markImportant)}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  writerHint: {
    color: "#9C9382",
    fontSize: 13,
    textAlign: "center",
    marginTop: 16,
    paddingHorizontal: 24,
  },
  timerWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#C8553D" },
  dotPaused: { backgroundColor: "#6E685C" },
  timer: { color: "#E8E0CE", fontSize: 19, fontWeight: "700", fontVariant: ["tabular-nums"] },
  warning: {
    backgroundColor: "#241E0C",
    borderWidth: 1,
    borderColor: "#4A3D18",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginHorizontal: 20,
    marginTop: 14,
  },
  warningText: { color: "#D9BE83", fontSize: 14, textAlign: "center" },

  panels: { flex: 1, gap: 12, paddingHorizontal: 20, marginTop: 16 },
  panelsWide: { flexDirection: "row" },
  transcriptWide: { flex: 2 },
  transcriptInner: { padding: 18, gap: 14 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stamp: {
    color: "#6E685C",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    marginTop: 4,
    minWidth: 42,
  },
  lineText: { color: "#E8E0CE", fontSize: 16, lineHeight: 30, flex: 1, textAlign: "right" },
  lineMarked: { color: GOLD },
  interim: { color: "#6E685C", fontSize: 15, fontStyle: "italic", textAlign: "right" },

  moments: { maxHeight: 190, padding: 16, gap: 10 },
  momentsWide: { flex: 1, maxHeight: undefined },
  momentsTitle: { color: "#E8E0CE", fontSize: 15, fontWeight: "700", textAlign: "right" },
  momentsEmpty: { color: "#6E685C", fontSize: 14, textAlign: "center", paddingVertical: 12 },
  momentsList: { gap: 10 },
  momentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  momentStamp: { color: "#6E685C", fontSize: 12, fontVariant: ["tabular-nums"] },
  momentText: { color: "#C9BC9A", fontSize: 14, flex: 1, textAlign: "right" },
  tagMarked: { backgroundColor: "#3A2E12" },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 22 },
  backButton: { alignSelf: "center" },
  deniedText: { color: "#9C9382", fontSize: 16, lineHeight: 30, textAlign: "center" },

  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  hidden: { display: "none" },
  end: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingVertical: 17,
    paddingHorizontal: 24,
  },
  endGlyph: { color: INK, fontSize: 13 },
  endText: { color: INK, fontSize: 15, fontWeight: "700" },
  ghost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 17,
    paddingHorizontal: 20,
  },
  ghostGlyph: { color: "#C9BC9A", fontSize: 12 },
  ghostText: { color: "#E8E0CE", fontSize: 15, fontWeight: "600" },
});
