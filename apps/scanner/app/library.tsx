import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, SectionList } from "react-native";
import { SymbolBadge } from "../src/components/SymbolBadge";
import { pack, isScanner } from "../src/packs";
import { theme, severityStyle } from "../src/theme";
import { normalise } from "../src/countries";
import type { LibraryEntry } from "../src/packs";
import { t } from "../src/i18n";
import { ui } from "../src/i18n/ui";

const SEVERITY_ORDER = ["critical", "warning", "info"] as const;
const SEVERITY_TITLE = {
  critical: ui.sevCritical,
  warning: ui.sevWarning,
  info: ui.sevInfo,
} as const;

export default function Library() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const scannerPack = isScanner(pack) ? pack : null;
  const entries = scannerPack?.library ?? [];

  const sections = useMemo(() => {
    const q = normalise(query);
    const matches = q
      ? entries.filter((e: LibraryEntry) =>
          [t(e.title), e.subtitle, t(e.summary)].some((field: string) =>
            normalise(field).includes(q),
          ),
        )
      : entries;

    return SEVERITY_ORDER.map((severity) => ({
      title: t(SEVERITY_TITLE[severity]),
      severity,
      data: matches.filter((e: LibraryEntry) => e.severity === severity),
    })).filter((section) => section.data.length > 0);
  }, [query, entries]);

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t(ui.noMatch)}</Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: LibraryEntry }) => {
    const sev = severityStyle(item.severity);
    const expanded = open === item.id;
    return (
      <Pressable
        style={styles.row}
        onPress={() => setOpen(expanded ? null : item.id)}
      >
        <View style={styles.rowHead}>
          <SymbolBadge glyph={item.glyph} colour={sev.color} background={sev.bg} />
          <View style={styles.rowTitles}>
            <Text style={styles.rowTitle}>{t(item.title)}</Text>
            <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
          </View>
          <Text style={styles.caret}>{expanded ? "−" : "+"}</Text>
        </View>
        {expanded && (
          <View style={styles.detail}>
            <Text style={styles.summary}>{t(item.summary)}</Text>
            <View style={[styles.actionBox, { backgroundColor: sev.bg }]}>
              <Text style={[styles.actionText, { color: sev.color }]}>{t(item.action)}</Text>
            </View>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t(ui.searchGuide)}
          placeholderTextColor={theme.textFaint}
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={10}>
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{t(ui.noMatch)}</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    margin: 16,
    marginBottom: 4,
  },
  searchGlyph: { color: theme.textFaint, fontSize: 19 },
  search: { flex: 1, color: theme.text, fontSize: 16, paddingVertical: 13, textAlign: "right" },
  clear: { color: theme.textFaint, fontSize: 14 },
  list: { padding: 16, paddingTop: 8, gap: 8 },
  sectionHeader: {
    color: theme.textFaint,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
  },
  row: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    marginBottom: 8,
  },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowTitles: { flex: 1, gap: 2 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "600" },
  rowSubtitle: { color: theme.textFaint, fontSize: 12, writingDirection: "ltr", textAlign: "right" },
  caret: { color: theme.textFaint, fontSize: 20, width: 20, textAlign: "center" },
  detail: { marginTop: 12, gap: 10 },
  summary: { color: theme.textSoft, fontSize: 15, lineHeight: 26 },
  actionBox: { borderRadius: 10, padding: 12 },
  actionText: { fontSize: 15, lineHeight: 25, fontWeight: "500" },
  empty: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  emptyText: { color: theme.textFaint, fontSize: 15, textAlign: "center", marginTop: 32 },
});
