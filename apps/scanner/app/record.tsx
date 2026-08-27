import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Alert,
} from "react-native";
import { useNavigation, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
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
import { pack, isAudio, type AudioChunk, type Segment } from "../src/packs";
import { t, locale, isRTL } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { getProfile } from "../src/storage";
import {
  audioDuration,
  bumpLectureCount,
  clock,
  newLectureId,
  persistChunk,
  saveLecture,
  scoreEnergy,
} from "../src/lectures";
import { startLiveWriter, recogniserLocale, liveWriterAvailable, type LiveWriter } from "../src/speech";
import { FONTS } from "../src/type";
import { BLOOM, GOLD, INK, audio as s, READ } from "../src/components/audio-theme";

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
/**
 * How long each slice of the recording runs before the recorder is rotated.
 *
 * Five minutes is the trade. Rotating costs the fraction of a second it takes
 * to close one file and open the next — about eighteen such gaps across a
 * ninety-minute lecture — and buys the guarantee that a crash or a force-quit
 * costs at most the last five minutes instead of the entire recording, which
 * is what an unclosed .m4a is worth. The live transcript is unaffected: the
 * speech recogniser is a separate session and does not rotate with the file.
 */
const CHUNK_MS = 5 * 60 * 1000;

export default function Record() {
  const router = useRouter();
  const navigation = useNavigation();
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
  /** The live writer stopped and could not be brought back. The header must
   *  stop claiming it is running, and the lecture is marked so the accurate
   *  pass runs instead of trusting a transcript that stops mid-lecture. */
  const [writerDown, setWriterDown] = useState(false);

  const writer = useRef<LiveWriter | null>(null);
  /** Guards the restart loop: set while ending, so a stop we asked for is not
   *  mistaken for the recogniser dying and immediately restarted. */
  const finishing = useRef(false);
  const restarting = useRef(false);
  const autosave = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunks = useRef<AudioChunk[]>([]);
  const rotating = useRef(false);
  const elapsedRef = useRef(0);
  const restartAttempts = useRef(0);
  const idRef = useRef(newLectureId());
  const scroller = useRef<ScrollView>(null);
  /** Peak loudness since the current utterance began. A ref because it is
   *  written five times a second and must never trigger a render. */
  const peak = useRef(-160);
  const utteranceStart = useRef(0);
  const lastFinalAt = useRef(0);
  /** True between the first word of an utterance and its final result. It is
   *  what lets the utterance be stamped when it begins: without it the only
   *  moment available is when the *previous* one ended, which hands every
   *  pause to the segment that follows it. A lecturer who writes on the board
   *  for two minutes would stamp the next sentence two minutes early, and
   *  tapping it would seek the recording to the wrong place. */
  const speaking = useRef(false);
  /* durationMillis is the recorder's own clock — the timeline the audio is
   * written on, and the one the ASR word timestamps are offsets into. A tick
   * counter would drift over ninety minutes and take every timestamp with it.
   *
   * It restarts from zero on every rotation, so the lecture's own clock is
   * that plus the chunks already closed. */
  const [elapsedBefore, setElapsedBefore] = useState(0);
  const seconds = elapsedBefore + Math.floor((state.durationMillis ?? 0) / 1000);
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const segmentsRef = useRef<Segment[]>([]);
  segmentsRef.current = segments;
  elapsedRef.current = seconds;
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
      // end() has already written the finished lecture; a late autosave would
      // put it back to "recording" and strand it there, showing a live pill
      // on the home list for a lecture that finished.
      if (finishing.current) return;
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
    autosave.current = timer;
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

  /** Called on the first sign of speech. Anchors the utterance to now and
   *  starts the loudness window here, so the peak measures the talking rather
   *  than the silence in front of it. */
  const openUtterance = useCallback(() => {
    if (speaking.current) return;
    speaking.current = true;
    utteranceStart.current = secondsRef.current;
    peak.current = -160;
  }, []);

  const pushSegment = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const at = utteranceStart.current;
    const energy = peak.current;
    // Read the previous final's time before stamping this one, or the gap
    // below is measured against this very call and is always zero.
    const sincePreviousFinal = Date.now() - lastFinalAt.current;
    speaking.current = false;
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

  /**
   * Closes the current slice and opens the next.
   *
   * Everything but the last chunk is therefore a complete, playable file the
   * moment it is written. `paused` is deliberately not rotated through — a
   * paused recorder has nothing to close, and stopping it would restart the
   * clock underneath a student who is only pausing for a question.
   */
  const rotate = useCallback(async (): Promise<AudioChunk | null> => {
    if (rotating.current || finishing.current) return null;
    rotating.current = true;

    // Read the clock before stopping: stop() resets durationMillis, and this
    // is what tells the next chunk where it begins on the lecture's timeline.
    const closedAt = elapsedRef.current;
    const startedAt = audioDuration(chunks.current);

    let chunk: AudioChunk | null = null;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        const stored = await persistChunk(uri, idRef.current, chunks.current.length);
        if (stored) {
          chunk = { uri: stored, at: startedAt, duration: Math.max(0, closedAt - startedAt) };
          chunks.current = [...chunks.current, chunk];
        }
      }
    } catch {
      // The slice is lost; the ones already closed are not, which is the
      // entire reason for rotating.
    }

    if (!finishing.current) {
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
        // The recorder's clock is back at zero, so the lecture's clock takes
        // over from where the closed chunks end.
        setElapsedBefore(closedAt);
      } catch {
        setFailed(true);
      }
    }

    rotating.current = false;
    return chunk;
  }, [recorder]);

  useEffect(() => {
    if (!ready || paused || ending || denied || failed) return;
    const timer = setInterval(() => void rotate(), CHUNK_MS);
    return () => clearInterval(timer);
  }, [ready, paused, ending, denied, failed, rotate]);

  /**
   * Nothing leaves this screen without going through end().
   *
   * `gestureEnabled: false` only suppresses the iOS swipe. Android's back
   * button still pops the stack, and unmounting tears down the recorder
   * without stopping it — the .m4a is left unindexed in cache and the only
   * trace of the lecture is a 15-second autosave stuck at "recording", which
   * the home list then shows as live forever. The free lecture is spent.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event: any) => {
      if (finishing.current || denied || failed || !ready) return;
      event.preventDefault();
      Alert.alert(t(ui.endLecture), t(ui.endLectureConfirm), [
        { text: t(ui.resume), style: "cancel" },
        { text: t(ui.endLecture), style: "destructive", onPress: () => void end() },
      ]);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, denied, failed, ready, ending, segments, interim, seconds]);

  /**
   * Brings the live writer back after the recognition session ends.
   *
   * It ends far more often than it looks: `continuous` is unsupported on
   * Android 12 and below, where the session closes after the first final
   * result, and on any device an incoming call ends the task outright. The
   * recorder survives both — so without this the audio keeps going while the
   * transcript stops, and the truncated text is long enough to look fine.
   */
  const restartWriter = useCallback(async () => {
    if (finishing.current || restarting.current) return;
    restarting.current = true;

    // Back off, but keep trying for the length of a lecture rather than
    // giving up after a burst: a phone call is a perfectly ordinary reason
    // for the session to end, and the lecture continues afterwards.
    const attempt = restartAttempts.current;
    restartAttempts.current = attempt + 1;
    const wait = Math.min(8000, 400 * 2 ** Math.min(attempt, 4));
    await new Promise((resolve) => setTimeout(resolve, wait));

    if (finishing.current) {
      restarting.current = false;
      return;
    }

    try {
      writer.current?.stop();
    } catch {
      // It is already gone; that is why we are here.
    }
    writer.current = null;

    const profile = await getProfile();
    const next = await startLiveWriter({
      lang: recogniserLocale(profile.lectureLanguage),
      onResult: ({ text, isFinal }) => {
        if (finishing.current) return;
        openUtterance();
        if (isFinal) pushSegment(text);
        else setInterim(text);
      },
      onEnd: restartWriter,
      onError: restartWriter,
    });

    writer.current = next;
    setWriterDown(next === null);
    if (next) restartAttempts.current = 0;
    restarting.current = false;
    // pushSegment and openUtterance are stable; recursion is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUtterance, pushSegment]);

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
          openUtterance();
          if (isFinal) pushSegment(text);
          else setInterim(text);
        },
        onEnd: restartWriter,
        onError: restartWriter,
      });
      if (!writer.current) setWriterDown(true);
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
    // Set before anything is torn down: it stops the autosave from reverting
    // the finished lecture, and stops the writer's own stop() being mistaken
    // for the recogniser dying and restarted.
    finishing.current = true;
    if (autosave.current) clearInterval(autosave.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    writer.current?.stop();
    writer.current = null;

    const tail = interim.trim();
    const finished = tail
      ? [...segments, { at: utteranceStart.current, text: tail, energy: peak.current }]
      : segments;

    const id = idRef.current;
    // Close the slice still open. Everything before it is already on disk as
    // a finished file, which is what makes a crash survivable.
    const closedAt = seconds;
    const startedAt = audioDuration(chunks.current);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        const stored = await persistChunk(uri, id, chunks.current.length);
        if (stored) {
          chunks.current = [
            ...chunks.current,
            { uri: stored, at: startedAt, duration: Math.max(0, closedAt - startedAt) },
          ];
        }
      }
    } catch {
      // The last slice is lost; the earlier ones are not.
    }

    // Hand the microphone back. Nothing else in the app resets this, and the
    // recording category routes playback to the earpiece on the path where
    // the speech recogniser never ran to override it.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
      () => undefined,
    );

    const segmentsToSave = finished.filter((seg) => seg.text.trim() || seg.marked);

    await saveLecture({
      id,
      title: "",
      at: startedAtRef.current,
      duration: seconds,
      audioChunks: chunks.current,
      // Raw dBFS goes to storage. Scoring here would write a 0–1 value into
      // the same field the scorer later reads as dBFS, and every later pass
      // would read those as clipping and zero the whole lecture.
      segments: segmentsToSave,
      // A writer that died mid-lecture leaves text that is long enough to
      // look complete. Saying so here is what makes the accurate pass run
      // instead of summarising the first minute as though it were the hour.
      liveWriterFailed: writerDown || !liveWriterAvailable(),
      status: "processing",
    });

    // Spent here rather than on the button: this is the first moment a
    // lecture actually exists, so a denied microphone or a student who backed
    // out never costs them their free one.
    await bumpLectureCount();

    router.replace({ pathname: "/analyzing", params: { id } });
  };

  /* Memoised because the metering poll re-renders this screen four times a
   * second, and the scorer walks a rolling window over every segment — an
   * hour in, that is quadratic work on every tick for a list that only
   * changes when someone speaks. */
  const marked = useMemo(
    () =>
      scoreEnergy(segments)
        .map((seg, index) => ({ seg, index }))
        .filter(({ seg }) => seg.marked || seg.emphasis >= 0.5),
    [segments],
  );

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
      <LinearGradient colors={BLOOM} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.wordmarkWrap}>
          <View style={s.langPill}>
            <Text style={s.langText}>{locale === "ar" ? "EN" : "ع"}</Text>
          </View>
          <Text style={s.wordmarkLatin}>{pack.wordmark}</Text>
          <Text style={s.wordmarkDot}>•</Text>
          <Text style={s.wordmarkArabic}>{t(pack.appName)}</Text>
        </View>

        <Text style={[styles.writerHint, writerDown && styles.writerHintDown]}>
          {!liveWriterAvailable() || writerDown
            ? t(ui.liveWriterOff)
            : t(pack.voice.liveWriterReady)}
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
  writerHintDown: { color: "#C9AE73" },
  writerHint: {
    color: "#9C9382",
    fontSize: 13, fontFamily: FONTS.body,
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
  timer: { color: "#E8E0CE", fontSize: 19, fontFamily: FONTS.displayBold, fontVariant: ["tabular-nums"] },
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
  warningText: { color: "#D9BE83", fontSize: 14, fontFamily: FONTS.body, textAlign: "center" },

  panels: { flex: 1, gap: 12, paddingHorizontal: 20, marginTop: 16 },
  panelsWide: { flexDirection: "row" },
  transcriptWide: { flex: 2 },
  transcriptInner: { padding: 18, gap: 14 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stamp: {
    color: "#6E685C",
    fontSize: 12, fontFamily: FONTS.body,
    fontVariant: ["tabular-nums"],
    marginTop: 4,
    minWidth: 42,
  },
  lineText: { color: "#E8E0CE", fontSize: 16, fontFamily: FONTS.body, lineHeight: 30, flex: 1, textAlign: READ },
  lineMarked: { color: GOLD },
  interim: { color: "#6E685C", fontSize: 15, fontFamily: FONTS.body, fontStyle: "italic", textAlign: READ },

  moments: { maxHeight: 190, padding: 16, gap: 10 },
  momentsWide: { flex: 1, maxHeight: undefined },
  momentsTitle: { color: "#E8E0CE", fontSize: 15, fontFamily: FONTS.displayBold, textAlign: READ },
  momentsEmpty: { color: "#6E685C", fontSize: 14, fontFamily: FONTS.body, textAlign: "center", paddingVertical: 12 },
  momentsList: { gap: 10 },
  momentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  momentStamp: { color: "#6E685C", fontSize: 12, fontFamily: FONTS.body, fontVariant: ["tabular-nums"] },
  momentText: { color: "#C9BC9A", fontSize: 14, fontFamily: FONTS.body, flex: 1, textAlign: READ },
  tagMarked: { backgroundColor: "#3A2E12" },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 22 },
  backButton: { alignSelf: "center" },
  deniedText: { color: "#9C9382", fontSize: 16, fontFamily: FONTS.body, lineHeight: 30, textAlign: "center" },

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
  endText: { color: INK, fontSize: 15, fontFamily: FONTS.displayBold },
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
  ghostText: { color: "#E8E0CE", fontSize: 15, fontFamily: FONTS.bodyMedium },
});
