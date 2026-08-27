import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { theme, withAlpha } from "../theme";
import type { ProgramPack } from "../packs";
import {
  getCompletions,
  isDoneToday,
  nextSessionIndex,
  streakFrom,
  type Completion,
} from "../progress";

export function ProgramHome({ pack }: { pack: ProgramPack }) {
  const router = useRouter();
  const [completions, setCompletions] = useState<Completion[]>([]);

  useFocusEffect(
    useCallback(() => {
      getCompletions().then(setCompletions);
    }, []),
  );

  const streak = streakFrom(completions);
  const doneToday = isDoneToday(completions);
  const index = nextSessionIndex(completions, pack.sessions.length);
  const session = pack.sessions[index];
  const doneCount = new Set(completions.map((c) => c.sessionId)).size;
  const progress = Math.round((doneCount / pack.sessions.length) * 100);
  const tip = pack.tips[(streak + doneCount) % pack.tips.length];

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[withAlpha(theme.accent, 0.18), theme.bg, theme.bg]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View>
              <Text style={styles.appName}>{pack.appName}</Text>
              <Text style={styles.promise}>{pack.plan.promise}</Text>
            </View>
            <Pressable
              style={styles.iconButton}
              onPress={() => router.push("/settings")}
              hitSlop={8}
            >
              <Text style={styles.iconGlyph}>⚙</Text>
            </Pressable>
          </View>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{streak}</Text>
              <Text style={styles.statLabel}>{pack.nouns.streakUnit} متواصل</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{doneCount}</Text>
              <Text style={styles.statLabel}>{pack.nouns.session} خلصت</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{progress}%</Text>
              <Text style={styles.statLabel}>من {pack.nouns.plan}</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>

          <Text style={styles.sectionLabel}>
            {doneToday ? "خلصت اليوم — كمّل إذا بدك" : "تمرين اليوم"}
          </Text>

          <Pressable
            style={styles.sessionCard}
            onPress={() =>
              router.push({ pathname: "/session", params: { id: session.id } })
            }
          >
            <View style={styles.sessionHead}>
              <Text style={styles.sessionTitle}>{session.title}</Text>
              <View style={styles.chip}>
                <Text style={styles.chipText}>{session.minutes} دقيقة</Text>
              </View>
            </View>
            <Text style={styles.sessionSubtitle}>{session.subtitle}</Text>
            <View style={styles.sessionMeta}>
              <Text style={styles.metaText}>
                {session.items.length} {pack.nouns.item}
              </Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaText}>{session.focus}</Text>
            </View>
            <View style={styles.startButton}>
              <Text style={styles.startText}>
                {doneToday ? "ابدأ التالي" : "ابدأ الآن"}
              </Text>
            </View>
          </Pressable>

          <View style={styles.tipCard}>
            <Text style={styles.tipLabel}>نصيحة اليوم</Text>
            <Text style={styles.tipText}>{tip}</Text>
          </View>

          <Pressable style={styles.planLink} onPress={() => router.push("/plan")}>
            <Text style={styles.planLinkText}>شوف {pack.nouns.plan} كاملة</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  appName: { color: theme.text, fontSize: 28, fontWeight: "800" },
  promise: { color: theme.textSoft, fontSize: 14, marginTop: 4, lineHeight: 24 },
  iconButton: {
    backgroundColor: theme.surface,
    borderRadius: 999,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { color: theme.textSoft, fontSize: 18 },
  statRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  stat: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  statValue: { color: theme.accent, fontSize: 26, fontWeight: "800" },
  statLabel: { color: theme.textFaint, fontSize: 12, marginTop: 3 },
  progressTrack: {
    height: 6,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: 6, backgroundColor: theme.accent, borderRadius: 3 },
  sectionLabel: { color: theme.textFaint, fontSize: 13, fontWeight: "700", marginTop: 6 },
  sessionCard: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    gap: 8,
  },
  sessionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sessionTitle: { color: theme.text, fontSize: 21, fontWeight: "700", flex: 1 },
  chip: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  chipText: { color: theme.textSoft, fontSize: 12, fontWeight: "600" },
  sessionSubtitle: { color: theme.textSoft, fontSize: 15, lineHeight: 26 },
  sessionMeta: { flexDirection: "row", gap: 8, alignItems: "center" },
  metaText: { color: theme.textFaint, fontSize: 13 },
  metaDot: { color: theme.textFaint, fontSize: 13 },
  startButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 6,
  },
  startText: { color: theme.bg, fontSize: 16, fontWeight: "800" },
  tipCard: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 6,
  },
  tipLabel: { color: theme.accent, fontSize: 12, fontWeight: "700" },
  tipText: { color: theme.textSoft, fontSize: 15, lineHeight: 26 },
  planLink: { alignItems: "center", paddingVertical: 10 },
  planLinkText: { color: theme.textSoft, fontSize: 15 },
});
