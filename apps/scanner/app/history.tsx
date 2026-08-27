import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Image, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { theme, severityStyle } from "../src/theme";
import { pack } from "../src/packs";
import { getHistory, removeFromHistory, type HistoryEntry } from "../src/storage";

export default function History() {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      getHistory().then(setEntries);
    }, []),
  );

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>ما في فحوصات بعد</Text>
        <Text style={styles.emptyBody}>{pack.tagline}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={entries}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <Text style={styles.hint}>اضغط مطوّلاً على أي فحص لمسحه</Text>
      }
      renderItem={({ item }) => {
        const sev = severityStyle(item.result.severity);
        return (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ params: { id: item.id }, pathname: "/result" })}
            onLongPress={() =>
              Alert.alert("امسح هذا الفحص؟", item.result.title, [
                { text: "إلغاء", style: "cancel" },
                {
                  text: "امسح",
                  style: "destructive",
                  onPress: async () => setEntries(await removeFromHistory(item.id)),
                },
              ])
            }
          >
            <Image source={{ uri: item.imageUri }} style={styles.thumb} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.result.title}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {new Date(item.at).toLocaleDateString("ar")}
              </Text>
            </View>
            <View style={[styles.dot, { backgroundColor: sev.color }]} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 10 },
  empty: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  emptyTitle: { color: theme.text, fontSize: 20, fontWeight: "700" },
  emptyBody: { color: theme.textSoft, fontSize: 15, textAlign: "center", lineHeight: 26 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 10,
  },
  thumb: { width: 54, height: 54, borderRadius: 10, backgroundColor: theme.surfaceAlt },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "600" },
  rowMeta: { color: theme.textFaint, fontSize: 13 },
  dot: { width: 10, height: 10, borderRadius: 5, marginLeft: 4 },
  hint: { color: theme.textFaint, fontSize: 12, textAlign: "center", marginBottom: 6 },
});
