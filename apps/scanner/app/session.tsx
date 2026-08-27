import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, AppState } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { pack, isProgram } from "../src/packs";
import { t } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { theme } from "../src/theme";
import { markComplete } from "../src/progress";

type Phase = "work" | "rest" | "done";

/**
 * The session player. Timing is derived from a wall-clock target rather than
 * counted down by interval ticks — a JS interval drifts, and stops entirely
 * when the screen locks or the app backgrounds mid-exercise. Anchoring to a
 * timestamp means coming back to the app resumes at the right second.
 */
export default function SessionPlayer() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const session = useMemo(() => {
    if (!isProgram(pack)) return null;
    return pack.sessions.find((s) => s.id === id) ?? pack.sessions[0];
  }, [id]);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("work");
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(true);
  const endAtRef = useRef<number | null>(null);

  const item = session?.items[index];
  const isTimed = typeof item?.seconds === "number";
  const duration = phase === "rest" ? (item?.restSeconds ?? 0) : (item?.seconds ?? 0);

  // Anchor the countdown to a timestamp so backgrounding doesn't lose time.
  useEffect(() => {
    if (!item || phase === "done") return;
    if (phase === "work" && !isTimed) return;
    endAtRef.current = Date.now() + duration * 1000;
    setRemaining(duration);
  }, [item, phase, duration, isTimed]);

  useEffect(() => {
    if (!running || phase === "done") return;
    if (phase === "work" && !isTimed) return;

    const tick = () => {
      if (endAtRef.current === null) return;
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) advance();
    };

    const timer = setInterval(tick, 250);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [running, phase, isTimed, index]);

  const finish = async () => {
    if (session) await markComplete(session.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhase("done");
  };

  const advance = () => {
    if (!session) return;
    if (phase === "work") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (index === session.items.length - 1) {
        finish();
      } else {
        setPhase("rest");
      }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIndex((i) => i + 1);
    setPhase("work");
  };

  if (!session || !isProgram(pack)) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t(ui.sessionNotFound)}</Text>
      </View>
    );
  }

  if (phase === "done") {
    return (
      <SafeAreaView style={styles.doneWrap}>
        <View style={styles.doneBody}>
          <Text style={styles.doneMark}>✓</Text>
          <Text style={styles.doneTitle}>{t(ui.finished)}</Text>
          <Text style={styles.doneSubtitle}>{t(session.title)}</Text>
          <Text style={styles.doneMeta}>
            {session.items.length} {t(pack.nouns.item)} · {session.minutes} {t(ui.minutes)}
          </Text>
        </View>
        <View style={styles.doneFooter}>
          <Pressable style={styles.primary} onPress={() => router.replace("/")}>
            <Text style={styles.primaryText}>{t(ui.backHome)}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const progress = ((index + (phase === "rest" ? 1 : 0)) / session.items.length) * 100;

  return (
    <SafeAreaView style={styles.wrap}>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${progress}%` }]} />
      </View>

      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
        <Text style={styles.counter}>
          {index + 1} / {session.items.length}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {phase === "rest" ? (
          <>
            <Text style={styles.phaseLabel}>{t(ui.rest)}</Text>
            <Text style={styles.timer}>{remaining}</Text>
            <Text style={styles.nextUp}>
              {t(ui.nextUp)}: {session.items[index + 1] ? t(session.items[index + 1].name) : "—"}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.phaseLabel}>{item ? t(item.name) : ""}</Text>
            <Text style={styles.itemName}>{item ? t(item.name) : ""}</Text>
            {isTimed ? (
              <Text style={styles.timer}>{remaining}</Text>
            ) : (
              <Text style={styles.reps}>{item?.reps} {t(ui.reps)}</Text>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t(ui.howToDoIt)}</Text>
              {item?.cues.map((cue, i) => (
                <View key={i} style={styles.row}>
                  <Text style={styles.bullet}>{i + 1}</Text>
                  <Text style={styles.rowText}>{t(cue)}</Text>
                </View>
              ))}
            </View>

            {item?.mistakes && item.mistakes.length > 0 && (
              <View style={[styles.card, styles.mistakeCard]}>
                <Text style={[styles.cardTitle, { color: theme.warning }]}>
                  {t(ui.commonMistakes)}
                </Text>
                {item.mistakes.map((mistake, i) => (
                  <View key={i} style={styles.row}>
                    <Text style={[styles.bullet, { color: theme.warning }]}>✕</Text>
                    <Text style={styles.rowText}>{t(mistake)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.controls}>
        {(isTimed || phase === "rest") && (
          <Pressable style={styles.secondary} onPress={() => setRunning((r) => !r)}>
            <Text style={styles.secondaryText}>{running ? t(ui.pause) : t(ui.resume)}</Text>
          </Pressable>
        )}
        <Pressable style={styles.primary} onPress={advance}>
          <Text style={styles.primaryText}>
            {phase === "rest"
              ? t(ui.startNext)
              : index === session.items.length - 1
                ? t(ui.finish)
                : t(ui.next)}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  muted: { color: theme.textSoft, fontSize: 16 },
  track: { height: 3, backgroundColor: theme.surfaceAlt },
  trackFill: { height: 3, backgroundColor: theme.accent },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  close: { color: theme.textFaint, fontSize: 20 },
  counter: { color: theme.textFaint, fontSize: 14, fontWeight: "600" },
  body: { padding: 20, paddingTop: 4, gap: 14, alignItems: "stretch" },
  phaseLabel: {
    color: theme.textFaint,
    fontSize: 13,
    textAlign: "center",
    writingDirection: "ltr",
  },
  itemName: {
    color: theme.text,
    fontSize: 30,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 44,
  },
  timer: {
    color: theme.accent,
    fontSize: 68,
    fontWeight: "800",
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  reps: { color: theme.accent, fontSize: 40, fontWeight: "800", textAlign: "center" },
  nextUp: { color: theme.textSoft, fontSize: 17, textAlign: "center", marginTop: 8 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 10,
  },
  mistakeCard: { borderColor: theme.warning + "44" },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet: { color: theme.accent, fontSize: 13, fontWeight: "700", minWidth: 16, lineHeight: 26 },
  rowText: { color: theme.textSoft, fontSize: 15, lineHeight: 26, flex: 1 },
  controls: { flexDirection: "row", gap: 10, padding: 20 },
  primary: {
    flex: 2,
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 17,
    alignItems: "center",
  },
  primaryText: { color: theme.bg, fontSize: 17, fontWeight: "800" },
  secondary: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingVertical: 17,
    alignItems: "center",
  },
  secondaryText: { color: theme.text, fontSize: 16, fontWeight: "600" },
  doneWrap: { flex: 1, backgroundColor: theme.bg },
  doneBody: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  doneMark: { color: theme.accent, fontSize: 72, fontWeight: "800" },
  doneTitle: { color: theme.text, fontSize: 34, fontWeight: "800" },
  doneSubtitle: { color: theme.textSoft, fontSize: 18, textAlign: "center" },
  doneMeta: { color: theme.textFaint, fontSize: 14, marginTop: 4 },
  doneFooter: { padding: 20 },
});
