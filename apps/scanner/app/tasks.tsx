import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { pack, isAudio } from "../src/packs";
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
  READ_END,
  lift,
  audio as s,
} from "../src/components/audio-theme";
import { TabBar, TAB_CLEARANCE } from "../src/components/TabBar";
import { clock, getLectures, lectureAllowed, updateLecture } from "../src/lectures";
import { groupTasks, tasksOf, type SourcedTask, type TaskBucket } from "../src/tasks";

/**
 * Everything the lecturers asked for, in one place.
 *
 * A deadline list on its own is a to-do app, and the student already has one.
 * What this has that a to-do app cannot is where each item came from: the
 * lecture, the second it was said, and the lecturer's own words. Tapping a
 * task plays that moment back.
 */

const BUCKET_LABEL: Record<TaskBucket, { text: typeof ui.overdue; state: keyof typeof STATE }> = {
  overdue: { text: ui.overdue, state: "danger" },
  today: { text: ui.dueToday, state: "urgent" },
  soon: { text: ui.dueSoon, state: "busy" },
  later: { text: ui.dueLater, state: "busy" },
  undated: { text: ui.noDeadline, state: "busy" },
  done: { text: ui.completed2, state: "done" },
};

export default function Tasks() {
  const router = useRouter();
  const [tasks, setTasks] = useState<SourcedTask[]>([]);

  const load = useCallback(() => {
    getLectures().then((lectures) => setTasks(tasksOf(lectures)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!isAudio(pack)) return null;

  /** Ticking writes to the lecture the task belongs to, since that is where
   *  `done` lives — the list here is a view over the lectures, not a store. */
  const toggle = async (item: SourcedTask) => {
    Haptics.selectionAsync();
    setTasks((prev) =>
      prev.map((x) => (x.key === item.key ? { ...x, done: !x.done } : x)),
    );
    const lectures = await getLectures();
    const lecture = lectures.find((l) => l.id === item.lectureId);
    if (!lecture) return;
    const done = new Set(lecture.done ?? []);
    if (done.has(item.index)) done.delete(item.index);
    else done.add(item.index);
    await updateLecture(item.lectureId, { done: [...done] });
  };

  const groups = groupTasks(tasks);
  const open = tasks.filter((task) => !task.done).length;

  return (
    <View style={s.root}>
      <LinearGradient colors={BLOOM} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={s.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Text style={styles.title}>{t(ui.navTasks)}</Text>
            {tasks.length > 0 ? (
              <Text style={styles.headCount}>
                {open} {t(ui.openTasks)}
              </Text>
            ) : null}
          </View>

          {tasks.length === 0 ? (
            <View style={[styles.empty, lift]}>
              <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />
              <Text style={styles.emptyGlyph}>◪</Text>
              <Text style={styles.emptyBody}>{t(ui.noTasksYet)}</Text>
            </View>
          ) : (
            groups.map((group) => (
              <View key={group.bucket} style={styles.group}>
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

                {group.tasks.map((item) => (
                  <TaskCard
                    key={item.key}
                    item={item}
                    onToggle={() => toggle(item)}
                    onOpen={() =>
                      router.push({
                        pathname: "/lecture",
                        params: {
                          id: item.lectureId,
                          // Opening from a task lands on the moment it was set
                          // rather than the top of a ninety-minute lecture.
                          at: item.task.atSeconds ?? "",
                          tab: "tasks",
                        },
                      })
                    }
                  />
                ))}
              </View>
            ))
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
    <View style={[styles.card, lift, item.done && styles.cardDone]}>
      <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />

      <View style={styles.cardTop}>
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          style={[styles.check, item.done && styles.checkOn]}
        >
          {item.done ? <Text style={styles.checkGlyph}>✓</Text> : null}
        </Pressable>

        <Pressable style={styles.cardBody} onPress={onOpen}>
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
      </View>

      {task.quote ? (
        <Pressable style={styles.quote} onPress={onOpen}>
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
        <Pressable style={styles.jump} onPress={onOpen}>
          <Text style={styles.jumpText}>
            ▶ {t(ui.jumpToMoment)} · {clock(task.atSeconds!)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SP.xl,
    paddingTop: SP.md,
    paddingBottom: TAB_CLEARANCE + SP.xl,
  },

  head: { flexDirection: "row", alignItems: "baseline", gap: SP.md, marginBottom: SP.xl },
  title: { color: TEXT, fontSize: SCALE.title, fontFamily: FONTS.display, textAlign: READ },
  headCount: { color: TEXT_FAINT, fontSize: SCALE.label, fontFamily: FONTS.body },

  group: { marginBottom: SP.xxl, gap: SP.md },
  groupHead: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  groupLabel: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    fontFamily: FONTS.bodyMedium,
    letterSpacing: 0.4,
  },
  groupRule: { flex: 1, height: 1, backgroundColor: HAIRLINE },
  groupCount: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },

  card: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.lg,
    padding: SP.lg,
    gap: SP.md,
    overflow: "hidden",
  },
  cardDone: { opacity: 0.55 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },

  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#443C29",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkOn: { backgroundColor: GOLD, borderColor: GOLD },
  checkGlyph: { color: "#17130A", fontSize: 12, fontFamily: FONTS.displayBold },

  cardBody: { flex: 1, gap: 5 },
  taskText: {
    color: TEXT,
    fontSize: SCALE.body + 1,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },
  taskTextDone: { color: TEXT_FAINT, textDecorationLine: "line-through" },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  source: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body, flexShrink: 1 },
  metaDot: { color: "#3F3928", fontSize: SCALE.micro },
  due: { color: STATE.urgent.fg, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },
  inferredNote: { color: STATE.inferred.fg, fontSize: SCALE.micro, fontFamily: FONTS.body },

  /* The lecturer's own words. Verified against the transcript upstream, so
     what is shown here was genuinely said. */
  quote: { flexDirection: "row", gap: SP.md, alignItems: "stretch" },
  quoteBar: { width: 2, borderRadius: 1, backgroundColor: STATE.stated.line },
  quoteBody: { flex: 1, gap: 4 },
  quoteText: {
    color: TEXT_SOFT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 4,
    fontFamily: FONTS.scriptItalic,
    textAlign: READ,
  },
  quoteMeta: { color: STATE.stated.fg, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium, textAlign: READ },

  jump: { alignSelf: READ_END },
  jumpText: { color: GOLD, fontSize: SCALE.micro, fontFamily: FONTS.bodyMedium },

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
