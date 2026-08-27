import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Pressable,
  Share,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { pack } from "../src/scanners";
import { theme, severityStyle, verdictStyle } from "../src/theme";
import { getHistory, type HistoryEntry } from "../src/storage";

const CONFIDENCE_LABEL = {
  high: "ثقة عالية",
  medium: "ثقة متوسطة",
  low: "ثقة منخفضة — تأكد من مختص",
} as const;

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {items.map((item, i) => (
        <View key={`${item}-${i}`} style={styles.row}>
          <Text style={styles.bullet}>{i + 1}</Text>
          <Text style={styles.rowText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function Result() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const history = await getHistory();
      setEntry(history.find((h) => h.id === id) ?? null);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>ما لقينا هذا الفحص.</Text>
      </View>
    );
  }

  const { result, imageUri } = entry;
  const sev = severityStyle(result.severity);
  const ver = verdictStyle(result.verdictLevel);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" />

      <View style={styles.headline}>
        <View style={[styles.badge, { backgroundColor: sev.bg }]}>
          <Text style={[styles.badgeText, { color: sev.color }]}>{sev.label}</Text>
        </View>
        <Text style={styles.title}>{result.title}</Text>
        <Text style={styles.subtitle}>{result.subtitle}</Text>
      </View>

      <View style={[styles.verdict, { backgroundColor: ver.bg, borderColor: ver.color }]}>
        <Text style={[styles.verdictText, { color: ver.color }]}>{result.verdict}</Text>
      </View>

      <Text style={styles.summary}>{result.summary}</Text>

      {result.facts?.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{pack.labels.facts}</Text>
          <View style={styles.factGrid}>
            {result.facts.map((fact, i) => (
              <View key={`${fact.label}-${i}`} style={styles.fact}>
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {pack.showCost && result.cost && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>الكلفة التقديرية</Text>
          <Text style={styles.cost}>
            {result.cost.min} – {result.cost.max} {result.cost.currency}
          </Text>
          <Text style={styles.costNote}>{result.cost.note}</Text>
        </View>
      )}

      <Section title={pack.labels.causes} items={result.causes} />
      <Section title={pack.labels.actions} items={result.actions} />
      <Section title={pack.labels.seekHelp} items={result.seekHelpIf} />

      <View style={styles.actions}>
        <Pressable
          style={styles.primaryAction}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.primaryActionText}>افحص كمان مرة</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryAction}
          onPress={() =>
            Share.share({
              message: [
                `${result.title} (${result.subtitle})`,
                result.verdict,
                "",
                result.summary,
                "",
                `${pack.labels.actions}:`,
                ...result.actions.map((a, i) => `${i + 1}. ${a}`),
              ].join("\n"),
            })
          }
        >
          <Text style={styles.secondaryActionText}>مشاركة</Text>
        </Pressable>
      </View>

      <Text style={styles.confidence}>{CONFIDENCE_LABEL[result.confidence]}</Text>
      <Text style={styles.disclaimer}>{pack.disclaimer}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  muted: { color: theme.textSoft, fontSize: 16 },
  photo: { width: "100%", height: 200, borderRadius: theme.radius, backgroundColor: theme.surface },
  headline: { gap: 6 },
  badge: { alignSelf: "flex-start", paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  title: { color: theme.text, fontSize: 28, fontWeight: "800", lineHeight: 40 },
  subtitle: { color: theme.textFaint, fontSize: 14, writingDirection: "ltr", textAlign: "right" },
  verdict: { borderRadius: theme.radius, borderWidth: 1, padding: 16 },
  verdictText: { fontSize: 19, fontWeight: "700", lineHeight: 30 },
  summary: { color: theme.textSoft, fontSize: 16, lineHeight: 28 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 10,
  },
  cardTitle: { color: theme.text, fontSize: 17, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: "700",
    minWidth: 18,
    lineHeight: 26,
  },
  rowText: { color: theme.textSoft, fontSize: 15, lineHeight: 26, flex: 1 },
  factGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  fact: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    padding: 12,
    flexGrow: 1,
    minWidth: "44%",
  },
  factLabel: { color: theme.textFaint, fontSize: 12 },
  factValue: { color: theme.text, fontSize: 15, fontWeight: "600", marginTop: 4 },
  cost: { color: theme.accent, fontSize: 26, fontWeight: "800" },
  costNote: { color: theme.textFaint, fontSize: 13, lineHeight: 22 },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  primaryAction: {
    flex: 2,
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryActionText: { color: theme.bg, fontSize: 16, fontWeight: "800" },
  secondaryAction: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryActionText: { color: theme.text, fontSize: 16, fontWeight: "600" },
  confidence: { color: theme.textFaint, fontSize: 13, textAlign: "center", marginTop: 6 },
  disclaimer: {
    color: theme.textFaint,
    fontSize: 12,
    lineHeight: 21,
    textAlign: "center",
    paddingHorizontal: 8,
  },
});
