import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { pack, isAudio } from "../../src/packs";
import { t } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import { FONTS, SCALE } from "../../src/type";
import { useLayout } from "../../src/layout";
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
} from "../../src/components/audio-theme";
import { Shell, useContentPad } from "../../src/components/Shell";
import { Card, Button, Chip, PageTitle, SectionTitle, Tabs, EmptyState, Meta } from "../../src/components/kit";
import { clock, decideTask, getLectures, updateLecture } from "../../src/lectures";
import {
  bucketOf,
  candidatesOf,
  groupTasks,
  tasksOf,
  type SourcedTask,
  type TaskBucket,
} from "../../src/tasks";

/**
 * Everything the lecturers asked for, in one place.
 *
 * A deadline list on its own is a to-do app, and the student already has one.
 * What this has that a to-do app cannot is where each item came from: the
 * lecture, the second it was said, and the lecturer's own words. Tapping a
 * task plays that moment back.
 *
 * Above the list sit the things nobody has ruled on yet. They are kept
 * separate on purpose — a suggestion mixed in with accepted work is how a
 * planning tool quietly stops being trustworthy.
 */

const BUCKET_LABEL: Record<TaskBucket, { text: typeof ui.overdue; state: keyof typeof STATE }> = {
  overdue: { text: ui.overdue, state: "danger" },
  today: { text: ui.dueToday, state: "urgent" },
  soon: { text: ui.dueSoon, state: "busy" },
  later: { text: ui.dueLater, state: "busy" },
  undated: { text: ui.noDeadline, state: "busy" },
  done: { text: ui.completed2, state: "done" },
};

type Filter = "all" | "soon" | "done";

const FILTERS: { key: Filter; label: typeof ui.filterAll }[] = [
  { key: "all", label: ui.filterAll },
  { key: "soon", label: ui.filterDueSoon },
  { key: "done", label: ui.filterDone },
];

/** Buckets that count as "due soon" — the horizon anyone actually plans on. */
const SOON: TaskBucket[] = ["overdue", "today", "soon"];

export default function Tasks() {
  const router = useRouter();
  const layout = useLayout();
  const pad = useContentPad();
  const [tasks, setTasks] = useState<SourcedTask[]>([]);
  const [candidates, setCandidates] = useState<SourcedTask[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    getLectures().then((lectures) => {
      setTasks(tasksOf(lectures));
      setCandidates(candidatesOf(lectures));
    });
  }, []);

  useFocusEffect(load);

  const shown = useMemo(() => {
    if (filter === "done") return tasks.filter((task) => task.done);
    if (filter === "soon")
      return tasks.filter((task) => !task.done && SOON.includes(bucketOf(task)));
    return tasks;
  }, [tasks, filter]);

  if (!isAudio(pack)) return null;

  /** Ticking writes to the lecture the task belongs to, since that is where
   *  `done` lives — the list here is a view over the lectures, not a store. */
  const toggle = async (item: SourcedTask) => {
    Haptics.selectionAsync();
    setTasks((prev) => prev.map((x) => (x.key === item.key ? { ...x, done: !x.done } : x)));
    const lectures = await getLectures();
    const lecture = lectures.find((l) => l.id === item.lectureId);
    if (!lecture) return;
    const done = new Set(lecture.done ?? []);
    if (done.has(item.index)) done.delete(item.index);
    else done.add(item.index);
    await updateLecture(item.lectureId, { done: [...done] });
  };

  const decide = async (item: SourcedTask, keep: boolean) => {
    setBusyKey(item.key);
    await decideTask(item.lectureId, item.index, keep);
    load();
    setBusyKey(null);
  };

  const openSource = (item: SourcedTask, tab = "tasks") =>
    router.push({
      pathname: "/lecture",
      params: {
        id: item.lectureId,
        // Opening from a task lands on the moment it was set rather than the
        // top of a ninety-minute lecture.
        at: item.task.atSeconds ?? "",
        tab,
      },
    });

  const groups = groupTasks(shown);
  const open = tasks.filter((task) => !task.done).length;

  return (
    <Shell>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: layout.gutter, paddingBottom: pad },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <PageTitle>{t(ui.navTasks)}</PageTitle>
          {tasks.length > 0 ? (
            <Meta>
              {open} {t(ui.openTasks)}
            </Meta>
          ) : null}
        </View>

        {candidates.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>
              {candidates.length === 1 ? t(ui.newTaskFound) : t(ui.newTasksFound)}
            </SectionTitle>
            <View style={styles.list}>
              {candidates.map((item) => (
                <Card key={item.key} style={styles.candidate}>
                  <Text style={styles.taskText}>{item.task.text}</Text>
                  <Pressable
                    style={styles.sourceRow}
                    onPress={() => openSource(item, "transcript")}
                    accessibilityRole="button"
                  >
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
                      busy={busyKey === item.key}
                      onPress={() => void decide(item, true)}
                    />
                    <Button
                      label={t(ui.dismissTask)}
                      variant="ghost"
                      size="sm"
                      disabled={busyKey === item.key}
                      onPress={() => void decide(item, false)}
                    />
                  </View>
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        {tasks.length > 0 ? (
          <Tabs
            items={FILTERS.map((f) => ({ key: f.key, label: t(f.label) }))}
            value={filter}
            onChange={setFilter}
          />
        ) : null}

        {tasks.length === 0 ? (
          candidates.length === 0 ? (
            <EmptyState glyph="◪" title={t(ui.emptyTasksTitle)} body={t(ui.emptyTasksBody)} />
          ) : null
        ) : shown.length === 0 ? (
          <EmptyState glyph="◪" title={t(ui.emptyTasksTitle)} />
        ) : (
          groups.map((group) => (
            <View key={group.bucket} style={styles.section}>
              <View style={styles.groupHead}>
                <View
                  style={[
                    styles.groupDot,
                    { backgroundColor: STATE[BUCKET_LABEL[group.bucket].state].fg },
                  ]}
                />
                <Text style={styles.groupLabel}>{t(BUCKET_LABEL[group.bucket].text)}</Text>
                <View style={styles.groupRule} />
                <Text style={styles.groupCount}>{group.tasks.length}</Text>
              </View>

              <View style={styles.list}>
                {group.tasks.map((item) => (
                  <TaskCard
                    key={item.key}
                    item={item}
                    onToggle={() => void toggle(item)}
                    onOpen={() => openSource(item)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Shell>
  );
}

/**
 * One task, with its origin attached.
 *
 * The quotation is the point: it is the lecturer's own words, verified
 * against the transcript before it ever reaches here, so a student can see
 * exactly what was said rather than trusting a paraphrase.
 */
function TaskCard({
  item,
  onToggle,
  onOpen,
}: {
  item: SourcedTask;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { task } = item;
  const hasSource = typeof task.atSeconds === "number";

  return (
    <Card style={[styles.card, item.done && styles.cardDone]}>
      <View style={styles.cardTop}>
        <Pressable
          onPress={onToggle}
          hitSlop={12}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          accessibilityLabel={task.text}
          style={[styles.check, item.done && styles.checkOn]}
        >
          {item.done ? <Text style={styles.checkGlyph}>✓</Text> : null}
        </Pressable>

        <Pressable style={styles.cardBody} onPress={onOpen} accessibilityRole="button">
          <Text style={[styles.taskText, item.done && styles.taskTextDone]}>{task.text}</Text>

          <View style={styles.metaRow}>
            <Text style={styles.source} numberOfLines={1}>
              {t(ui.fromLecture)} {item.lectureTitle || t(ui.untitledLecture)}
            </Text>
            {task.due ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.due}>{task.due}</Text>
              </>
            ) : null}
          </View>

          {/* A deadline the model worked out is labelled as such — a student
              planning a week has to know which of their dates are real. */}
          {task.dueISO && task.dueIsExplicit === false ? (
            <Text style={styles.inferredNote}>{t(ui.deadlineInferred)}</Text>
          ) : null}
        </Pressable>

        {task.difficulty ? (
          <Chip
            label={t(
              task.difficulty === "easy" ? ui.easy : task.difficulty === "hard" ? ui.hard : ui.medium,
            )}
            gold
          />
        ) : null}
      </View>

      {task.quote ? (
        <Pressable style={styles.quote} onPress={onOpen} accessibilityRole="button">
          <View style={styles.quoteBar} />
          <View style={styles.quoteBody}>
            <Text style={styles.quoteText}>“{task.quote}”</Text>
            {hasSource ? (
              <Text style={styles.quoteMeta}>
                ▶ {t(ui.saidAt)} {clock(task.atSeconds!)}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ) : hasSource ? (
        <Pressable style={styles.jump} onPress={onOpen} accessibilityRole="button">
          <Text style={styles.jumpText}>
            ▶ {t(ui.mentionedAt)} {clock(task.atSeconds!)}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: SP.md, gap: SP.xl },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: SP.md },

  section: { gap: SP.md },
  list: { gap: SP.md },

  groupHead: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  groupDot: { width: 7, height: 7, borderRadius: 4 },
  groupLabel: { color: TEXT_SOFT, fontSize: SCALE.label, fontFamily: FONTS.bodyMedium },
  groupRule: { flex: 1, height: 1, backgroundColor: HAIRLINE },
  groupCount: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body },

  card: { gap: SP.md, padding: SP.lg },
  cardDone: { opacity: 0.55 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },
  cardBody: { flex: 1, gap: SP.xs },

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
  taskTextDone: { color: TEXT_FAINT, textDecorationLine: "line-through" },

  metaRow: { flexDirection: "row", alignItems: "center", gap: SP.sm, flexWrap: "wrap" },
  source: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body },
  metaDot: { color: TEXT_FAINT, fontSize: SCALE.micro },
  due: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },
  inferredNote: { color: STATE.inferred.fg, fontSize: SCALE.micro, fontFamily: FONTS.body },

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

  jump: { paddingTop: 2 },
  jumpText: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium, textAlign: READ },

  candidate: { gap: SP.md, padding: SP.lg },
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
});
