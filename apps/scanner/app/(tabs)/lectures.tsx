import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { pack, isAudio, type Lecture } from "../../src/packs";
import { t, locale } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import { FONTS, SCALE } from "../../src/type";
import { useLayout } from "../../src/layout";
import {
  GOLD,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  HAIRLINE,
  STATE,
  SP,
  READ,
} from "../../src/components/audio-theme";
import { Shell, useContentPad } from "../../src/components/Shell";
import {
  Card,
  Chip,
  PageTitle,
  ProgressBar,
  SearchField,
  EmptyState,
  Meta,
  Waveform,
} from "../../src/components/kit";
import {
  clock,
  getLectures,
  removeLecture,
  lectureAllowed,
  listenedFraction,
  scoreEnergy,
  transcriptOfSegments,
  waveformOf,
} from "../../src/lectures";
import { normalise } from "../../src/countries";

/**
 * The lecture library, built for finding one again.
 *
 * A student accumulates a semester of these, so the screen is organised
 * around retrieval rather than display: search runs over the transcript as
 * well as the title, because what anyone actually remembers about a lecture
 * is something the lecturer said, not what the file ended up called.
 */
export default function Lectures() {
  const router = useRouter();
  const layout = useLayout();
  const pad = useContentPad();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [query, setQuery] = useState("");

  useFocusEffect(
    useCallback(() => {
      getLectures().then(setLectures);
    }, []),
  );

  const matches = useMemo(() => {
    const q = normalise(query.trim());
    if (!q) return lectures;
    return lectures.filter((lecture) =>
      [
        lecture.title,
        lecture.analysis?.summary ?? "",
        lecture.analysis?.lecturer ?? "",
        transcriptOfSegments(lecture.segments),
        ...(lecture.analysis?.terms ?? []).map((x) => x.term),
      ].some((field) => normalise(field).includes(q)),
    );
  }, [lectures, query]);

  if (!isAudio(pack)) return null;

  const startLecture = async () => {
    if (await lectureAllowed()) router.push("/record");
    else router.push("/paywall");
  };

  /* The same three things the lecture screen removes, through the same
   * function, so the two places that offer delete cannot come to mean
   * different amounts by it. */
  const confirmDelete = (lecture: Lecture) =>
    Alert.alert(t(ui.deleteLecture), t(ui.deleteLectureConfirm), [
      { text: t(ui.cancel), style: "cancel" },
      {
        text: t(ui.deleteLecture),
        style: "destructive",
        onPress: async () => {
          await removeLecture(lecture);
          setLectures(await getLectures());
        },
      },
    ]);

  return (
    <Shell>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: layout.gutter, paddingBottom: pad },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <PageTitle>{t(ui.tabLibrary)}</PageTitle>
          {lectures.length > 0 ? (
            <Meta>
              {lectures.length} {t(ui.lecturesCount)}
            </Meta>
          ) : null}
        </View>

        {lectures.length > 0 ? (
          <Text style={styles.hint}>{t(ui.longPressDeleteLecture)}</Text>
        ) : null}

        {lectures.length > 0 ? (
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t(ui.searchLectures)}
            style={styles.field}
          />
        ) : null}

        {lectures.length === 0 ? (
          <EmptyState
            glyph="◫"
            title={t(ui.emptyLecturesTitle)}
            body={t(ui.noLecturesYet)}
            action={t(ui.tabRecord)}
            onAction={startLecture}
          />
        ) : matches.length === 0 ? (
          <EmptyState glyph="⌕" title={t(ui.noMatch)} />
        ) : (
          <View style={[styles.list, layout.columns > 1 && styles.grid]}>
            {matches.map((lecture) => (
              <LectureCard
                key={lecture.id}
                lecture={lecture}
                wide={layout.columns > 1}
                onPress={() =>
                  router.push({
                    pathname: "/lecture",
                    params: { id: lecture.id, at: lecture.playhead ?? "" },
                  })
                }
                onLongPress={() => confirmDelete(lecture)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Shell>
  );
}

/**
 * One lecture, carrying enough to recognise it at a glance.
 *
 * The counts are what a student is looking for when they scan a semester —
 * which lecture had the assignments, which one flagged the exam — so those
 * are the numbers on the card rather than a file size or a word count.
 */
function LectureCard({
  lecture,
  wide,
  onPress,
  onLongPress,
}: {
  lecture: Lecture;
  wide: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const analysis = lecture.analysis;
  const openTasks = (analysis?.tasks ?? []).length - (lecture.done?.length ?? 0);
  const examSignals = (analysis?.examPredictions ?? []).filter((p) => p.basis === "stated").length;
  const fraction = listenedFraction(lecture);

  const emphasis = useMemo(
    () => scoreEnergy(lecture.segments).filter((seg) => seg.emphasis >= 0.5).length,
    [lecture.segments],
  );
  const bars = useMemo(() => waveformOf(lecture.segments, 40), [lecture.segments]);

  const pending = lecture.status !== "ready";

  return (
    <Card
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.card, wide && styles.cardWide]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {lecture.title || t(ui.untitledLecture)}
        </Text>
        {pending ? (
          <Chip
            label={lecture.status === "failed" ? t(ui.failed) : t(ui.processing)}
            tone={lecture.status === "failed" ? "danger" : "busy"}
          />
        ) : null}
      </View>

      <Meta>
        {[
          analysis?.lecturer,
          new Date(lecture.at).toLocaleDateString(locale, {
            weekday: "short",
            day: "numeric",
            month: "short",
          }),
          clock(lecture.duration),
        ]
          .filter(Boolean)
          .join("  ·  ")}
      </Meta>

      {bars.length > 0 ? <Waveform bars={bars} progress={fraction || undefined} height={22} /> : null}

      {analysis?.summary ? (
        <Text style={styles.cardSummary} numberOfLines={2}>
          {analysis.summary}
        </Text>
      ) : null}

      {fraction > 0 && !pending ? (
        <View style={styles.progress}>
          <ProgressBar value={fraction} height={3} />
          <Text style={styles.progressPct}>{Math.round(fraction * 100)}%</Text>
        </View>
      ) : null}

      {analysis ? (
        <View style={styles.stats}>
          {openTasks > 0 ? <Stat value={openTasks} label={t(ui.tabTasks)} tone="urgent" /> : null}
          {examSignals > 0 ? <Stat value={examSignals} label={t(ui.tabExam)} tone="stated" /> : null}
          {emphasis > 0 ? (
            <Stat value={emphasis} label={t(ui.importantMomentsTitle)} tone="busy" />
          ) : null}
          {analysis.terms.length > 0 ? (
            <Stat value={analysis.terms.length} label={t(ui.tabTerms)} tone="busy" />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: keyof typeof STATE }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: STATE[tone].fg }]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: SP.md, gap: SP.xl },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: SP.md },
  hint: { color: TEXT_FAINT, fontSize: SCALE.label, fontFamily: FONTS.body },
  field: { marginTop: SP.xs },

  list: { gap: SP.md },
  grid: { flexDirection: "row", flexWrap: "wrap" },

  card: { gap: SP.sm, padding: SP.lg },
  /* Two-up on a laptop. minWidth keeps a long Arabic title from collapsing
     the column to the width of one word. */
  cardWide: { flexGrow: 1, flexBasis: "46%", minWidth: 300 },

  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },
  cardTitle: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.section,
    lineHeight: SCALE.sectionLine,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },
  cardSummary: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 4,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  progress: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  progressPct: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },

  stats: {
    flexDirection: "row",
    gap: SP.xl,
    marginTop: SP.xs,
    paddingTop: SP.md,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  stat: { alignItems: "center", gap: 1, minWidth: 44 },
  statValue: { fontSize: SCALE.section, fontFamily: FONTS.displayBold },
  statLabel: { color: TEXT_FAINT, fontSize: SCALE.micro - 0.5, fontFamily: FONTS.body },
});
