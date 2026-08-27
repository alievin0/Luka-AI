import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
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
  clock,
  deleteLecture,
  deleteRecording,
  getLecture,
  scoreEnergy,
  transcriptOfSegments,
  updateLecture,
} from "../src/lectures";
import {
  cancelTaskReminders,
  datedTasks,
  scheduleTaskReminders,
  shareFile,
  toIcs,
  toMarkdown,
} from "../src/lecture-export";
import { GOLD, INK, audio as s } from "../src/components/audio-theme";

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [tab, setTab] = useState<TabKey>("summary");
  const [copied, setCopied] = useState(false);
  const [remindersOn, setRemindersOn] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getLecture(String(id)).then((found) => {
        if (active) setLecture(found ?? null);
      });
      return () => {
        active = false;
      };
    }, [id]),
  );

  // The player is created unconditionally so the hook order never changes;
  // an empty source simply gives an idle player.
  const player = useAudioPlayer(lecture?.audioUri ? { uri: lecture.audioUri } : null);
  const status = useAudioPlayerStatus(player);

  const analysis = lecture?.analysis;
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
          await deleteRecording(lecture.audioUri);
          await deleteLecture(lecture.id);
          router.replace("/");
        },
      },
    ]);
  };

  const seek = (seconds: number) => {
    if (!lecture?.audioUri) return;
    player.seekTo(seconds);
    player.play();
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
            {lecture.audioUri ? (
              <Action
                label={t(ui.retranscribe)}
                glyph="↻"
                onPress={() =>
                  router.push({ pathname: "/analyzing", params: { id: lecture.id, retranscribe: "1" } })
                }
              />
            ) : null}
            <Action
              label={t(ui.reanalyse)}
              glyph="✧"
              onPress={() => router.push({ pathname: "/analyzing", params: { id: lecture.id } })}
            />
            <Action label={t(ui.deleteLecture)} glyph="🗑" onPress={confirmDelete} danger />
          </ScrollView>

          {lecture.audioUri ? (
            <View style={styles.playerWrap}>
              <Text style={styles.playerHint}>{t(ui.playerHint)}</Text>
              <View style={[s.panel, styles.player]}>
                <Pressable
                  style={styles.playButton}
                  onPress={() => (status.playing ? player.pause() : player.play())}
                >
                  <Text style={styles.playGlyph}>{status.playing ? "❙❙" : "▶"}</Text>
                </Pressable>
                <Text style={styles.playerTime}>{clock(status.currentTime ?? 0)}</Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.trackFill,
                      {
                        width: `${Math.min(
                          100,
                          ((status.currentTime ?? 0) / Math.max(1, status.duration || lecture.duration)) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.playerTime}>
                  {clock(status.duration || lecture.duration)}
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

          <View style={[s.panel, styles.body]}>
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
                    <Pressable
                      key={index}
                      style={styles.taskRow}
                      onPress={() => toggleTask(index)}
                    >
                      <View style={[styles.checkbox, done.has(index) && styles.checkboxOn]}>
                        {done.has(index) ? <Text style={styles.checkGlyph}>✓</Text> : null}
                      </View>
                      <View style={styles.taskBody}>
                        <Text style={[styles.taskText, done.has(index) && styles.taskDone]}>
                          {task.text}
                        </Text>
                        {task.due ? <Text style={styles.taskDue}>{task.due}</Text> : null}
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
                      {task.dueISO ? <Text style={styles.taskCal}>🗓</Text> : null}
                    </Pressable>
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
                  </View>
                ))
              )
            ) : null}

            {tab === "exam" ? (
              (analysis?.examPredictions ?? []).length === 0 ? (
                <Text style={styles.empty}>{t(ui.noExam)}</Text>
              ) : (
                analysis!.examPredictions.map((prediction, index) => (
                  <View key={index} style={styles.termRow}>
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
                  </View>
                ))
              )
            ) : null}

            {tab === "map" ? (
              (analysis?.chapters ?? []).map((chapter, index) => (
                <Pressable
                  key={index}
                  style={styles.chapter}
                  onPress={() => seek(chapter.atSeconds)}
                >
                  <View style={styles.chapterHead}>
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
              scoreEnergy(lecture.segments).length === 0 ? (
                <Text style={styles.empty}>{transcriptOfSegments(lecture.segments)}</Text>
              ) : (
                scoreEnergy(lecture.segments).map((segment, index) => (
                  <Pressable key={index} style={styles.line} onPress={() => seek(segment.at)}>
                    <Text style={styles.lineStamp}>{clock(segment.at)}</Text>
                    <Text
                      style={[
                        styles.lineText,
                        (segment.energy ?? 0) >= 0.6 && styles.lineLoud,
                        segment.marked && styles.lineMarked,
                      ]}
                    >
                      {segment.text}
                    </Text>
                  </Pressable>
                ))
              )
            ) : null}
          </View>

          <Text style={s.footer}>{t(pack.voice.footer)}</Text>
        </ScrollView>
      </SafeAreaView>
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
  content: { paddingHorizontal: 20, paddingBottom: 56 },

  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-end",
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 26,
  },
  dateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  dateText: { color: "#C9BC9A", fontSize: 13 },

  title: {
    color: "#F5EEDF",
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 60,
    marginTop: 18,
    textAlign: "right",
  },

  notice: {
    backgroundColor: "#241E0C",
    borderWidth: 1,
    borderColor: "#4A3D18",
    borderRadius: 14,
    padding: 16,
    marginTop: 18,
  },
  noticeText: { color: "#C9AE73", fontSize: 13, lineHeight: 24, textAlign: "right" },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, justifyContent: "flex-end" },
  chip: {
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipGold: { borderColor: "#4A3D18", backgroundColor: "#241E0C" },
  chipText: { color: "#C9BC9A", fontSize: 13 },
  chipTextGold: { color: GOLD, fontWeight: "700" },

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
  actionText: { color: "#E8E0CE", fontSize: 14, fontWeight: "600" },
  actionDangerText: { color: "#E08878" },

  playerWrap: { marginTop: 6, gap: 10 },
  playerHint: { color: "#6E685C", fontSize: 12, textAlign: "right" },
  player: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  playButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  playGlyph: { color: INK, fontSize: 15 },
  playerTime: { color: "#8E8676", fontSize: 12, fontVariant: ["tabular-nums"] },
  track: { flex: 1, height: 4, backgroundColor: "#241F14", borderRadius: 2, overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: GOLD, borderRadius: 2 },

  tabs: { gap: 8, paddingVertical: 18, flexDirection: "row" },
  tab: {
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  tabActive: { backgroundColor: GOLD, borderColor: GOLD },
  tabText: { color: "#C9BC9A", fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: INK, fontWeight: "800" },

  body: { padding: 20, gap: 14 },
  paragraph: { color: "#E8E0CE", fontSize: 16, lineHeight: 32, textAlign: "right" },
  empty: { color: "#8E8676", fontSize: 15, lineHeight: 30, textAlign: "center", paddingVertical: 20 },

  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD, marginTop: 13 },
  bulletText: { color: "#C9BC9A", fontSize: 15, lineHeight: 30, flex: 1, textAlign: "right" },

  taskActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
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
  checkGlyph: { color: INK, fontSize: 13, fontWeight: "800" },
  taskBody: { flex: 1, gap: 3 },
  taskText: { color: "#E8E0CE", fontSize: 15, lineHeight: 28, textAlign: "right" },
  taskDone: { color: "#6E685C", textDecorationLine: "line-through" },
  taskDue: { color: GOLD, fontSize: 12, textAlign: "right" },
  taskCal: { fontSize: 13 },

  termRow: { borderTopWidth: 1, borderTopColor: "#221D12", paddingTop: 14, gap: 5 },
  term: { color: "#E8E0CE", fontSize: 16, fontWeight: "700", textAlign: "right" },
  termDef: { color: "#9C9382", fontSize: 14, lineHeight: 28, textAlign: "right" },
  predictionHead: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "flex-end" },
  tagHigh: { backgroundColor: "#2E2A10" },
  tagLow: { backgroundColor: "#221F19" },

  chapter: { borderTopWidth: 1, borderTopColor: "#221D12", paddingTop: 14, gap: 8 },
  chapterHead: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "flex-end" },
  chapterStamp: { color: GOLD, fontSize: 12, fontVariant: ["tabular-nums"] },
  chapterTitle: { color: "#E8E0CE", fontSize: 16, fontWeight: "700", flex: 1, textAlign: "right" },

  toneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#221D12",
    paddingTop: 14,
  },
  toneStamp: { color: GOLD, fontSize: 12, fontVariant: ["tabular-nums"] },
  toneText: { color: "#E8E0CE", fontSize: 15, lineHeight: 28, textAlign: "right" },
  toneReason: { color: "#8E8676", fontSize: 13, lineHeight: 24, textAlign: "right" },
  tonePlay: { color: "#6E685C", fontSize: 12 },

  line: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 5 },
  lineStamp: { color: "#6E685C", fontSize: 12, fontVariant: ["tabular-nums"], marginTop: 5, minWidth: 42 },
  lineText: { color: "#C9BC9A", fontSize: 15, lineHeight: 30, flex: 1, textAlign: "right" },
  lineLoud: { color: "#E8E0CE" },
  lineMarked: { color: GOLD },
});
