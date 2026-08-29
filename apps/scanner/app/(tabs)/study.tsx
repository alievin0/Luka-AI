import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { pack, isAudio, type Lecture } from "../../src/packs";
import { t, fill } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import { FONTS, SCALE } from "../../src/type";
import { useLayout, MAX_READING } from "../../src/layout";
import {
  GOLD,
  INK,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  HAIRLINE,
  PANEL_BORDER,
  WELL,
  STATE,
  SP,
  RADIUS,
  READ,
} from "../../src/components/audio-theme";
import { Shell, useContentPad } from "../../src/components/Shell";
import { Card, Chip, PageTitle, EmptyState, LoadingState, ErrorState, Meta } from "../../src/components/kit";
import { clock, getLectures } from "../../src/lectures";
import { contextFor, suggestionsFor } from "../../src/study";
import {
  askLectures,
  lectureErrorText,
  type StudyAnswer,
} from "../../src/lecture-api";
import { activePackId } from "../../src/packs";

/**
 * Ask Mahdar.
 *
 * Not a chat window that happens to be in a study app. The only thing it can
 * draw on is what the student recorded, the evidence is picked on the device
 * before the question is sent, and every answer arrives with the lectures and
 * seconds it was built from. An answer with nothing to cite is reported as
 * "your lectures do not cover this" rather than dressed up as knowledge.
 *
 * That constraint is the product. A general assistant is a tab away in any
 * browser; the thing nobody else can offer is an answer in the lecturer's own
 * words, with a way to go and hear them.
 */

type Turn =
  | { role: "you"; text: string }
  | { role: "mahdar"; answer: StudyAnswer }
  | { role: "error"; text: string };

export default function Study() {
  const router = useRouter();
  const layout = useLayout();
  const pad = useContentPad();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const scroller = useRef<ScrollView>(null);
  /** A question handed over from a transcript line. Asked once, so returning
   *  to this screen does not re-run it and spend another call. */
  const { q } = useLocalSearchParams<{ q?: string }>();
  const seeded = useRef(false);

  useFocusEffect(
    useCallback(() => {
      getLectures().then(setLectures);
    }, []),
  );

  const ready = useMemo(
    () => lectures.filter((lecture) => lecture.status === "ready" && lecture.analysis),
    [lectures],
  );
  const suggestions = useMemo(() => suggestionsFor(ready), [ready]);

  const titleOf = (id: string) =>
    lectures.find((lecture) => lecture.id === id)?.title || t(ui.untitledLecture);

  /** Guards the in-flight call without making `ask` depend on state that
   *  changes on every keystroke — a fresh identity each render would re-fire
   *  the seeded question effect. */
  const inFlight = useRef(false);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || inFlight.current) return;

      inFlight.current = true;
      setQuestion("");
      setTurns((prev) => [...prev, { role: "you", text: trimmed }]);
      setAsking(true);
      // Let the new turn lay out before scrolling to it.
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

      try {
        const { excerpts, overview } = contextFor(trimmed, ready);
        const answer = await askLectures({
          packId: activePackId,
          question: trimmed,
          excerpts,
          overview,
        });
        setTurns((prev) => [...prev, { role: "mahdar", answer }]);
      } catch (caught) {
        setTurns((prev) => [
          ...prev,
          {
            role: "error",
            text: lectureErrorText(caught, ui.askFailed),
          },
        ]);
      } finally {
        inFlight.current = false;
        setAsking(false);
        requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
      }
    },
    [ready],
  );

  /* A question handed over from a transcript line runs itself, once the
   * lectures it needs to search are loaded. */
  useEffect(() => {
    if (seeded.current || !q || ready.length === 0) return;
    seeded.current = true;
    void ask(String(q));
  }, [q, ready.length, ask]);

  if (!isAudio(pack)) return null;

  const openSource = (lectureId: string, atSeconds?: number) =>
    router.push({
      pathname: "/lecture",
      params: { id: lectureId, at: atSeconds ?? "", tab: "transcript" },
    });

  return (
    <Shell>
      <View style={styles.frame}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: layout.gutter, paddingBottom: SP.lg },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PageTitle>{t(ui.aiStudy)}</PageTitle>

          {ready.length === 0 ? (
            <EmptyState
              glyph="✦"
              title={t(ui.askAboutLectures)}
              body={t(ui.askNeedsLectures)}
              action={t(ui.tabRecord)}
              onAction={() => router.push("/record")}
            />
          ) : turns.length === 0 ? (
            <View style={styles.opening}>
              <Text style={styles.openingBody}>{t(ui.askAboutLectures)}</Text>
              <View style={styles.suggestions}>
                {suggestions.map((term) => {
                  const prompt = fill(ui.askSuggestion, { term });
                  return (
                    <Pressable
                      key={term}
                      onPress={() => void ask(prompt)}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.85 }]}
                    >
                      <Text style={styles.suggestionText}>{prompt}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {turns.map((turn, index) =>
            turn.role === "you" ? (
              <View key={index} style={styles.you}>
                <Text style={styles.youText}>{turn.text}</Text>
              </View>
            ) : turn.role === "error" ? (
              <ErrorState key={index} title={t(ui.askFailed)} body={turn.text} />
            ) : (
              <Answer
                key={index}
                answer={turn.answer}
                titleOf={titleOf}
                onOpen={openSource}
              />
            ),
          )}

          {asking ? (
            <LoadingState
              steps={[
                { label: t(ui.askThinking), state: "active" },
                { label: t(ui.foundIn), state: "waiting" },
              ]}
            />
          ) : null}
        </ScrollView>

        {ready.length > 0 ? (
          <View style={[styles.composer, { paddingHorizontal: layout.gutter, paddingBottom: pad }]}>
            <View style={styles.field}>
              <TextInput
                style={styles.input}
                value={question}
                onChangeText={setQuestion}
                placeholder={t(ui.askPlaceholder)}
                placeholderTextColor={TEXT_FAINT}
                textAlign={READ}
                multiline
                returnKeyType="send"
                onSubmitEditing={() => void ask(question)}
                accessibilityLabel={t(ui.askAboutLectures)}
              />
              <Pressable
                onPress={() => void ask(question)}
                disabled={asking || question.trim().length === 0}
                accessibilityRole="button"
                accessibilityLabel={t(ui.aiStudy)}
                style={({ pressed }) => [
                  styles.send,
                  (asking || question.trim().length === 0) && { opacity: 0.4 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={styles.sendGlyph}>↑</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Shell>
  );
}

/**
 * One answer, with everything it was built from.
 *
 * The citations are not a footnote — they are the reason to believe the
 * paragraph above them, so they are as tappable and as prominent as the
 * answer itself.
 */
function Answer({
  answer,
  titleOf,
  onOpen,
}: {
  answer: StudyAnswer;
  titleOf: (id: string) => string;
  onOpen: (lectureId: string, atSeconds?: number) => void;
}) {
  if (!answer.answered || !answer.answer.trim()) {
    return (
      <Card style={styles.answer}>
        <Text style={styles.unanswered}>{t(ui.askNoAnswer)}</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.answer}>
      <Text style={styles.answerText}>{answer.answer}</Text>

      {answer.citations.length > 0 ? (
        <View style={styles.sources}>
          <Text style={styles.sourcesHead}>{t(ui.foundIn)}</Text>
          {answer.citations.map((citation, index) => (
            <Pressable
              key={`${citation.lectureId}:${citation.atSeconds ?? index}`}
              style={styles.citation}
              onPress={() => onOpen(citation.lectureId, citation.atSeconds)}
              accessibilityRole="button"
              accessibilityLabel={`${titleOf(citation.lectureId)} ${
                typeof citation.atSeconds === "number" ? clock(citation.atSeconds) : ""
              }`}
            >
              <View style={styles.citationBar} />
              <View style={styles.citationBody}>
                <View style={styles.citationHead}>
                  <Text style={styles.citationLecture} numberOfLines={1}>
                    {titleOf(citation.lectureId)}
                  </Text>
                  {typeof citation.atSeconds === "number" ? (
                    <Text style={styles.citationTime}>{clock(citation.atSeconds)}</Text>
                  ) : null}
                </View>
                {citation.quote ? (
                  <Text style={styles.citationQuote}>“{citation.quote}”</Text>
                ) : null}
                <Text style={styles.citationJump}>▶ {t(ui.jumpToSource)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  content: { paddingTop: SP.md, gap: SP.lg, maxWidth: MAX_READING, width: "100%" },

  opening: { gap: SP.md },
  openingBody: {
    color: TEXT_SOFT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  suggestions: { gap: SP.sm },
  suggestion: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.md,
    paddingVertical: SP.md,
    paddingHorizontal: SP.lg,
  },
  suggestionText: {
    color: TEXT,
    fontSize: SCALE.label + 1,
    lineHeight: SCALE.labelLine + 6,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  /* The student's own words sit tight to the reading edge and unadorned —
     they are the question, not a message in a chat app. */
  you: { alignSelf: READ === "right" ? "flex-start" : "flex-end", maxWidth: "88%" },
  youText: {
    color: GOLD,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },

  answer: { gap: SP.md },
  answerText: {
    color: TEXT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine + 2,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  unanswered: {
    color: TEXT_FAINT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  sources: { gap: SP.md, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: SP.md },
  sourcesHead: {
    color: TEXT_FAINT,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    letterSpacing: 0.8,
    textAlign: READ,
  },
  citation: { flexDirection: "row", gap: SP.md, alignItems: "stretch" },
  citationBar: { width: 2, borderRadius: 1, backgroundColor: STATE.stated.line },
  citationBody: { flex: 1, gap: 3 },
  citationHead: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  citationLecture: { flex: 1, color: TEXT_SOFT, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },
  citationTime: {
    color: GOLD,
    fontSize: SCALE.micro,
    fontFamily: FONTS.bodyMedium,
    fontVariant: ["tabular-nums"],
  },
  citationQuote: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 5,
    fontFamily: FONTS.body,
    fontStyle: "italic",
    textAlign: READ,
  },
  citationJump: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium, textAlign: READ },

  composer: { paddingTop: SP.sm },
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: SP.sm,
    backgroundColor: WELL,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    maxWidth: MAX_READING,
    width: "100%",
  },
  input: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    paddingVertical: SP.sm,
    maxHeight: 120,
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  sendGlyph: { color: INK, fontSize: 16, fontFamily: FONTS.displayBold },
});
