import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { t, locale, fill } from "../i18n";
import { switchLanguage, otherLocale } from "../language";
import { ui } from "../i18n/ui";
import { FONTS, SCALE } from "../type";
import { useLayout } from "../layout";
import type { AudioPack, Lecture } from "../packs";
import {
  clock,
  getLectures,
  lectureAllowed,
  listenedFraction,
  awaitingReview,
  decideTask,
  waveformOf,
} from "../lectures";
import { candidatesOf, tasksOf, taskSummary, type SourcedTask } from "../tasks";
import { insightsFrom, type Insight } from "../insights";
import { Shell, useContentPad } from "./Shell";
import {
  Card,
  Button,
  Chip,
  ProgressBar,
  Waveform,
  SectionTitle,
  EmptyState,
  Meta,
} from "./kit";
import {
  GOLD,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  STATE,
  SP,
  READ,
  HAIRLINE,
  audio as s,
} from "./audio-theme";

/**
 * Mahdar's home screen.
 *
 * Not a dashboard. A student opens this in the ninety seconds before a
 * lecture starts, or on the bus afterwards, and in both cases there is
 * exactly one thing they want. So the screen answers in order: start
 * recording, carry on from where you stopped, here is what is due, here is
 * what I noticed.
 *
 * Everything below the greeting is derived from their own lectures. If they
 * have none, most of this screen simply is not there — an empty widget
 * showing a zero is worse than the honest absence of the widget.
 */
export function AudioHome({ pack }: { pack: AudioPack }) {
  const router = useRouter();
  const layout = useLayout();
  const pad = useContentPad();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    getLectures().then(setLectures);
  }, []);
  useFocusEffect(load);

  const tasks = useMemo(() => tasksOf(lectures), [lectures]);
  const summary = useMemo(() => taskSummary(tasks), [tasks]);
  const candidates = useMemo(() => candidatesOf(lectures), [lectures]);
  const insights = useMemo(() => insightsFrom(lectures), [lectures]);

  /**
   * The lecture to carry on with.
   *
   * Being part-way through something beats everything else — that is a
   * commitment the student already made. Only then does an unfinished
   * analysis or an unread lecture get the slot.
   */
  const resumable = useMemo(() => {
    const listening = lectures
      .filter((l) => l.status === "ready" && (l.playhead ?? 0) > 0)
      .filter((l) => listenedFraction(l) < 0.97)
      .sort((a, b) => (b.playhead ?? 0) - (a.playhead ?? 0))[0];
    if (listening) return listening;
    return lectures.find((l) => l.status === "processing") ?? lectures.find(awaitingReview);
  }, [lectures]);

  const startLecture = async () => {
    if (await lectureAllowed()) router.push("/record");
    else router.push("/paywall");
  };

  const openLecture = (id: string, at?: number, tab?: string) =>
    router.push({ pathname: "/lecture", params: { id, at: at ?? "", tab: tab ?? "" } });

  /** Confirms first: switching language restarts the app, and a restart
   *  nobody expected reads as a crash. */
  const askSwitchLanguage = () => {
    const next = otherLocale();
    Alert.alert(t(ui.language), t(ui.confirmSwitchLanguage), [
      { text: t(ui.home), style: "cancel" },
      { text: next === "ar" ? "العربية" : "English", onPress: () => void switchLanguage(next) },
    ]);
  };

  const decide = async (item: SourcedTask, keep: boolean) => {
    setBusyKey(item.key);
    await decideTask(item.lectureId, item.index, keep);
    load();
    setBusyKey(null);
  };

  const empty = lectures.length === 0;

  return (
    <Shell>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: layout.gutter, paddingBottom: pad },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* The wordmark is the brand and the language switch is the one piece
            of chrome that has to be reachable before anything is recorded. */}
        <View style={styles.top}>
          <View style={s.wordmarkWrap}>
            <Text style={s.wordmarkArabic}>مَحضَر</Text>
            <Text style={s.wordmarkDot}>·</Text>
            <Text style={s.wordmarkLatin}>MAHDAR</Text>
          </View>
          <Pressable
            onPress={askSwitchLanguage}
            style={s.langPill}
            accessibilityRole="button"
            accessibilityLabel={t(ui.language)}
          >
            <Text style={s.langText}>{locale === "ar" ? "EN" : "ع"}</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.greeting}>{t(greetingFor(new Date().getHours()))}</Text>
          <Text style={styles.headline}>
            {empty ? t(ui.letsRecord) : t(ui.readyToContinue)}
          </Text>
        </View>

        <View style={styles.cta}>
          <Button
            label={t(ui.tabRecord)}
            glyph="🎙"
            variant="primary"
            size="lg"
            block
            onPress={startLecture}
          />
          {resumable ? (
            <Button
              label={t(ui.resumeStudy)}
              size="lg"
              block
              onPress={() => openLecture(resumable.id, resumable.playhead)}
            />
          ) : null}
        </View>

        {empty ? (
          <EmptyState
            glyph="◫"
            title={t(ui.emptyLecturesTitle)}
            body={t(ui.noLecturesYet)}
            action={t(ui.tabRecord)}
            onAction={startLecture}
          />
        ) : null}

        {resumable ? (
          <ContinueCard lecture={resumable} onOpen={openLecture} />
        ) : null}

        {!empty ? (
          <Priorities
            summary={summary}
            review={lectures.filter(awaitingReview).length}
            examSignals={insights.filter((i) => i.kind === "examSignal").length}
            onTasks={() => router.push("/tasks")}
          />
        ) : null}

        {candidates.length > 0 ? (
          <View style={styles.block}>
            <SectionTitle>
              {candidates.length === 1 ? t(ui.newTaskFound) : t(ui.newTasksFound)}
            </SectionTitle>
            <View style={styles.stack}>
              {candidates.slice(0, 3).map((item) => (
                <Candidate
                  key={item.key}
                  item={item}
                  busy={busyKey === item.key}
                  onOpen={() => openLecture(item.lectureId, item.task.atSeconds, "transcript")}
                  onDecide={(keep) => void decide(item, keep)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {insights.length > 0 ? (
          <View style={styles.block}>
            <SectionTitle>{t(ui.insights)}</SectionTitle>
            <View style={styles.stack}>
              {insights.map((insight) => (
                <InsightRow
                  key={insight.key}
                  insight={insight}
                  onOpen={openLecture}
                />
              ))}
            </View>
          </View>
        ) : null}

        {lectures.length > 0 ? (
          <View style={styles.block}>
            <SectionTitle action={t(ui.seeAll)} onAction={() => router.push("/lectures")}>
              {t(ui.recentLectures)}
            </SectionTitle>
            <View style={styles.stack}>
              {lectures.slice(0, 4).map((lecture) => (
                <LectureRow
                  key={lecture.id}
                  lecture={lecture}
                  onPress={() => openLecture(lecture.id, lecture.playhead)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <Text style={s.footer}>{t(pack.tagline)}</Text>
      </ScrollView>
    </Shell>
  );
}

/** Morning until noon, afternoon until six, evening after. */
const greetingFor = (hour: number) =>
  hour < 12 ? ui.goodMorning : hour < 18 ? ui.goodAfternoon : ui.goodEvening;

/**
 * The lecture in progress.
 *
 * The most important card on the screen, so it is the only raised one. It
 * carries the shape of the recording and the exact second to come back to,
 * because "42:18 of 1:38:09" is a promise the Resume button then keeps.
 */
function ContinueCard({
  lecture,
  onOpen,
}: {
  lecture: Lecture;
  onOpen: (id: string, at?: number) => void;
}) {
  const bars = useMemo(() => waveformOf(lecture.segments, 56), [lecture.segments]);
  const fraction = listenedFraction(lecture);
  const pending = lecture.status !== "ready";

  return (
    <Card raised style={styles.continue}>
      <View style={styles.continueHead}>
        <Text style={styles.continueLabel}>{t(ui.continueLearning)}</Text>
        {pending ? <Chip label={t(ui.processing)} tone="busy" /> : null}
      </View>

      <Text style={styles.continueTitle} numberOfLines={2}>
        {lecture.title || t(ui.untitledLecture)}
      </Text>
      <Meta>
        {[
          lecture.analysis?.lecturer,
          new Date(lecture.at).toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        ]
          .filter(Boolean)
          .join("  ·  ")}
      </Meta>

      {bars.length > 0 ? (
        <View style={styles.continueWave}>
          <Waveform bars={bars} progress={fraction} height={38} />
        </View>
      ) : null}

      {!pending ? (
        <>
          <View style={styles.continueBar}>
            <ProgressBar value={fraction} label={t(ui.continueLearning)} />
            <Text style={styles.continuePct}>
              {Math.round(fraction * 100)}% {t(ui.percentDone)}
            </Text>
          </View>
          <View style={styles.continueFoot}>
            <Text style={styles.continueClock}>
              {clock(lecture.playhead ?? 0)} / {clock(lecture.duration)}
            </Text>
            <Button
              label={t(ui.resumeStudy)}
              variant="primary"
              size="sm"
              onPress={() => onOpen(lecture.id, lecture.playhead)}
            />
          </View>
        </>
      ) : (
        <Button
          label={t(ui.viewAllMoments)}
          size="sm"
          onPress={() => onOpen(lecture.id)}
          style={styles.continueOpen}
        />
      )}
    </Card>
  );
}

/**
 * Today, in three lines at most.
 *
 * The temptation is to show every count the app can compute. Three is the
 * number a student can act on before their next lecture; the fourth would
 * only be read as noise, and would teach them to skip the card.
 */
function Priorities({
  summary,
  review,
  examSignals,
  onTasks,
}: {
  summary: ReturnType<typeof taskSummary>;
  review: number;
  examSignals: number;
  onTasks: () => void;
}) {
  const dueSoon = summary.overdue + summary.today + summary.soon;
  const lines: { key: string; text: string; tone: keyof typeof STATE }[] = [];

  if (dueSoon > 0) {
    lines.push({
      key: "due",
      text: `${dueSoon} ${dueSoon === 1 ? t(ui.taskDueSoon) : t(ui.tasksDueSoon)}`,
      tone: summary.overdue > 0 ? "danger" : "urgent",
    });
  }
  if (review > 0) {
    lines.push({
      key: "review",
      text: `${review} ${review === 1 ? t(ui.lectureToReview) : t(ui.lecturesToReview)}`,
      tone: "busy",
    });
  }
  if (examSignals > 0) {
    lines.push({
      key: "exam",
      text: `${examSignals} ${t(ui.examSignalsFound)}`,
      tone: "stated",
    });
  }

  return (
    <View style={styles.block}>
      <SectionTitle>{t(ui.todayPriorities)}</SectionTitle>
      <Card onPress={lines.length > 0 ? onTasks : undefined} style={styles.priorities}>
        {lines.length === 0 ? (
          <Text style={styles.quiet}>{t(ui.nothingUrgent)}</Text>
        ) : (
          lines.slice(0, 3).map((line) => (
            <View key={line.key} style={styles.priorityRow}>
              <View style={[styles.dot, { backgroundColor: STATE[line.tone].fg }]} />
              <Text style={styles.priorityText}>{line.text}</Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

/**
 * Something the lecturer said that sounded like work.
 *
 * Offered with its source attached and two honest answers. "Not a task" is a
 * first-class button, not a small grey X, because being able to say no is
 * what makes saying yes mean anything.
 */
function Candidate({
  item,
  busy,
  onOpen,
  onDecide,
}: {
  item: SourcedTask;
  busy: boolean;
  onOpen: () => void;
  onDecide: (keep: boolean) => void;
}) {
  return (
    <Card style={styles.candidate}>
      <Text style={styles.candidateText}>{item.task.text}</Text>

      <Pressable onPress={onOpen} accessibilityRole="button" style={styles.sourceRow}>
        <Text style={styles.sourceLabel}>{t(ui.source)}</Text>
        <Text style={styles.sourceValue} numberOfLines={1}>
          {item.lectureTitle || t(ui.untitledLecture)}
        </Text>
        {typeof item.task.atSeconds === "number" ? (
          <Text style={styles.sourceTime}>{clock(item.task.atSeconds)}</Text>
        ) : null}
      </Pressable>

      <View style={styles.candidateActions}>
        <Button
          label={t(ui.addTask)}
          variant="primary"
          size="sm"
          busy={busy}
          onPress={() => onDecide(true)}
        />
        <Button
          label={t(ui.dismissTask)}
          variant="ghost"
          size="sm"
          disabled={busy}
          onPress={() => onDecide(false)}
        />
      </View>
    </Card>
  );
}

/**
 * One observation, and the way back to what it was observed in.
 *
 * Every branch here ends in a lecture id, and most in a second on the
 * timeline. That is the rule the whole product rests on: nothing the AI says
 * appears without a way to check it.
 */
function InsightRow({
  insight,
  onOpen,
}: {
  insight: Insight;
  onOpen: (id: string, at?: number, tab?: string) => void;
}) {
  const parts = describe(insight);
  return (
    <Card
      onPress={() => onOpen(insight.lectureId, parts.at, parts.tab)}
      accessibilityLabel={parts.text}
      style={styles.insight}
    >
      <Text style={styles.insightGlyph}>{parts.glyph}</Text>
      <View style={styles.insightBody}>
        <Text style={styles.insightText}>{parts.text}</Text>
        {parts.footnote ? <Meta>{parts.footnote}</Meta> : null}
      </View>
    </Card>
  );
}

function describe(insight: Insight): {
  glyph: string;
  text: string;
  footnote?: string;
  at?: number;
  tab?: string;
} {
  switch (insight.kind) {
    case "repeatedTerm":
      return {
        glyph: "◈",
        text: fill(ui.insightRepeated, { term: insight.term, n: insight.lectures }),
        at: insight.atSeconds,
        tab: "concepts",
      };
    case "emphasised":
      return {
        glyph: "▲",
        text: `“${insight.quote}”`,
        footnote: `${insight.lectureTitle}  ·  ${clock(insight.atSeconds)}`,
        at: insight.atSeconds,
        tab: "transcript",
      };
    case "examSignal":
      return {
        glyph: "★",
        text: fill(ui.insightExam, { topic: insight.topic }),
        footnote: insight.lectureTitle,
        at: insight.atSeconds,
        tab: "exam",
      };
    case "newTasks":
      return {
        glyph: "☑",
        text: fill(ui.insightTasks, { n: insight.count }),
        tab: "tasks",
      };
  }
}

/** A lecture at a glance: what it was, when, and how far in you are. */
function LectureRow({ lecture, onPress }: { lecture: Lecture; onPress: () => void }) {
  const fraction = listenedFraction(lecture);
  const pending = lecture.status !== "ready";

  return (
    <Card onPress={onPress} style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {lecture.title || t(ui.untitledLecture)}
        </Text>
        {pending ? (
          <Chip
            label={lecture.status === "failed" ? t(ui.failed) : t(ui.processing)}
            tone={lecture.status === "failed" ? "danger" : "busy"}
          />
        ) : fraction > 0 ? (
          <Text style={styles.rowPct}>{Math.round(fraction * 100)}%</Text>
        ) : null}
      </View>

      <Meta>
        {new Date(lecture.at).toLocaleDateString(locale, { day: "numeric", month: "short" })}
        {"  ·  "}
        {clock(lecture.duration)}
      </Meta>

      {fraction > 0 && !pending ? <ProgressBar value={fraction} height={3} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: SP.md, gap: SP.xl },

  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SP.md },

  hero: { gap: SP.xs, marginTop: SP.md },
  greeting: {
    color: GOLD,
    fontSize: SCALE.label,
    fontFamily: FONTS.bodyMedium,
    letterSpacing: 0.6,
    textAlign: READ,
  },
  headline: {
    color: TEXT,
    fontSize: SCALE.hero,
    lineHeight: SCALE.heroLine,
    fontFamily: FONTS.display,
    textAlign: READ,
  },

  cta: { flexDirection: "row", gap: SP.md },

  block: { gap: 0 },
  stack: { gap: SP.md },

  continue: { gap: SP.md },
  continueHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  continueLabel: {
    color: GOLD,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  continueTitle: {
    color: TEXT,
    fontSize: SCALE.title - 3,
    lineHeight: SCALE.titleLine - 3,
    fontFamily: FONTS.display,
    textAlign: READ,
  },
  continueWave: { marginTop: SP.xs },
  continueBar: { flexDirection: "row", alignItems: "center", gap: SP.md },
  continuePct: { color: TEXT_SOFT, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },
  continueFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SP.md,
    marginTop: SP.xs,
  },
  continueClock: {
    color: TEXT_FAINT,
    fontSize: SCALE.label,
    fontFamily: FONTS.body,
    fontVariant: ["tabular-nums"],
  },
  continueOpen: { alignSelf: READ === "right" ? "flex-end" : "flex-start" },

  priorities: { gap: SP.md, padding: SP.lg },
  priorityRow: { flexDirection: "row", alignItems: "center", gap: SP.md },
  dot: { width: 7, height: 7, borderRadius: 4 },
  priorityText: { flex: 1, color: TEXT, fontSize: SCALE.body, fontFamily: FONTS.body, textAlign: READ },
  quiet: { color: TEXT_FAINT, fontSize: SCALE.body, fontFamily: FONTS.body, textAlign: READ },

  candidate: { gap: SP.md, padding: SP.lg },
  candidateText: {
    color: TEXT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  candidateActions: { flexDirection: "row", gap: SP.sm },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.sm,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: SP.md,
  },
  sourceLabel: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body },
  sourceValue: { flex: 1, color: TEXT_SOFT, fontSize: SCALE.micro, fontFamily: FONTS.body },
  sourceTime: {
    color: GOLD,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    fontVariant: ["tabular-nums"],
  },

  insight: { flexDirection: "row", gap: SP.md, padding: SP.lg, alignItems: "flex-start" },
  insightGlyph: { color: GOLD, fontSize: 15, marginTop: 2 },
  insightBody: { flex: 1, gap: 3 },
  insightText: {
    color: TEXT,
    fontSize: SCALE.label + 1,
    lineHeight: SCALE.labelLine + 7,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  row: { gap: SP.sm, padding: SP.lg },
  rowHead: { flexDirection: "row", alignItems: "center", gap: SP.md },
  rowTitle: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.section,
    lineHeight: SCALE.sectionLine,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },
  rowPct: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },
});
