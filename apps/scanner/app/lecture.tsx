import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { pack, isAudio, type Lecture, type Text as I18nText } from "../src/packs";
import { t, locale } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import {
  audioDuration,
  clock,
  deleteLecture,
  deleteRecording,
  getLecture,
  locate,
  scoreEnergy,
  transcriptOfSegments,
  updateLecture,
} from "../src/lectures";
import {
  cancelTaskReminders,
  datedTasks,
  remindersScheduled,
  scheduleTaskReminders,
  shareFile,
  toIcs,
  toMarkdown,
} from "../src/lecture-export";
import { FONTS, SCALE } from "../src/type";
import {
  GOLD,
  GOLD_DEEP,
  INK,
  BLOOM,
  PANEL_GRADIENT,
  lift,
  audio as s,
  READ,
  READ_END,
  STATE,
  SP,
  RADIUS,
  TEXT_SOFT,
} from "../src/components/audio-theme";
import { LinearGradient } from "expo-linear-gradient";
import { normalise } from "../src/countries";

type TabKey = "summary" | "tasks" | "terms" | "exam" | "map" | "tone" | "transcript";

const TABS: { key: TabKey; label: I18nText }[] = [
  { key: "summary", label: ui.tabSummary },
  { key: "tasks", label: ui.tabTasks },
  { key: "terms", label: ui.tabTerms },
  { key: "exam", label: ui.tabExam },
  { key: "map", label: ui.tabMap },
  { key: "tone", label: ui.tabTone },
  { key: "transcript", label: ui.tabTranscript },
];

export default function LectureScreen() {
  const router = useRouter();
  const { id, at, tab: requestedTab } = useLocalSearchParams<{ id: string; at?: string; tab?: string }>();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [tab, setTab] = useState<TabKey>(
    (["summary", "tasks", "terms", "exam", "map", "tone", "transcript"] as TabKey[]).includes(
      requestedTab as TabKey,
    )
      ? (requestedTab as TabKey)
      : "summary",
  );
  /** A deep link carries the moment it came from; honoured once, so scrolling
   *  away and coming back does not drag the student to it again. */
  const jumped = useRef(false);
  const [copied, setCopied] = useState(false);
  const [remindersOn, setRemindersOn] = useState(false);
  const [find, setFind] = useState("");
  const [autoplay, setAutoplay] = useState(false);
  /** Offset to seek to once a newly loaded slice reports itself ready. */
  const pendingSeek = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getLecture(String(id)).then(async (found) => {
        if (!active) return;
        setLecture(found ?? null);
        // Reflect what is actually scheduled with the OS, rather than
        // defaulting to "off" and offering to schedule duplicates.
        if (found) {
          const on = await remindersScheduled(found);
          if (active) setRemindersOn(on);
        }
      });
      return () => {
        active = false;
      };
    }, [id]),
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

  const analysis = lecture?.analysis;
  /** Scored once per render rather than per row: the rolling baseline is a
   *  windowed pass over every segment, so calling it inside map() would make
   *  rendering an hour-long transcript quadratic. */
  const scored = useMemo(() => scoreEnergy(lecture?.segments ?? []), [lecture?.segments]);

  /** Filtered transcript. Empty search shows everything, so the default is
   *  the whole lecture rather than a hidden one. */
  const visibleSegments = useMemo(() => {
    const q = normalise(find.trim());
    if (!q) return scored;
    return scored.filter((segment) => normalise(segment.text).includes(q));
  }, [scored, find]);
  const done = useMemo(() => new Set(lecture?.done ?? []), [lecture?.done]);

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

  /* Landing from a task or an exam signal: go to the moment it came from as
   * soon as there is audio to go to. This is the link the whole provenance
   * idea rests on — a claim you can hear. */
  useEffect(() => {
    if (jumped.current || !lecture || chunks.length === 0) return;
    const target = Number(at);
    if (!Number.isFinite(target)) return;
    jumped.current = true;
    seek(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecture, chunks.length, at]);

  /** Seeks the lecture's timeline, crossing into another slice if needed. */
  const seek = (seconds: number) => {
    const target = locate(chunks, seconds);
    if (!target) return;

    if (target.index === chunkIndex) {
      player.seekTo(target.offset);
      player.play();
      return;
    }
    // A different file has to load first; the seek is applied when it reports
    // ready, otherwise it lands on the outgoing slice and is thrown away.
    pendingSeek.current = target.offset;
    setChunkIndex(target.index);
    setAutoplay(true);
  };

  if (!isAudio(pack)) return null;

  if (!lecture) {
    return (
      <View style={[s.root, styles.loading]}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  const recorded = new Date(lecture.at);
  const dateLabel = recorded.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <View style={s.root}>
      <LinearGradient colors={BLOOM} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={s.wordmarkWrap}>
            <View style={s.langPill}>
              <Text style={s.langText}>{locale === "ar" ? "EN" : "ع"}</Text>
            </View>
            <Text style={s.wordmarkLatin}>{pack.wordmark}</Text>
            <Text style={s.wordmarkDot}>•</Text>
            <Text style={s.wordmarkArabic}>{t(pack.appName)}</Text>
          </View>

          <View style={styles.datePill}>
            <View style={styles.dateDot} />
            <Text style={styles.dateText}>{dateLabel}</Text>
          </View>

          <Text style={styles.title}>{lecture.title || t(ui.untitledLecture)}</Text>

          <View style={styles.notice}>
            <Text style={styles.noticeText}>{t(pack.disclaimer)}</Text>
          </View>

          <View style={styles.chips}>
            <Chip text={`${Math.max(1, Math.round(lecture.duration / 60))} ${t(ui.minShort)}`} />
            <Chip text={`${analysis?.tasks.length ?? 0} ${t(ui.tasksCount)}`} />
            <Chip text={`${analysis?.terms.length ?? 0} ${t(ui.termsCount)}`} />
            {typeof analysis?.confidence === "number" ? (
              <Chip text={`🎯 ${analysis.confidence}%`} gold />
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actions}
          >
            <Action label={t(ui.home)} glyph="←" onPress={() => router.replace("/")} />
            <Action label={copied ? t(ui.copied) : t(ui.copyAll)} glyph="⧉" onPress={copyAll} />
            <Action label={t(ui.downloadMd)} glyph="↓" onPress={downloadMd} />
            {hasAudio ? (
              <Action
                label={t(ui.retranscribe)}
                glyph="↻"
                onPress={async () => {
                  await cancelTaskReminders(lecture);
                  setRemindersOn(false);
                  router.push({
                    pathname: "/analyzing",
                    params: { id: lecture.id, retranscribe: "1" },
                  });
                }}
              />
            ) : null}
            <Action
              label={t(ui.reanalyse)}
              glyph="✧"
              onPress={async () => {
                // The scheduled reminders point at tasks in the list that is
                // about to be replaced. Left alone they would fire for work
                // the new analysis no longer contains.
                await cancelTaskReminders(lecture);
                setRemindersOn(false);
                router.push({ pathname: "/analyzing", params: { id: lecture.id } });
              }}
            />
            <Action label={t(ui.deleteLecture)} glyph="🗑" onPress={confirmDelete} danger />
          </ScrollView>

          {hasAudio ? (
            <View style={styles.playerWrap}>
              <Text style={styles.playerHint}>{t(ui.playerHint)}</Text>
              <View style={[s.panel, styles.player, lift]}>
                <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />
                <Pressable
                  style={styles.playButton}
                  onPress={() => (status.playing ? player.pause() : player.play())}
                >
                  <Text style={styles.playGlyph}>{status.playing ? "❙❙" : "▶"}</Text>
                </Pressable>
                <Text style={styles.playerTime}>{clock(playedSeconds)}</Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.trackFill,
                      {
                        width: `${Math.min(
                          100,
                          (playedSeconds / Math.max(1, recordedSeconds || lecture.duration)) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.playerTime}>
                  {clock(recordedSeconds || lecture.duration)}
                </Text>
              </View>
            </View>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {TABS.map((entry) => (
              <Pressable
                key={entry.key}
                style={[styles.tab, tab === entry.key && styles.tabActive]}
                onPress={() => setTab(entry.key)}
              >
                <Text style={[styles.tabText, tab === entry.key && styles.tabTextActive]}>
                  {t(entry.label)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {lecture.status !== "ready" ? (
            <View style={[s.panel, styles.stateCard]}>
              <Text style={styles.stateTitle}>
                {lecture.status === "failed" ? t(ui.failed) : t(ui.processing)}
              </Text>
              <Text style={styles.stateBody}>
                {lecture.error || (lecture.status === "processing" ? t(ui.stillProcessing) : "")}
              </Text>
              <View style={styles.stateActions}>
                <Action
                  label={t(ui.reanalyse)}
                  glyph="✧"
                  onPress={() => router.push({ pathname: "/analyzing", params: { id: lecture.id } })}
                />
                {hasAudio ? (
                  <Action
                    label={t(ui.retranscribe)}
                    glyph="↻"
                    onPress={() =>
                      router.push({
                        pathname: "/analyzing",
                        params: { id: lecture.id, retranscribe: "1" },
                      })
                    }
                  />
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={[s.panel, styles.body, lift]}>
            <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />
            {tab === "summary" ? (
              <>
                <Text style={styles.paragraph}>{analysis?.summary}</Text>
                {analysis?.keyPoints.map((point, index) => (
                  <View key={index} style={styles.bulletRow}>
                    <View style={styles.bullet} />
                    <Text style={styles.bulletText}>{point}</Text>
                  </View>
                ))}
              </>
            ) : null}

            {tab === "tasks" ? (
              <>
                <View style={styles.taskActions}>
                  <Action label={t(ui.downloadIcs)} glyph="🗓" onPress={downloadIcs} />
                  <Action
                    label={remindersOn ? t(ui.remindersOn) : t(ui.enableReminders)}
                    glyph="🔔"
                    onPress={toggleReminders}
                    active={remindersOn}
                  />
                </View>
                {(analysis?.tasks ?? []).length === 0 ? (
                  <Text style={styles.empty}>{t(ui.noTasks)}</Text>
                ) : (
                  analysis!.tasks.map((task, index) => (
                    <View key={index} style={styles.entry}>
                      <Pressable style={styles.taskRow} onPress={() => toggleTask(index)}>
                        <View style={[styles.checkbox, done.has(index) && styles.checkboxOn]}>
                          {done.has(index) ? <Text style={styles.checkGlyph}>✓</Text> : null}
                        </View>
                        <View style={styles.taskBody}>
                          <Text style={[styles.taskText, done.has(index) && styles.taskDone]}>
                            {task.text}
                          </Text>
                          {task.due ? (
                            <View style={styles.dueRow}>
                              <Text style={styles.taskDue}>{task.due}</Text>
                              {task.dueIsExplicit === false ? (
                                <Text style={styles.dueGuessed}>· {t(ui.deadlineInferred)}</Text>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                        {task.difficulty ? (
                          <View style={s.tag}>
                            <Text style={s.tagText}>
                              {t(
                                task.difficulty === "easy"
                                  ? ui.easy
                                  : task.difficulty === "hard"
                                    ? ui.hard
                                    : ui.medium,
                              )}
                            </Text>
                          </View>
                        ) : null}
                      </Pressable>
                      <Source quote={task.quote} atSeconds={task.atSeconds} onPlay={seek} />
                    </View>
                  ))
                )}
              </>
            ) : null}

            {tab === "terms" ? (
              (analysis?.terms ?? []).length === 0 ? (
                <Text style={styles.empty}>{t(ui.noTerms)}</Text>
              ) : (
                analysis!.terms.map((entry, index) => (
                  <View key={index} style={styles.termRow}>
                    <Text style={styles.term}>{entry.term}</Text>
                    <Text style={styles.termDef}>{entry.definition}</Text>
                    <Source quote={entry.quote} atSeconds={entry.atSeconds} onPlay={seek} />
                  </View>
                ))
              )
            ) : null}

            {tab === "exam" ? (
              (analysis?.examPredictions ?? []).length === 0 ? (
                <Text style={styles.empty}>{t(ui.noExam)}</Text>
              ) : (
                <>
                  {/* Stated first, and separated. A student revising has to be
                      able to tell what the lecturer actually said from what we
                      concluded — mixing them in one list is how an app loses
                      the right to be trusted about an exam. */}
                  {(["stated", "inferred"] as const).map((basis) => {
                    const group = analysis!.examPredictions.filter(
                      (p) => (p.basis ?? "inferred") === basis,
                    );
                    if (group.length === 0) return null;
                    return (
                      <View key={basis} style={styles.examGroup}>
                        <Basis basis={basis} />
                        {group.map((prediction, index) => (
                          <View key={index} style={styles.entry}>
                            <View style={styles.predictionHead}>
                              <Text style={styles.term}>{prediction.topic}</Text>
                              <View
                                style={[
                                  s.tag,
                                  prediction.confidence === "high" && styles.tagHigh,
                                  prediction.confidence === "low" && styles.tagLow,
                                ]}
                              >
                                <Text style={s.tagText}>
                                  {t(
                                    prediction.confidence === "high"
                                      ? ui.confHigh
                                      : prediction.confidence === "low"
                                        ? ui.confLow
                                        : ui.confMedium,
                                  )}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.termDef}>{prediction.why}</Text>
                            <Source
                              quote={prediction.quote}
                              atSeconds={prediction.atSeconds}
                              onPlay={seek}
                            />
                          </View>
                        ))}
                      </View>
                    );
                  })}
                </>
              )
            ) : null}

            {tab === "map" ? (
              (analysis?.chapters ?? []).map((chapter, index) => (
                <Pressable
                  key={index}
                  style={styles.chapter}
                  onPress={() => seek(chapter.atSeconds)}
                >
                  {/* A rail down the side turns a list of headings into the
                      shape of the hour: each part in order, each one a way
                      back into the recording. */}
                  <View style={styles.chapterHead}>
                    <View style={styles.chapterMark}>
                      <View style={styles.chapterNode} />
                      {index < (analysis?.chapters.length ?? 0) - 1 ? (
                        <View style={styles.chapterRail} />
                      ) : null}
                    </View>
                    <Text style={styles.chapterStamp}>{clock(chapter.atSeconds)}</Text>
                    <Text style={styles.chapterTitle}>{chapter.title}</Text>
                  </View>
                  {chapter.points.map((point, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <View style={styles.bullet} />
                      <Text style={styles.bulletText}>{point}</Text>
                    </View>
                  ))}
                </Pressable>
              ))
            ) : null}

            {tab === "tone" ? (
              (analysis?.emphasised ?? []).length === 0 ? (
                <Text style={styles.empty}>{t(ui.noTone)}</Text>
              ) : (
                analysis!.emphasised.map((moment, index) => (
                  <Pressable
                    key={index}
                    style={styles.toneRow}
                    onPress={() => seek(moment.atSeconds)}
                  >
                    <Text style={styles.toneStamp}>{clock(moment.atSeconds)}</Text>
                    <View style={styles.taskBody}>
                      <Text style={styles.toneText}>{moment.text}</Text>
                      <Text style={styles.toneReason}>{moment.reason}</Text>
                    </View>
                    <Text style={styles.tonePlay}>▶</Text>
                  </Pressable>
                ))
              )
            ) : null}

            {tab === "transcript" ? (
              <>
                {/* A ninety-minute transcript is unusable as a wall. Search is
                    how anyone actually returns to something they half
                    remember, and the marked lines are the shortcuts. */}
                <View style={styles.tSearch}>
                  <Text style={styles.tSearchGlyph}>⌕</Text>
                  <TextInput
                    style={styles.tSearchInput}
                    value={find}
                    onChangeText={setFind}
                    placeholder={t(ui.searchGuide)}
                    placeholderTextColor="#5B5443"
                    autoCorrect={false}
                    textAlign={READ}
                  />
                  {find.length > 0 ? (
                    <Pressable onPress={() => setFind("")} hitSlop={10}>
                      <Text style={styles.tSearchClear}>✕</Text>
                    </Pressable>
                  ) : null}
                </View>

                {visibleSegments.length === 0 ? (
                  <Text style={styles.empty}>
                    {find ? t(ui.noMatch) : transcriptOfSegments(lecture.segments)}
                  </Text>
                ) : (
                  visibleSegments.map((segment, index) => (
                    <Pressable key={index} style={styles.line} onPress={() => seek(segment.at)}>
                      <Text style={styles.lineStamp}>{clock(segment.at)}</Text>
                      <Text
                        style={[
                          styles.lineText,
                          segment.emphasis >= 0.5 && styles.lineLoud,
                          segment.marked && styles.lineMarked,
                        ]}
                      >
                        {segment.text}
                      </Text>
                      {segment.marked ? <Text style={styles.lineStar}>★</Text> : null}
                    </Pressable>
                  ))
                )}
              </>
            ) : null}
          </View>

          <Text style={s.footer}>{t(pack.voice.footer)}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * Where a claim came from.
 *
 * The quotation is verified against the transcript on the server before it
 * ever reaches here, so what is shown is genuinely what was said. Tapping it
 * plays that second of the recording — which is the whole reason any of this
 * exists.
 */
function Source({
  quote,
  atSeconds,
  onPlay,
}: {
  quote?: string;
  atSeconds?: number;
  onPlay: (seconds: number) => void;
}) {
  const has = typeof atSeconds === "number";
  if (!quote && !has) return null;

  return (
    <Pressable
      style={styles.source}
      onPress={() => has && onPlay(atSeconds!)}
      disabled={!has}
      accessibilityRole={has ? "button" : undefined}
    >
      <View style={styles.sourceBar} />
      <View style={styles.sourceBody}>
        {quote ? <Text style={styles.sourceQuote}>“{quote}”</Text> : null}
        {has ? (
          <Text style={styles.sourcePlay}>
            ▶ {t(ui.saidAt)} {clock(atSeconds!)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Says plainly whether the lecturer stated something or the model worked it
 *  out. Carries a word as well as a colour — a student who cannot see the
 *  difference in hue still has to be able to tell these apart. */
function Basis({ basis }: { basis?: "stated" | "inferred" }) {
  const stated = basis === "stated";
  const tone = stated ? STATE.stated : STATE.inferred;
  return (
    <View style={[styles.basis, { backgroundColor: tone.bg, borderColor: tone.line }]}>
      <Text style={[styles.basisText, { color: tone.fg }]}>
        {stated ? t(ui.statedByLecturer) : t(ui.inferredByAI)}
      </Text>
    </View>
  );
}

function Chip({ text, gold }: { text: string; gold?: boolean }) {
  return (
    <View style={[styles.chip, gold && styles.chipGold]}>
      <Text style={[styles.chipText, gold && styles.chipTextGold]}>{text}</Text>
    </View>
  );
}

function Action({
  label,
  glyph,
  onPress,
  danger,
  active,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
        danger && styles.actionDanger,
        active && styles.actionActive,
        pressed && s.pressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.actionGlyph, danger && styles.actionDangerText]}>{glyph}</Text>
      <Text style={[styles.actionText, danger && styles.actionDangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", justifyContent: "center" },
  stateCard: { padding: 20, gap: 12, marginBottom: 14 },
  stateTitle: { color: GOLD, fontSize: 16, fontFamily: FONTS.displayBold, textAlign: READ },
  stateBody: { color: "#9C9382", fontSize: 14, fontFamily: FONTS.body, lineHeight: 28, textAlign: READ },
  stateActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: READ_END },
  content: { paddingHorizontal: 20, paddingBottom: 56 },

  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: READ_END,
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 26,
  },
  dateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  dateText: { color: "#C9BC9A", fontSize: 12.5, fontFamily: FONTS.body },

  title: {
    color: "#F5EEDF",
    fontSize: 40,
    fontFamily: FONTS.displayBold,
    lineHeight: 60,
    marginTop: 18,
    textAlign: READ,
  },

  notice: {
    backgroundColor: "#241E0C",
    borderWidth: 1,
    borderColor: "#4A3D18",
    borderRadius: 14,
    padding: 16,
    marginTop: 18,
  },
  noticeText: { color: "#C9AE73", fontSize: 13, fontFamily: FONTS.body, lineHeight: 24, textAlign: READ },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, justifyContent: READ_END },
  chip: {
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipGold: { borderColor: "#4A3D18", backgroundColor: "#241E0C" },
  chipText: { color: "#C9BC9A", fontSize: 12.5, fontFamily: FONTS.body },
  chipTextGold: { color: GOLD, fontFamily: FONTS.displayBold },

  actions: { gap: 8, paddingVertical: 16, flexDirection: "row" },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 17,
  },
  actionActive: { backgroundColor: "#241E0C", borderColor: "#4A3D18" },
  actionDanger: { backgroundColor: "#2A1310", borderColor: "#5A2620" },
  actionGlyph: { color: "#C9BC9A", fontSize: 13 },
  actionText: { color: "#E8E0CE", fontSize: 14, fontFamily: FONTS.bodyMedium },
  actionDangerText: { color: "#E08878" },

  playerWrap: { marginTop: 6, gap: 10 },
  playerHint: { color: "#6E685C", fontSize: 12, fontFamily: FONTS.body, textAlign: READ },
  player: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, overflow: "hidden" },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GOLD,
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  playGlyph: { color: INK, fontSize: 15 },
  playerTime: { color: "#8E8676", fontSize: 12, fontFamily: FONTS.body, fontVariant: ["tabular-nums"] },
  track: { flex: 1, height: 4, backgroundColor: "#241F14", borderRadius: 2, overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: GOLD, borderRadius: 2 },

  tabs: { gap: 7, paddingTop: 22, paddingBottom: 14, flexDirection: "row" },
  tab: {
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  tabActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  tabText: { color: "#C9BC9A", fontSize: 14, fontFamily: FONTS.bodyMedium },
  tabTextActive: { color: INK, fontFamily: FONTS.displayBold },

  body: { padding: 20, gap: 15, overflow: "hidden" },
  paragraph: { color: "#E8E0CE", fontSize: 16, fontFamily: FONTS.body, lineHeight: 32, textAlign: READ },
  empty: { color: "#8E8676", fontSize: 15, fontFamily: FONTS.body, lineHeight: 30, textAlign: "center", paddingVertical: 20 },

  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD, marginTop: 13 },
  bulletText: { color: "#C9BC9A", fontSize: 15, fontFamily: FONTS.body, lineHeight: 30, flex: 1, textAlign: READ },

  taskActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: READ_END },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#221D12",
    paddingTop: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3A3324",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: GOLD, borderColor: GOLD },
  checkGlyph: { color: INK, fontSize: 13, fontFamily: FONTS.displayBold },
  taskBody: { flex: 1, gap: 3 },
  taskText: { color: "#E8E0CE", fontSize: 15, fontFamily: FONTS.body, lineHeight: 28, textAlign: READ },
  taskDone: { color: "#6E685C", textDecorationLine: "line-through" },
  taskDue: { color: GOLD, fontSize: 12, fontFamily: FONTS.body, textAlign: READ },
  taskCal: { fontSize: 13 },

  entry: { borderTopWidth: 1, borderTopColor: "#221D12", paddingTop: 14, gap: 9 },
  termRow: { borderTopWidth: 1, borderTopColor: "#221D12", paddingTop: 14, gap: 7 },
  examGroup: { gap: 12, marginBottom: 6 },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  dueGuessed: { color: STATE.inferred.fg, fontSize: SCALE.micro, fontFamily: FONTS.body },

  basis: {
    alignSelf: READ_END,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  basisText: { fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },

  /* The lecturer's own words, and the way back to them. */
  source: { flexDirection: "row", gap: SP.md, alignItems: "stretch", marginTop: 2 },
  sourceBar: { width: 2, borderRadius: 1, backgroundColor: STATE.stated.line },
  sourceBody: { flex: 1, gap: 4 },
  sourceQuote: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 4,
    fontFamily: FONTS.scriptItalic,
    textAlign: READ,
  },
  sourcePlay: {
    color: STATE.stated.fg,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },
  term: { color: "#E8E0CE", fontSize: 16, fontFamily: FONTS.displayBold, textAlign: READ },
  termDef: { color: "#9C9382", fontSize: 14, fontFamily: FONTS.body, lineHeight: 28, textAlign: READ },
  predictionHead: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: READ_END },
  tagHigh: { backgroundColor: "#2E2A10" },
  tagLow: { backgroundColor: "#221F19" },

  chapter: { paddingTop: 6, gap: 8 },
  chapterMark: { alignItems: "center", width: 12, alignSelf: "stretch" },
  chapterNode: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: GOLD,
    marginTop: 5,
  },
  chapterRail: { flex: 1, width: 1, backgroundColor: "#2A2318", marginTop: 2 },
  chapterHead: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: READ_END },
  chapterStamp: { color: GOLD, fontSize: 12, fontFamily: FONTS.body, fontVariant: ["tabular-nums"] },
  chapterTitle: { color: "#E8E0CE", fontSize: 16, fontFamily: FONTS.displayBold, flex: 1, textAlign: READ },

  toneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#221D12",
    paddingTop: 14,
  },
  toneStamp: { color: GOLD, fontSize: 12, fontFamily: FONTS.body, fontVariant: ["tabular-nums"] },
  toneText: { color: "#E8E0CE", fontSize: 15, fontFamily: FONTS.body, lineHeight: 28, textAlign: READ },
  toneReason: { color: "#8E8676", fontSize: 13, fontFamily: FONTS.body, lineHeight: 24, textAlign: READ },
  tonePlay: { color: "#6E685C", fontSize: 12 },

  tSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    backgroundColor: "rgba(26,22,15,0.8)",
    borderWidth: 1,
    borderColor: "#2A2318",
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    marginBottom: 4,
  },
  tSearchGlyph: { color: "#5B5443", fontSize: 16 },
  tSearchInput: {
    flex: 1,
    color: "#E8E0CE",
    fontSize: SCALE.label,
    fontFamily: FONTS.body,
    paddingVertical: SP.md,
  },
  tSearchClear: { color: "#5B5443", fontSize: 14 },
  lineStar: { color: GOLD, fontSize: 11, marginTop: 6 },

  line: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 5 },
  lineStamp: { color: "#6E685C", fontSize: 12, fontFamily: FONTS.body, fontVariant: ["tabular-nums"], marginTop: 5, minWidth: 42 },
  lineText: { color: "#C9BC9A", fontSize: 15, fontFamily: FONTS.body, lineHeight: 30, flex: 1, textAlign: READ },
  lineLoud: { color: "#E8E0CE" },
  lineMarked: { color: GOLD },
});
