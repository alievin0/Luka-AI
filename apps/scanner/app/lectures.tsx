import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { pack, isAudio, type Lecture } from "../src/packs";
import { t, locale } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { FONTS, SCALE } from "../src/type";
import {
  GOLD,
  BLOOM,
  PANEL_GRADIENT,
  PANEL_BORDER,
  HAIRLINE,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  STATE,
  SP,
  RADIUS,
  READ,
  lift,
  audio as s,
} from "../src/components/audio-theme";
import { TabBar, TAB_CLEARANCE } from "../src/components/TabBar";
import {
  clock,
  getLectures,
  lectureAllowed,
  scoreEnergy,
  transcriptOfSegments,
} from "../src/lectures";
import { normalise } from "../src/countries";

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
        transcriptOfSegments(lecture.segments),
        ...(lecture.analysis?.terms ?? []).map((x) => x.term),
      ].some((field) => normalise(field).includes(q)),
    );
  }, [lectures, query]);

  if (!isAudio(pack)) return null;

  return (
    <View style={s.root}>
      <LinearGradient colors={BLOOM} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={s.safe} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.head}>
            <Text style={styles.title}>{t(ui.tabLibrary)}</Text>
            {lectures.length > 0 ? (
              <Text style={styles.headCount}>
                {lectures.length} {t(ui.lecturesCount)}
              </Text>
            ) : null}
          </View>

          {lectures.length > 0 ? (
            <View style={styles.search}>
              <Text style={styles.searchGlyph}>⌕</Text>
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={t(ui.searchLectures)}
                placeholderTextColor={TEXT_FAINT}
                autoCorrect={false}
                textAlign={READ}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery("")} hitSlop={10}>
                  <Text style={styles.searchClear}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {lectures.length === 0 ? (
            <Empty body={t(ui.noLecturesYet)} glyph="◫" />
          ) : matches.length === 0 ? (
            <Empty body={t(ui.noMatch)} glyph="⌕" />
          ) : (
            <View style={styles.list}>
              {matches.map((lecture) => (
                <LectureCard
                  key={lecture.id}
                  lecture={lecture}
                  onPress={() =>
                    router.push({ pathname: "/lecture", params: { id: lecture.id } })
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <TabBar
        onRecord={async () => {
          if (await lectureAllowed()) router.push("/record");
          else router.push("/paywall");
        }}
      />
    </View>
  );
}

function Empty({ body, glyph }: { body: string; glyph: string }) {
  return (
    <View style={[styles.empty, lift]}>
      <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />
      <Text style={styles.emptyGlyph}>{glyph}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

/**
 * One lecture, carrying enough to recognise it at a glance.
 *
 * The counts are what a student is looking for when they scan a semester —
 * which lecture had the assignments, which one flagged the exam — so those
 * are the numbers on the card rather than a file size or a word count.
 */
function LectureCard({ lecture, onPress }: { lecture: Lecture; onPress: () => void }) {
  const analysis = lecture.analysis;
  const openTasks = (analysis?.tasks ?? []).length - (lecture.done?.length ?? 0);
  const examSignals = (analysis?.examPredictions ?? []).filter((p) => p.basis === "stated").length;

  const emphasis = useMemo(() => {
    const scored = scoreEnergy(lecture.segments).filter((seg) => seg.emphasis >= 0.5);
    return scored.length;
  }, [lecture.segments]);

  const pending = lecture.status !== "ready";

  return (
    <Pressable style={({ pressed }) => [styles.card, lift, pressed && s.pressed]} onPress={onPress}>
      <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />

      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {lecture.title || t(ui.untitledLecture)}
        </Text>
        {pending ? (
          <View
            style={[
              styles.statePill,
              { backgroundColor: STATE[lecture.status === "failed" ? "danger" : "busy"].bg },
            ]}
          >
            <Text
              style={[
                styles.stateText,
                { color: STATE[lecture.status === "failed" ? "danger" : "busy"].fg },
              ]}
            >
              {lecture.status === "failed" ? t(ui.failed) : t(ui.processing)}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.cardMeta}>
        {new Date(lecture.at).toLocaleDateString(locale, {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}
        {"  ·  "}
        {clock(lecture.duration)}
      </Text>

      {analysis?.summary ? (
        <Text style={styles.cardSummary} numberOfLines={2}>
          {analysis.summary}
        </Text>
      ) : null}

      {analysis ? (
        <View style={styles.stats}>
          {openTasks > 0 ? (
            <Stat value={openTasks} label={t(ui.tabTasks)} tone="urgent" />
          ) : null}
          {examSignals > 0 ? (
            <Stat value={examSignals} label={t(ui.tabExam)} tone="stated" />
          ) : null}
          {emphasis > 0 ? <Stat value={emphasis} label={t(ui.tabTone)} tone="busy" /> : null}
          {analysis.terms.length > 0 ? (
            <Stat value={analysis.terms.length} label={t(ui.tabTerms)} tone="busy" />
          ) : null}
        </View>
      ) : null}
    </Pressable>
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
  content: {
    paddingHorizontal: SP.xl,
    paddingTop: SP.md,
    paddingBottom: TAB_CLEARANCE + SP.xl,
  },

  head: { flexDirection: "row", alignItems: "baseline", gap: SP.md, marginBottom: SP.lg },
  title: { color: TEXT, fontSize: SCALE.title, fontFamily: FONTS.display, textAlign: READ },
  headCount: { color: TEXT_FAINT, fontSize: SCALE.label, fontFamily: FONTS.body },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    backgroundColor: "rgba(26,22,15,0.85)",
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.lg,
    paddingVertical: 4,
    marginBottom: SP.xl,
  },
  searchGlyph: { color: TEXT_FAINT, fontSize: 17 },
  searchInput: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.body,
    fontFamily: FONTS.body,
    paddingVertical: SP.md,
  },
  searchClear: { color: TEXT_FAINT, fontSize: 15 },

  list: { gap: SP.md },
  card: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.lg,
    padding: SP.lg,
    gap: 7,
    overflow: "hidden",
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },
  cardTitle: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.section,
    lineHeight: SCALE.sectionLine,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },
  cardMeta: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body, textAlign: READ },
  cardSummary: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 3,
    fontFamily: FONTS.body,
    textAlign: READ,
    marginTop: 2,
  },

  stats: {
    flexDirection: "row",
    gap: SP.lg,
    marginTop: SP.sm,
    paddingTop: SP.md,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  stat: { alignItems: "center", gap: 1, minWidth: 44 },
  statValue: { fontSize: SCALE.section, fontFamily: FONTS.displayBold },
  statLabel: { color: TEXT_FAINT, fontSize: SCALE.micro - 0.5, fontFamily: FONTS.body },

  statePill: { borderRadius: RADIUS.pill, paddingVertical: 4, paddingHorizontal: 10 },
  stateText: { fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },

  empty: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.xl,
    paddingVertical: 44,
    paddingHorizontal: SP.xl,
    alignItems: "center",
    gap: SP.lg,
    overflow: "hidden",
  },
  emptyGlyph: { color: "#3A3426", fontSize: 34 },
  emptyBody: {
    color: TEXT_FAINT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 6,
    textAlign: "center",
    fontFamily: FONTS.body,
    maxWidth: 280,
  },
});
