import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { pack, isProgram } from "../src/packs";
import { t } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { theme } from "../src/theme";
import { getCompletions } from "../src/progress";

export default function Plan() {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      getCompletions().then((c) => setDone(new Set(c.map((x) => x.sessionId))));
    }, []),
  );

  const program = isProgram(pack) ? pack : null;
  if (!program) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t(ui.noPlan)}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={program.sessions}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={<Text style={styles.promise}>{t(program.plan.promise)}</Text>}
      renderItem={({ item, index }) => {
        const complete = done.has(item.id);
        return (
          <Pressable
            style={[styles.row, complete && styles.rowDone]}
            onPress={() => router.push({ pathname: "/session", params: { id: item.id } })}
          >
            <View style={[styles.num, complete && styles.numDone]}>
              <Text style={[styles.numText, complete && styles.numTextDone]}>
                {complete ? "✓" : index + 1}
              </Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{t(item.title)}</Text>
              <Text style={styles.rowMeta}>
                {item.minutes} {t(ui.minutes)} · {item.items.length} {t(program.nouns.item)} · {t(item.focus)}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  muted: { color: theme.textSoft, fontSize: 16 },
  promise: { color: theme.textSoft, fontSize: 15, lineHeight: 26, marginBottom: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    marginBottom: 8,
  },
  rowDone: { opacity: 0.6 },
  num: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  numDone: { backgroundColor: theme.accent },
  numText: { color: theme.textSoft, fontSize: 15, fontWeight: "700" },
  numTextDone: { color: theme.bg },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "600" },
  rowMeta: { color: theme.textFaint, fontSize: 13 },
});
