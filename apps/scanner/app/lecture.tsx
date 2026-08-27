import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { pack, isAudio, type Lecture, type Text as I18nText } from "../src/packs";
import { t, locale, fill } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import {
  audioDuration,
  clock,
  decideTask,
  deleteLecture,
  deleteRecording,
  getLecture,
  locate,
  savePlayhead,
  scoreEnergy,
  updateLecture,
  waveformOf,
} from "../src/lectures";
import { conceptsOf, type ConceptDetail } from "../src/concepts";
import {
  cancelTaskReminders,
  remindersScheduled,
  scheduleTaskReminders,
  shareFile,
  toIcs,
  toMarkdown,
} from "../src/lecture-export";
import { FONTS, SCALE } from "../src/type";
import { useLayout } from "../src/layout";
import {
  GOLD,
  INK,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  HAIRLINE,
  STATE,
  SP,
  RADIUS,
  READ,
  READ_END,
  BACK_GLYPH,
  glow,
  audio as s,
} from "../src/components/audio-theme";
import { Shell, useContentPad } from "../src/components/Shell";
import {
  Card,
  Button,
  IconButton,
  Chip,
  ProgressBar,
  Waveform,
  SectionTitle,
  SearchField,
  Tabs,
  EmptyState,
  ErrorState,
  LoadingState,
  Meta,
} from "../src/components/kit";
import { normalise } from "../src/countries";

/**
 * The lecture.
 *
 * This is the screen the product is for, and its job is narrow: let a student
 * find what was said, and then hear it. Everything is arranged around that
 * single move — a claim, the second it was made, and a way to play it.
 *
 * Five tabs, not seven. The two that went were "map" and "tone", which were
 * names for the shape of the data rather than for anything a student wanted;
 * both now live inside Overview, where they read as parts of the lecture
 * instead of as separate features.
 */

type TabKey = "overview" | "concepts" | "tasks" | "exam" | "transcript";

const TABS: { key: TabKey; label: I18nText }[] = [
  { key: "overview", label: ui.tabOverview },
  { key: "concepts", label: ui.tabTerms },
  { key: "tasks", label: ui.tabTasks },
  { key: "exam", label: ui.tabExam },
  { key: "transcript", label: ui.tabTranscript },
];

const TAB_KEYS = TABS.map((tab) => tab.key);

/** How many moments Overview shows before "see all". */
const MOMENTS_PREVIEW = 3;

export default function LectureScreen() {
  const router = useRouter();
  const layout = useLayout();
  const pad = useContentPad();
  const { id, at, tab: requestedTab } = useLocalSearchParams<{
    id: string;
    at?: string;
    tab?: string;
  }>();

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [tab, setTab] = useState<TabKey>(
    TAB_KEYS.includes(requestedTab as TabKey) ? (requestedTab as TabKey) : "overview",
  );
  const [copied, setCopied] = useState(false);
  const [remindersOn, setRemindersOn] = useState(false);
  const [find, setFind] = useState("");
  const [allMoments, setAllMoments] = useState(false);
  const [openConcept, setOpenConcept] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<number | null>(null);

  /** A deep link carries the moment it came from; honoured once, so scrolling
   *  away and coming back does not drag the student to it again. */
  const jumped = useRef(false);
  /** Offset to seek to once a newly loaded slice reports itself ready. */
  const pendingSeek = useRef<number | null>(null);
  const [autoplay, setAutoplay] = useState(false);

  const load = useCallback(async () => {
    const found = await getLecture(String(id));
    setLecture(found ?? null);
    if (found) {
      // Reflect what is actually scheduled with the OS, rather than
      // defaulting to "off" and offering to schedule duplicates.
      setRemindersOn(await remindersScheduled(found));
      // Opening it is what makes it read. Written once, so the home screen
      // stops offering it for review.
      if (!found.openedAt) await updateLecture(found.id, { openedAt: Date.now() });
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().catch(() => {
        if (active) setLecture(null);
      });
      return () => {
        active = false;
      };
    }, [load]),
  );

  /* The recording is a list of closed files rather than one long one, so the
   * player holds whichever slice is currently sounding and the screen presents
   * them as a single timeline. Created unconditionally so the hook order never
   * changes; a null source simply gives an idle player. */
  const chunks = lecture?.audioChunks ?? [];
  const [chunkIndex, setChunkIndex] = useState(0);
  const current = chunks[chunkIndex];
  const player = useAudioPlayer(current ? { uri: current.uri } : null);
  const status = useAudioPlayerStatus(player);
  const hasAudio = chunks.length > 0;
  const recordedSeconds = useMemo(() => audioDuration(chunks), [chunks]);
  /** Position on the lecture's timeline, not the current file's. */
  const playedSeconds = (current?.at ?? 0) + (status.currentTime ?? 0);
  const totalSeconds = recordedSeconds || lecture?.duration || 0;

  /* Roll into the next slice when one runs out, so a lecture recorded in
   * eighteen files still plays as one continuous recording. */
  useEffect(() => {
    if (!status.didJustFinish) return;
    if (chunkIndex >= chunks.length - 1) return;
    setChunkIndex(chunkIndex + 1);
    setAutoplay(true);
  }, [status.didJustFinish, chunkIndex, chunks.length]);

  /* A slice loaded because playback moved into it, or because a timestamp was
   * tapped, has to start itself once it is ready. */
  useEffect(() => {
    if (!autoplay || !status.isLoaded) return;
    setAutoplay(false);
    if (pendingSeek.current !== null) {
      player.seekTo(pendingSeek.current);
      pendingSeek.current = null;
    }
    player.play();
  }, [autoplay, status.isLoaded, player]);

  /* Where the student stopped. Held in a ref rather than written per tick —
   * a storage write every second for a number nobody reads until the next
   * visit — and flushed when they pause or leave. Without this there is no
   * resume and the home screen's progress bar would be a guess. */
  const position = useRef(0);
  position.current = playedSeconds;
  const lectureId = lecture?.id;

  useEffect(() => {
    if (!lectureId) return;
    if (!status.playing && position.current > 0) void savePlayhead(lectureId, position.current);
  }, [status.playing, lectureId]);

  useEffect(
    () => () => {
      if (lectureId) void savePlayhead(lectureId, position.current);
    },
    [lectureId],
  );

  const analysis = lecture?.analysis;

  /** Scored once per render rather than per row: the rolling baseline is a
   *  windowed pass over every segment, so calling it inside map() would make
   *  rendering an hour-long transcript quadratic. */
  const scored = useMemo(() => scoreEnergy(lecture?.segments ?? []), [lecture?.segments]);
  const bars = useMemo(() => waveformOf(lecture?.segments ?? [], 72), [lecture?.segments]);
  const concepts = useMemo(() => (lecture ? conceptsOf(lecture) : []), [lecture]);

  /**
   * The moments worth surfacing, best first.
   *
   * The model's own list is preferred because it comes with a reason; the
   * loudest passages fill in behind it when it is short. Both carry a real
   * second on the timeline, so every one of them is playable.
   */
  const moments = useMemo(() => {
    const stated = (analysis?.emphasised ?? []).map((m) => ({
      at: m.atSeconds,
      text: m.text,
      reason: m.reason,
    }));
    const seen = new Set(stated.map((m) => Math.round(m.at)));
    const loud = scored
      .filter((seg) => seg.emphasis >= 0.55 && !seen.has(Math.round(seg.at)))
      .sort((a, b) => b.emphasis - a.emphasis)
      .slice(0, 6)
      .map((seg) => ({ at: seg.at, text: seg.text.trim(), reason: undefined as string | undefined }));
    return [...stated, ...loud].sort((a, b) => a.at - b.at);
  }, [analysis?.emphasised, scored]);

  /** Filtered transcript. Empty search shows everything, so the default is
   *  the whole lecture rather than a hidden one. */
  const visibleSegments = useMemo(() => {
    const q = normalise(find.trim());
    if (!q) return scored;
    return scored.filter((segment) => normalise(segment.text).includes(q));
  }, [scored, find]);

  /** Which line is sounding right now. Compared against the *next* segment's
   *  start so the highlight holds through a pause instead of flickering off. */
  const activeAt = useMemo(() => {
    if (!status.playing && playedSeconds === 0) return null;
    let found: number | null = null;
    for (const segment of scored) {
      if (segment.at <= playedSeconds + 0.35) found = segment.at;
      else break;
    }
    return found;
  }, [scored, playedSeconds, status.playing]);

  const done = useMemo(() => new Set(lecture?.done ?? []), [lecture?.done]);
  const accepted = lecture?.accepted;
  const dismissed = useMemo(() => new Set(lecture?.dismissed ?? []), [lecture?.dismissed]);

  /** Tasks split into what has been agreed and what is still being offered. */
  const { confirmed, candidates } = useMemo(() => {
    const list = analysis?.tasks ?? [];
    const yes: number[] = [];
    const maybe: number[] = [];
    list.forEach((_, index) => {
      if (dismissed.has(index)) return;
      if (accepted === undefined || accepted.includes(index)) yes.push(index);
      else maybe.push(index);
    });
    return { confirmed: yes, candidates: maybe };
  }, [analysis?.tasks, accepted, dismissed]);

  /** Seeks the lecture's timeline, crossing into another slice if needed. */
  const seek = useCallback(
    (seconds: number) => {
      const target = locate(chunks, seconds);
      if (!target) return;
      if (target.index === chunkIndex) {
        player.seekTo(target.offset);
        player.play();
        return;
      }
      // A different file has to load first; the seek is applied when it
      // reports ready, otherwise it lands on the outgoing slice and is lost.
      pendingSeek.current = target.offset;
      setChunkIndex(target.index);
      setAutoplay(true);
    },
    [chunks, chunkIndex, player],
  );

  /* Landing from a task, an insight or an exam signal: go to the moment it
   * came from as soon as there is audio to go to. This is the link the whole
   * provenance idea rests on — a claim you can hear. */
  useEffect(() => {
    if (jumped.current || !lecture || chunks.length === 0) return;
    const target = Number(at);
    if (!Number.isFinite(target) || target <= 0) return;
    jumped.current = true;
    seek(target);
  }, [lecture, chunks.length, at, seek]);

  const toggleTask = async (index: number) => {
    if (!lecture) return;
    Haptics.selectionAsync();
    const next = new Set(done);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    const list = [...next];
    setLecture({ ...lecture, done: list });
    await updateLecture(lecture.id, { done: list });
  };

  const decide = async (index: number, keep: boolean) => {
    if (!lecture) return;
    setBusyTask(index);
    await decideTask(lecture.id, index, keep);
    await load();
    setBusyTask(null);
  };

  const copyAll = async () => {
    if (!lecture) return;
    await Clipboard.setStringAsync(toMarkdown(lecture));
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 1600);
  };

  const downloadMd = async () => {
    if (!lecture) return;
    const name = `${(lecture.title || "lecture").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.md`;
    await shareFile(name, toMarkdown(lecture), "text/markdown");
  };

  const downloadIcs = async () => {
    if (!lecture) return;
    const ics = toIcs(lecture);
    if (!ics) {
      Alert.alert(t(ui.noTasks));
      return;
    }
    await shareFile(`${lecture.id}.ics`, ics, "text/calendar");
  };

  const toggleReminders = async () => {
    if (!lecture) return;
    if (remindersOn) {
      await cancelTaskReminders(lecture);
      setRemindersOn(false);
      return;
    }
    const count = await scheduleTaskReminders(lecture);
    if (count === 0) {
      Alert.alert(t(ui.noTasks));
      return;
    }
    setRemindersOn(true);
  };

  const reanalyse = async (retranscribe?: boolean) => {
    if (!lecture) return;
    // The scheduled reminders point at tasks in the list that is about to be
    // replaced. Left alone they would fire for work the new analysis no
    // longer contains.
    await cancelTaskReminders(lecture);
    setRemindersOn(false);
    router.push({
      pathname: "/analyzing",
      params: retranscribe ? { id: lecture.id, retranscribe: "1" } : { id: lecture.id },
    });
  };

  const confirmDelete = () => {
    if (!lecture) return;
    Alert.alert(t(ui.deleteLecture), t(ui.deleteLectureConfirm), [
      { text: t(ui.home), style: "cancel" },
      {
        text: t(ui.deleteLecture),
        style: "destructive",
        onPress: async () => {
          await cancelTaskReminders(lecture);
          await deleteRecording(lecture.audioChunks);
          await deleteLecture(lecture.id);
          router.replace("/");
        },
      },
    ]);
  };

  /**
   * What a student can do with one line of the transcript.
   *
   * Tapping plays it, which is the common case and stays a single tap. The
   * long press is for the rarer, more interesting move: take this sentence to
   * Ask Mahdar and have it explained against the rest of the semester.
   */
  const lineActions = (atSeconds: number, text: string) => {
    Haptics.selectionAsync();
    Alert.alert(clock(atSeconds), text, [
      { text: t(ui.playFromMoment), onPress: () => seek(atSeconds) },
      {
        text: t(ui.askAboutThis),
        onPress: () =>
          router.push({
            pathname: "/study",
            params: { q: fill(ui.askAboutLine, { text: text.trim().slice(0, 240) }) },
          }),
      },
      { text: t(ui.home), style: "cancel" as const },
    ]);
  };

  const moreActions = () => {
    if (!lecture) return;
    Alert.alert(lecture.title || t(ui.untitledLecture), undefined, [
      { text: copied ? t(ui.copied) : t(ui.copyAll), onPress: () => void copyAll() },
      { text: t(ui.downloadMd), onPress: () => void downloadMd() },
      ...(hasAudio
        ? [{ text: t(ui.retranscribe), onPress: () => void reanalyse(true) }]
        : []),
      { text: t(ui.reanalyse), onPress: () => void reanalyse() },
      { text: t(ui.deleteLecture), style: "destructive" as const, onPress: confirmDelete },
      { text: t(ui.home), style: "cancel" as const },
    ]);
  };

  if (!isAudio(pack)) return null;

  if (!lecture) {
    return (
      <Shell bare>
        <View style={styles.loading}>
          <ActivityIndicator color={GOLD} />
        </View>
      </Shell>
    );
  }

  const subtitle = [
    analysis?.lecturer,
    new Date(lecture.at).toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    clock(lecture.duration),
  ]
    .filter(Boolean)
    .join("  ·  ");

  const openTab = (next: TabKey, concept?: string) => {
    setTab(next);
    if (concept !== undefined) setOpenConcept(concept);
  };

  return (
    <Shell>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: layout.gutter, paddingBottom: pad },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={hasAudio ? [1] : undefined}
      >
        {/* Header: who said it, when, and the way back. */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <IconButton
              glyph={BACK_GLYPH}
              label={t(ui.home)}
              tone="bare"
              size={34}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            />
            <View style={styles.headerBody}>
              <Text style={styles.title} numberOfLines={3}>
                {lecture.title || t(ui.untitledLecture)}
              </Text>
              <Meta>{subtitle}</Meta>
            </View>
            <IconButton glyph="⋯" label={t(ui.settings)} size={34} onPress={moreActions} />
          </View>
        </View>

        {/* The player stays put while the tabs scroll under it — a timestamp
            you tap three screens down should not scroll you away from the
            controls that are about to start playing. */}
        {hasAudio ? (
          <Player
            playing={status.playing}
            played={playedSeconds}
            total={totalSeconds}
            bars={bars}
            onToggle={() => (status.playing ? player.pause() : player.play())}
            onSeekFraction={(f) => seek(f * totalSeconds)}
            onNudge={(delta) => seek(Math.max(0, Math.min(totalSeconds, playedSeconds + delta)))}
          />
        ) : null}

        <Tabs
          items={TABS.map((entry) => ({ key: entry.key, label: t(entry.label) }))}
          value={tab}
          onChange={(next) => openTab(next)}
        />

        {lecture.status === "processing" ? (
          <LoadingState
            title={t(ui.processing)}
            steps={[
              { label: t(ui.stepSaved), state: "done" },
              { label: t(ui.stepTranscribing), state: "done" },
              { label: t(ui.stepMoments), state: "active" },
              { label: t(ui.stepTasks), state: "waiting" },
              { label: t(ui.stepStudyView), state: "waiting" },
            ]}
          />
        ) : null}

        {lecture.status === "failed" ? (
          <ErrorState
            title={t(ui.failed)}
            body={lecture.error || t(ui.savedButAnalysisFailed)}
            action={t(ui.retryAnalysis)}
            onAction={() => void reanalyse()}
            secondary={hasAudio ? t(ui.retranscribe) : undefined}
            onSecondary={hasAudio ? () => void reanalyse(true) : undefined}
          />
        ) : null}

        {tab === "overview" ? (
          <Overview
            lecture={lecture}
            concepts={concepts}
            moments={moments}
            showAllMoments={allMoments}
            onToggleMoments={() => setAllMoments((x) => !x)}
            tasks={confirmed}
            done={done}
            onSeek={seek}
            onOpenTab={openTab}
            onToggleTask={(index) => void toggleTask(index)}
          />
        ) : null}

        {tab === "concepts" ? (
          <Concepts
            concepts={concepts}
            open={openConcept}
            onOpen={setOpenConcept}
            onSeek={seek}
          />
        ) : null}

        {tab === "tasks" ? (
          <TasksTab
            lecture={lecture}
            confirmed={confirmed}
            candidates={candidates}
            done={done}
            busy={busyTask}
            remindersOn={remindersOn}
            onToggle={(index) => void toggleTask(index)}
            onDecide={(index, keep) => void decide(index, keep)}
            onSeek={seek}
            onIcs={() => void downloadIcs()}
            onReminders={() => void toggleReminders()}
          />
        ) : null}

        {tab === "exam" ? <ExamTab lecture={lecture} onSeek={seek} /> : null}

        {tab === "transcript" ? (
          <View style={styles.stack}>
            <SearchField
              value={find}
              onChange={setFind}
              placeholder={t(ui.searchGuide)}
            />
            <Meta>{t(ui.transcriptHint)}</Meta>
            {visibleSegments.length === 0 ? (
              <EmptyState glyph="⌕" title={t(ui.noMatch)} />
            ) : (
              <Card style={styles.transcript}>
                {visibleSegments.map((segment) => (
                  <Pressable
                    key={segment.at}
                    style={[styles.line, segment.at === activeAt && styles.lineActive]}
                    onPress={() => seek(segment.at)}
                    onLongPress={() => lineActions(segment.at, segment.text)}
                    accessibilityRole="button"
                    accessibilityLabel={`${clock(segment.at)} ${segment.text}`}
                  >
                    <Text
                      style={[styles.lineStamp, segment.at === activeAt && styles.lineStampActive]}
                    >
                      {clock(segment.at)}
                    </Text>
                    <Text
                      style={[
                        styles.lineText,
                        segment.emphasis >= 0.5 && styles.lineLoud,
                        segment.marked && styles.lineMarked,
                        segment.at === activeAt && styles.lineTextActive,
                      ]}
                    >
                      {segment.text}
                    </Text>
                    {segment.marked ? <Text style={styles.lineStar}>★</Text> : null}
                  </Pressable>
                ))}
              </Card>
            )}
          </View>
        ) : null}

        <Text style={s.footer}>{t(pack.disclaimer)}</Text>
      </ScrollView>
    </Shell>
  );
}

/* -------------------------------------------------------------- the player */

/**
 * The recording, always within reach.
 *
 * Everything else on this screen is a pointer into this bar. The waveform is
 * the lecture's own loudness, so scrubbing it is scrubbing something the
 * student can see the shape of rather than a featureless line.
 */
function Player({
  playing,
  played,
  total,
  bars,
  onToggle,
  onSeekFraction,
  onNudge,
}: {
  playing: boolean;
  played: number;
  total: number;
  bars: number[];
  onToggle: () => void;
  onSeekFraction: (fraction: number) => void;
  onNudge: (delta: number) => void;
}) {
  const fraction = total > 0 ? Math.min(1, played / total) : 0;

  return (
    <View style={styles.playerWrap}>
      <Card style={styles.player}>
        <View style={styles.playerRow}>
          <Pressable
            onPress={onToggle}
            style={({ pressed }) => [styles.play, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel={playing ? t(ui.pause) : t(ui.playFromMoment)}
          >
            <Text style={styles.playGlyph}>{playing ? "❙❙" : "▶"}</Text>
          </Pressable>

          <View style={styles.playerBody}>
            {bars.length > 0 ? (
              <Waveform bars={bars} progress={fraction} height={26} onSeek={onSeekFraction} />
            ) : (
              <ProgressBar value={fraction} height={4} />
            )}
            <View style={styles.playerTimes}>
              <Text style={styles.playerTime}>{clock(played)}</Text>
              <Text style={styles.playerTime}>{clock(total)}</Text>
            </View>
          </View>

          <View style={styles.nudges}>
            <IconButton glyph="↺" label="-15" size={30} tone="bare" onPress={() => onNudge(-15)} />
            <IconButton glyph="↻" label="+15" size={30} tone="bare" onPress={() => onNudge(15)} />
          </View>
        </View>
      </Card>
    </View>
  );
}

/* ------------------------------------------------------------------ tabs */

type Moment = { at: number; text: string; reason?: string };

/**
 * What the lecture was, in the order a student wants it.
 *
 * Summary, then the words that carried the hour, then the moments worth
 * hearing again, then the work. The concept chips are a way *into* the
 * concepts tab rather than a duplicate of it — the tap changes tab and opens
 * the one that was pressed.
 */
function Overview({
  lecture,
  concepts,
  moments,
  showAllMoments,
  onToggleMoments,
  tasks,
  done,
  onSeek,
  onOpenTab,
  onToggleTask,
}: {
  lecture: Lecture;
  concepts: ConceptDetail[];
  moments: Moment[];
  showAllMoments: boolean;
  onToggleMoments: () => void;
  tasks: number[];
  done: Set<number>;
  onSeek: (seconds: number) => void;
  onOpenTab: (tab: TabKey, concept?: string) => void;
  onToggleTask: (index: number) => void;
}) {
  const analysis = lecture.analysis;
  const shown = showAllMoments ? moments : moments.slice(0, MOMENTS_PREVIEW);
  const chapters = analysis?.chapters ?? [];

  if (!analysis) {
    return <EmptyState glyph="◫" title={t(ui.stillProcessing)} />;
  }

  return (
    <View style={styles.stack}>
      {analysis.summary ? (
        <Card style={styles.section}>
          <SectionTitle>{t(ui.aboutThisLecture)}</SectionTitle>
          <Text style={styles.paragraph}>{analysis.summary}</Text>
          {analysis.keyPoints.length > 0 ? (
            <View style={styles.points}>
              {analysis.keyPoints.map((point, index) => (
                <View key={index} style={styles.pointRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.pointText}>{point}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {concepts.length > 0 ? (
        <Card style={styles.section}>
          <SectionTitle action={t(ui.seeAll)} onAction={() => onOpenTab("concepts")}>
            {t(ui.keyConcepts)}
          </SectionTitle>
          <View style={styles.chips}>
            {concepts.slice(0, 8).map((concept) => (
              <Chip
                key={concept.term}
                label={concept.term}
                gold
                onPress={() => onOpenTab("concepts", concept.term)}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {moments.length > 0 ? (
        <Card style={styles.section}>
          <SectionTitle
            action={moments.length > MOMENTS_PREVIEW ? (showAllMoments ? t(ui.showLess) : t(ui.viewAllMoments)) : undefined}
            onAction={moments.length > MOMENTS_PREVIEW ? onToggleMoments : undefined}
          >
            {t(ui.importantMomentsTitle)}
          </SectionTitle>

          <View style={styles.moments}>
            {shown.map((moment, index) => (
              <Pressable
                key={`${moment.at}:${index}`}
                style={styles.moment}
                onPress={() => onSeek(moment.at)}
                accessibilityRole="button"
                accessibilityLabel={`${clock(moment.at)} ${moment.text}`}
              >
                <View style={styles.momentBody}>
                  <Text style={styles.momentStamp}>{clock(moment.at)}</Text>
                  <Text style={styles.momentText}>“{moment.text}”</Text>
                  {moment.reason ? <Meta>{moment.reason}</Meta> : null}
                </View>
                <View style={styles.momentPlay}>
                  <Text style={styles.momentPlayGlyph}>▶</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {tasks.length > 0 ? (
        <Card style={styles.section}>
          <SectionTitle action={t(ui.seeAll)} onAction={() => onOpenTab("tasks")}>
            {t(ui.tasksAndAssignments)}
          </SectionTitle>
          <View style={styles.taskList}>
            {tasks.slice(0, 4).map((index) => {
              const task = analysis.tasks[index]!;
              return (
                <TaskRow
                  key={index}
                  text={task.text}
                  due={task.due}
                  inferredDue={task.dueISO ? task.dueIsExplicit === false : false}
                  atSeconds={task.atSeconds}
                  done={done.has(index)}
                  onToggle={() => onToggleTask(index)}
                  onSeek={onSeek}
                />
              );
            })}
          </View>
        </Card>
      ) : null}

      {chapters.length > 0 ? (
        <Card style={styles.section}>
          <SectionTitle>{t(ui.lectureMap)}</SectionTitle>
          <View style={styles.chapters}>
            {chapters.map((chapter, index) => (
              <Pressable
                key={index}
                style={styles.chapter}
                onPress={() => onSeek(chapter.atSeconds)}
                accessibilityRole="button"
                accessibilityLabel={`${clock(chapter.atSeconds)} ${chapter.title}`}
              >
                {/* A rail down the side turns a list of headings into the
                    shape of the hour: each part in order, each one a way back
                    into the recording. */}
                <View style={styles.chapterMark}>
                  <View style={styles.chapterNode} />
                  {index < chapters.length - 1 ? <View style={styles.chapterRail} /> : null}
                </View>
                <View style={styles.chapterBody}>
                  <View style={styles.chapterHead}>
                    <Text style={styles.chapterStamp}>{clock(chapter.atSeconds)}</Text>
                    <Text style={styles.chapterTitle}>{chapter.title}</Text>
                  </View>
                  {chapter.points.map((point, i) => (
                    <Text key={i} style={styles.chapterPoint}>
                      {point}
                    </Text>
                  ))}
                </View>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

/**
 * Concepts, with the lecture behind each one.
 *
 * The chips are the index; opening one replaces it with everything the
 * lecture has to say about that word — the definition, every second it was
 * said, and what the lecturer put beside it.
 */
function Concepts({
  concepts,
  open,
  onOpen,
  onSeek,
}: {
  concepts: ConceptDetail[];
  open: string | null;
  onOpen: (term: string | null) => void;
  onSeek: (seconds: number) => void;
}) {
  if (concepts.length === 0) {
    return <EmptyState glyph="◈" title={t(ui.noTerms)} />;
  }

  const active = concepts.find((c) => c.term === open) ?? null;

  return (
    <View style={styles.stack}>
      <Card style={styles.section}>
        <View style={styles.chips}>
          {concepts.map((concept) => (
            <Chip
              key={concept.term}
              label={concept.term}
              active={concept.term === active?.term}
              gold={concept.term !== active?.term}
              onPress={() => onOpen(concept.term === active?.term ? null : concept.term)}
            />
          ))}
        </View>
      </Card>

      {active ? (
        <Card raised style={styles.section}>
          <Text style={styles.conceptTerm}>{active.term}</Text>
          <Text style={styles.paragraph}>{active.definition}</Text>

          {active.quote ? (
            <View style={styles.quote}>
              <View style={styles.quoteBar} />
              <View style={styles.quoteBody}>
                <Text style={styles.quoteText}>“{active.quote}”</Text>
                {typeof active.atSeconds === "number" ? (
                  <Pressable onPress={() => onSeek(active.atSeconds!)} accessibilityRole="button">
                    <Text style={styles.quoteMeta}>
                      ▶ {t(ui.saidAt)} {clock(active.atSeconds)}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {active.mentions.length > 0 ? (
            <View style={styles.subsection}>
              <Text style={styles.subhead}>
                {t(ui.whereItAppeared)} · {active.mentions.length} {t(ui.mentionsCount)}
              </Text>
              <View style={styles.mentions}>
                {active.mentions.slice(0, 8).map((mention) => (
                  <Pressable
                    key={mention.at}
                    style={styles.mention}
                    onPress={() => onSeek(mention.at)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.mentionStamp}>{clock(mention.at)}</Text>
                    <Text style={styles.mentionText} numberOfLines={2}>
                      {mention.text}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {active.related.length > 0 ? (
            <View style={styles.subsection}>
              <Text style={styles.subhead}>{t(ui.relatedConcepts)}</Text>
              <View style={styles.chips}>
                {active.related.map((term) => (
                  <Chip key={term} label={term} onPress={() => onOpen(term)} />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

function TasksTab({
  lecture,
  confirmed,
  candidates,
  done,
  busy,
  remindersOn,
  onToggle,
  onDecide,
  onSeek,
  onIcs,
  onReminders,
}: {
  lecture: Lecture;
  confirmed: number[];
  candidates: number[];
  done: Set<number>;
  busy: number | null;
  remindersOn: boolean;
  onToggle: (index: number) => void;
  onDecide: (index: number, keep: boolean) => void;
  onSeek: (seconds: number) => void;
  onIcs: () => void;
  onReminders: () => void;
}) {
  const tasks = lecture.analysis?.tasks ?? [];

  if (tasks.length === 0) {
    return <EmptyState glyph="◪" title={t(ui.noTasks)} />;
  }

  return (
    <View style={styles.stack}>
      {candidates.length > 0 ? (
        <Card style={styles.section}>
          <SectionTitle>
            {candidates.length === 1 ? t(ui.newTaskFound) : t(ui.newTasksFound)}
          </SectionTitle>
          <View style={styles.taskList}>
            {candidates.map((index) => {
              const task = tasks[index]!;
              return (
                <View key={index} style={styles.candidate}>
                  <Text style={styles.taskText}>{task.text}</Text>
                  {typeof task.atSeconds === "number" ? (
                    <Pressable onPress={() => onSeek(task.atSeconds!)} accessibilityRole="button">
                      <Text style={styles.jumpText}>
                        ▶ {t(ui.mentionedAt)} {clock(task.atSeconds)}
                      </Text>
                    </Pressable>
                  ) : null}
                  <View style={styles.candidateActions}>
                    <Button
                      label={t(ui.addTask)}
                      variant="primary"
                      size="sm"
                      busy={busy === index}
                      onPress={() => onDecide(index, true)}
                    />
                    <Button
                      label={t(ui.dismissTask)}
                      variant="ghost"
                      size="sm"
                      disabled={busy === index}
                      onPress={() => onDecide(index, false)}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}

      {confirmed.length > 0 ? (
        <Card style={styles.section}>
          <SectionTitle>{t(ui.tasksAndAssignments)}</SectionTitle>
          <View style={styles.taskList}>
            {confirmed.map((index) => {
              const task = tasks[index]!;
              return (
                <TaskRow
                  key={index}
                  text={task.text}
                  due={task.due}
                  inferredDue={task.dueISO ? task.dueIsExplicit === false : false}
                  quote={task.quote}
                  atSeconds={task.atSeconds}
                  done={done.has(index)}
                  onToggle={() => onToggle(index)}
                  onSeek={onSeek}
                />
              );
            })}
          </View>

          <View style={styles.taskActions}>
            <Button label={t(ui.downloadIcs)} glyph="🗓" size="sm" onPress={onIcs} />
            <Button
              label={remindersOn ? t(ui.remindersOn) : t(ui.enableReminders)}
              glyph="🔔"
              size="sm"
              variant={remindersOn ? "primary" : "secondary"}
              onPress={onReminders}
            />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

/**
 * The exam tab.
 *
 * Stated first, and separated. A student revising has to be able to tell what
 * the lecturer actually said from what we concluded — mixing them in one list
 * is how an app loses the right to be trusted about an exam.
 */
function ExamTab({ lecture, onSeek }: { lecture: Lecture; onSeek: (seconds: number) => void }) {
  const predictions = lecture.analysis?.examPredictions ?? [];
  if (predictions.length === 0) {
    return <EmptyState glyph="★" title={t(ui.noExam)} />;
  }

  return (
    <View style={styles.stack}>
      {(["stated", "inferred"] as const).map((basis) => {
        const group = predictions.filter((p) => (p.basis ?? "inferred") === basis);
        if (group.length === 0) return null;
        return (
          <Card key={basis} style={styles.section}>
            <View style={styles.basisRow}>
              <Chip
                label={t(basis === "stated" ? ui.statedByLecturer : ui.inferredByAI)}
                tone={basis === "stated" ? "stated" : "inferred"}
              />
            </View>

            {group.map((prediction, index) => (
              <View key={index} style={styles.entry}>
                <View style={styles.predictionHead}>
                  <Text style={styles.conceptTerm}>{prediction.topic}</Text>
                  <Chip
                    label={t(
                      prediction.confidence === "high"
                        ? ui.confHigh
                        : prediction.confidence === "low"
                          ? ui.confLow
                          : ui.confMedium,
                    )}
                    gold={prediction.confidence === "high"}
                  />
                </View>
                <Text style={styles.paragraph}>{prediction.why}</Text>
                {prediction.quote ? (
                  <View style={styles.quote}>
                    <View style={styles.quoteBar} />
                    <View style={styles.quoteBody}>
                      <Text style={styles.quoteText}>“{prediction.quote}”</Text>
                      {typeof prediction.atSeconds === "number" ? (
                        <Pressable
                          onPress={() => onSeek(prediction.atSeconds!)}
                          accessibilityRole="button"
                        >
                          <Text style={styles.quoteMeta}>
                            ▶ {t(ui.saidAt)} {clock(prediction.atSeconds)}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        );
      })}
    </View>
  );
}

/** One task, wherever it is shown. */
function TaskRow({
  text,
  due,
  inferredDue,
  quote,
  atSeconds,
  done,
  onToggle,
  onSeek,
}: {
  text: string;
  due?: string;
  inferredDue: boolean;
  quote?: string;
  atSeconds?: number;
  done: boolean;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
}) {
  return (
    <View style={styles.task}>
      <View style={styles.taskTop}>
        <Pressable
          onPress={onToggle}
          hitSlop={12}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={text}
          style={[styles.check, done && styles.checkOn]}
        >
          {done ? <Text style={styles.checkGlyph}>✓</Text> : null}
        </Pressable>

        <View style={styles.taskBody}>
          <Text style={[styles.taskText, done && styles.taskDone]}>{text}</Text>
          {due ? (
            <View style={styles.dueRow}>
              <Text style={styles.taskDue}>{due}</Text>
              {inferredDue ? (
                <Text style={styles.dueGuessed}>· {t(ui.deadlineInferred)}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {quote ? (
        <Pressable
          style={styles.quote}
          onPress={() => (typeof atSeconds === "number" ? onSeek(atSeconds) : undefined)}
          accessibilityRole="button"
        >
          <View style={styles.quoteBar} />
          <View style={styles.quoteBody}>
            <Text style={styles.quoteText}>“{quote}”</Text>
            {typeof atSeconds === "number" ? (
              <Text style={styles.quoteMeta}>
                ▶ {t(ui.saidAt)} {clock(atSeconds)}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ) : typeof atSeconds === "number" ? (
        <Pressable onPress={() => onSeek(atSeconds)} accessibilityRole="button">
          <Text style={styles.jumpText}>
            ▶ {t(ui.mentionedAt)} {clock(atSeconds)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingTop: SP.sm, gap: SP.lg },
  stack: { gap: SP.md },

  header: { gap: SP.sm },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: SP.sm },
  headerBody: { flex: 1, gap: 3, paddingTop: 2 },
  title: {
    color: TEXT,
    fontSize: SCALE.title - 2,
    lineHeight: SCALE.titleLine - 2,
    fontFamily: FONTS.display,
    textAlign: READ,
  },

  /* Sticky, so it has to be opaque — content sliding under a transparent
     band reads as a rendering fault rather than as a fixed control. */
  playerWrap: { paddingVertical: SP.sm, backgroundColor: INK },
  player: { padding: SP.md },
  playerRow: { flexDirection: "row", alignItems: "center", gap: SP.md },
  playerBody: { flex: 1, gap: SP.xs },
  playerTimes: { flexDirection: "row", justifyContent: "space-between" },
  playerTime: {
    color: TEXT_FAINT,
    fontSize: SCALE.micro,
    fontFamily: FONTS.body,
    fontVariant: ["tabular-nums"],
  },
  play: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    ...glow(GOLD, 16, 0.24),
  },
  playGlyph: { color: INK, fontSize: 15 },
  nudges: { flexDirection: "row", gap: 2 },

  section: { gap: SP.md },
  subsection: { gap: SP.sm, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: SP.md },
  subhead: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium, textAlign: READ },

  paragraph: {
    color: TEXT_SOFT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  points: { gap: SP.md, marginTop: SP.xs },
  pointRow: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD, marginTop: 9 },
  pointText: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.label + 1,
    lineHeight: SCALE.labelLine + 7,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm, justifyContent: READ_END },

  moments: { gap: SP.md },
  moment: { flexDirection: "row", alignItems: "center", gap: SP.md },
  momentBody: { flex: 1, gap: 3 },
  momentStamp: {
    color: GOLD,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    fontVariant: ["tabular-nums"],
    textAlign: READ,
  },
  momentText: {
    color: TEXT,
    fontSize: SCALE.label + 1,
    lineHeight: SCALE.labelLine + 7,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  momentPlay: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(217,185,104,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  momentPlayGlyph: { color: GOLD, fontSize: 12 },

  chapters: { gap: 0 },
  chapter: { flexDirection: "row", gap: SP.md, paddingBottom: SP.md },
  chapterMark: { alignItems: "center", width: 12 },
  chapterNode: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: GOLD,
    marginTop: 5,
  },
  chapterRail: { flex: 1, width: 1, backgroundColor: HAIRLINE, marginTop: 2 },
  chapterBody: { flex: 1, gap: SP.xs },
  chapterHead: { flexDirection: "row", alignItems: "baseline", gap: SP.sm, flexWrap: "wrap" },
  chapterStamp: {
    color: GOLD,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    fontVariant: ["tabular-nums"],
  },
  chapterTitle: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.label + 1,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },
  chapterPoint: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 5,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  conceptTerm: {
    color: TEXT,
    fontSize: SCALE.section + 1,
    lineHeight: SCALE.sectionLine,
    fontFamily: FONTS.displayBold,
    textAlign: READ,
  },

  mentions: { gap: SP.sm },
  mention: { flexDirection: "row", gap: SP.md, alignItems: "flex-start" },
  mentionStamp: {
    color: GOLD,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    fontVariant: ["tabular-nums"],
    minWidth: 44,
  },
  mentionText: {
    flex: 1,
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 4,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  taskList: { gap: SP.lg },
  task: { gap: SP.sm },
  taskTop: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },
  taskBody: { flex: 1, gap: SP.xs },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#3B3324",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkOn: { backgroundColor: GOLD, borderColor: GOLD },
  checkGlyph: { color: INK, fontSize: 13, fontFamily: FONTS.displayBold },
  taskText: {
    color: TEXT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  taskDone: { color: TEXT_FAINT, textDecorationLine: "line-through" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  taskDue: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },
  dueGuessed: { color: STATE.inferred.fg, fontSize: SCALE.micro, fontFamily: FONTS.body },
  taskActions: {
    flexDirection: "row",
    gap: SP.sm,
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: SP.md,
  },

  candidate: { gap: SP.sm },
  candidateActions: { flexDirection: "row", gap: SP.sm, marginTop: SP.xs },

  entry: { gap: SP.sm, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: SP.md },
  basisRow: { flexDirection: "row", justifyContent: READ_END },
  predictionHead: { flexDirection: "row", alignItems: "center", gap: SP.sm, flexWrap: "wrap" },

  quote: { flexDirection: "row", gap: SP.md, alignItems: "stretch" },
  quoteBar: { width: 2, borderRadius: 1, backgroundColor: STATE.stated.line },
  quoteBody: { flex: 1, gap: 3 },
  quoteText: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 5,
    fontFamily: FONTS.body,
    fontStyle: "italic",
    textAlign: READ,
  },
  quoteMeta: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium, textAlign: READ },
  jumpText: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium, textAlign: READ },

  transcript: { gap: 0, padding: SP.md },
  line: {
    flexDirection: "row",
    gap: SP.md,
    alignItems: "flex-start",
    paddingVertical: SP.sm,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.sm,
  },
  /* The line currently sounding. A tinted band rather than a colour change on
     the words themselves, so a long Arabic paragraph does not start shouting. */
  lineActive: { backgroundColor: "rgba(217,185,104,0.09)" },
  lineStamp: {
    color: TEXT_FAINT,
    fontSize: SCALE.micro,
    fontFamily: FONTS.body,
    fontVariant: ["tabular-nums"],
    minWidth: 44,
    paddingTop: 3,
  },
  lineStampActive: { color: GOLD, fontFamily: FONTS.bodyMedium },
  lineText: {
    flex: 1,
    color: TEXT_SOFT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  lineTextActive: { color: TEXT },
  lineLoud: { color: TEXT, fontFamily: FONTS.bodyMedium },
  lineMarked: { color: GOLD },
  lineStar: { color: GOLD, fontSize: 11, paddingTop: 4 },
});
