import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { pack, isAudio, type Lecture } from "../../src/packs";
import { t } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import { FONTS, SCALE } from "../../src/type";
import { useLayout } from "../../src/layout";
import {
  GOLD,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  STATE,
  SP,
  READ,
} from "../../src/components/audio-theme";
import { Shell, useContentPad } from "../../src/components/Shell";
import { Card, PageTitle, SearchField, EmptyState, Chip } from "../../src/components/kit";
import { clock, getLectures } from "../../src/lectures";
import { normalise } from "../../src/countries";

/**
 * Search across the semester.
 *
 * What a student remembers is a fragment of something that was said, not
 * which lecture it was in — so this searches the transcripts themselves and
 * answers with the line, its lecture, and a way to hear it. A search that
 * only matched titles would be useless for the one thing anyone needs it for.
 *
 * Results are grouped by what kind of thing matched, because "the professor
 * said this" and "this is a concept" are different answers to the same word
 * and a flat list makes the student sort them by hand.
 */

type Kind = "transcript" | "concept" | "task" | "exam";

type Hit = {
  key: string;
  kind: Kind;
  text: string;
  detail?: string;
  atSeconds?: number;
  lectureId: string;
  lectureTitle: string;
};

const KIND_LABEL: Record<Kind, { en: string; ar: string }> = {
  transcript: ui.inTranscript,
  concept: ui.inConcepts,
  task: ui.inTasks,
  exam: ui.tabExam,
};

const KIND_TONE: Record<Kind, keyof typeof STATE> = {
  transcript: "stated",
  concept: "busy",
  task: "urgent",
  exam: "inferred",
};

/** Which tab of the lecture answers this kind of hit. */
const KIND_TAB: Record<Kind, string> = {
  transcript: "transcript",
  concept: "concepts",
  task: "tasks",
  exam: "exam",
};

const ORDER: Kind[] = ["transcript", "concept", "task", "exam"];

/** Bounded so a two-letter query over a semester cannot lock the screen. */
const MAX_HITS = 80;

export default function Search() {
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

  const groups = useMemo(() => {
    const q = normalise(query.trim());
    // Two characters is the floor: below it every lecture matches and the
    // result is noise rather than an answer.
    if (q.length < 2) return [];

    const found: Hit[] = [];
    const push = (hit: Hit) => {
      if (found.length < MAX_HITS) found.push(hit);
    };

    for (const lecture of lectures) {
      const title = lecture.title || t(ui.untitledLecture);
      const analysis = lecture.analysis;

      for (const term of analysis?.terms ?? []) {
        if (normalise(term.term).includes(q) || normalise(term.definition).includes(q)) {
          push({
            key: `c:${lecture.id}:${term.term}`,
            kind: "concept",
            text: term.term,
            detail: term.definition,
            atSeconds: term.atSeconds,
            lectureId: lecture.id,
            lectureTitle: title,
          });
        }
      }

      (analysis?.tasks ?? []).forEach((task, index) => {
        if (normalise(task.text).includes(q)) {
          push({
            key: `t:${lecture.id}:${index}`,
            kind: "task",
            text: task.text,
            detail: task.due,
            atSeconds: task.atSeconds,
            lectureId: lecture.id,
            lectureTitle: title,
          });
        }
      });

      for (const prediction of analysis?.examPredictions ?? []) {
        if (normalise(prediction.topic).includes(q) || normalise(prediction.why).includes(q)) {
          push({
            key: `e:${lecture.id}:${prediction.topic}`,
            kind: "exam",
            text: prediction.topic,
            detail: prediction.quote ?? prediction.why,
            atSeconds: prediction.atSeconds,
            lectureId: lecture.id,
            lectureTitle: title,
          });
        }
      }

      for (const segment of lecture.segments) {
        if (found.length >= MAX_HITS) break;
        if (normalise(segment.text).includes(q)) {
          push({
            key: `s:${lecture.id}:${segment.at}`,
            kind: "transcript",
            text: segment.text,
            atSeconds: segment.at,
            lectureId: lecture.id,
            lectureTitle: title,
          });
        }
      }

      if (found.length >= MAX_HITS) break;
    }

    return ORDER.map((kind) => ({ kind, hits: found.filter((h) => h.kind === kind) })).filter(
      (group) => group.hits.length > 0,
    );
  }, [lectures, query]);

  if (!isAudio(pack)) return null;

  const open = (hit: Hit) =>
    router.push({
      pathname: "/lecture",
      params: { id: hit.lectureId, at: hit.atSeconds ?? "", tab: KIND_TAB[hit.kind] },
    });

  const searched = query.trim().length >= 2;

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
        <PageTitle>{t(ui.tabSearch)}</PageTitle>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t(ui.searchEverything)}
          autoFocus
          style={styles.field}
        />

        {!searched ? (
          <EmptyState glyph="⌕" title={t(ui.emptySearchTitle)} body={t(ui.searchHint)} />
        ) : groups.length === 0 ? (
          <EmptyState glyph="⌕" title={t(ui.noMatch)} />
        ) : (
          groups.map((group) => (
            <View key={group.kind} style={styles.group}>
              <View style={styles.groupHead}>
                <Chip label={t(KIND_LABEL[group.kind])} tone={KIND_TONE[group.kind]} />
                <Text style={styles.groupCount}>{group.hits.length}</Text>
              </View>

              <View style={styles.hits}>
                {group.hits.map((hit) => (
                  <Card key={hit.key} onPress={() => open(hit)} style={styles.hit}>
                    <View style={styles.hitHead}>
                      <Text style={styles.hitLecture} numberOfLines={1}>
                        {hit.lectureTitle}
                      </Text>
                      {typeof hit.atSeconds === "number" ? (
                        <Text style={styles.hitTime}>{clock(hit.atSeconds)}</Text>
                      ) : null}
                    </View>

                    <Text style={styles.hitText} numberOfLines={3}>
                      {hit.text}
                    </Text>
                    {hit.detail ? (
                      <Text style={styles.hitDetail} numberOfLines={2}>
                        {hit.detail}
                      </Text>
                    ) : null}
                  </Card>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Shell>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: SP.md, gap: SP.xl },
  field: { marginTop: SP.xs },

  group: { gap: SP.md },
  groupHead: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  groupCount: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body },

  hits: { gap: SP.sm },
  hit: { gap: 6, padding: SP.lg },
  hitHead: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  hitLecture: { flex: 1, color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body },
  hitTime: {
    color: GOLD,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    fontVariant: ["tabular-nums"],
  },
  hitText: {
    color: TEXT,
    fontSize: SCALE.label + 0.5,
    lineHeight: SCALE.labelLine + 5,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  hitDetail: {
    color: TEXT_SOFT,
    fontSize: SCALE.micro,
    lineHeight: SCALE.labelLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
});
