import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolBadge } from "../../src/components/SymbolBadge";
import { pack, isScanner } from "../../src/packs";
import { normalise } from "../../src/countries";
import { t, fill } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import {
  BG,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  FONT,
  TYPE,
  SP,
  RADIUS,
  READ,
} from "../../src/scanner-ui";
import { SeverityDot, SearchField, EmptyState } from "../../src/components/scanner-kit";
import { NAV_CLEARANCE } from "../../src/components/ScannerNav";

/**
 * The light guide.
 *
 * This is the screen that earns the subscription between emergencies: a
 * driver who has already been frightened once comes back to learn what the
 * other symbols mean before they see them lit. So it is a reference, not a
 * feed — searchable, ordered by how much trouble each light means, and
 * readable with no signal.
 */

const GRADE_WORD = {
  critical: ui.gradeCritical,
  warning: ui.gradeWarning,
  info: ui.gradeInfo,
} as const;

/** Most dangerous first. A driver scanning this list is looking for the thing
 *  that could strand them, not for alphabetical order. */
const RANK = { critical: 0, warning: 1, info: 2 } as const;

export default function Library() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const scannerPack = isScanner(pack) ? pack : null;
  const entries = useMemo(() => scannerPack?.library ?? [], [scannerPack]);

  const matches = useMemo(() => {
    const q = normalise(query.trim());
    const found = q
      ? entries.filter((e) =>
          [t(e.title), e.subtitle, t(e.summary)].some((field) => normalise(field).includes(q)),
        )
      : entries;
    return [...found].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  }, [query, entries]);

  if (entries.length === 0) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.fill} edges={["top"]}>
          <EmptyState glyph="▤" title={t(ui.noMatch)} />
        </SafeAreaView>
        </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <View style={styles.head}>
          <Text style={styles.pageTitle}>
            {scannerPack?.libraryTitle ? t(scannerPack.libraryTitle) : t(ui.guide)}
          </Text>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={fill(ui.searchLights, { n: entries.length })}
          />
        </View>

        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState glyph="⌕" title={t(ui.noMatch)} />}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              onPress={() => router.push({ pathname: "/light/[id]", params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${t(item.title)} — ${t(GRADE_WORD[item.severity])}`}
            >
              <SymbolBadge glyph={item.glyph} colour={TEXT_SOFT} background="transparent" size={34} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {t(item.title)}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              </View>
              <SeverityDot severity={item.severity} />
            </Pressable>
          )}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  fill: { flex: 1 },

  head: { paddingHorizontal: SP.lg, paddingBottom: SP.md, gap: SP.md },
  pageTitle: { color: TEXT, ...TYPE.title, fontFamily: FONT.bold, textAlign: READ },

  list: { paddingHorizontal: SP.lg, paddingBottom: NAV_CLEARANCE, gap: SP.xs + 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    minHeight: 54,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
  },
  rowBody: { flex: 1, gap: 1 },
  rowTitle: { color: TEXT, ...TYPE.body, fontFamily: FONT.semibold, textAlign: READ },
  rowSub: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.latin, textAlign: READ },

  bar: { flexDirection: "row", paddingHorizontal: SP.md },
  barBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  barGlyph: { color: TEXT_SOFT, fontSize: 22 },

  entry: { paddingHorizontal: SP.lg, paddingBottom: NAV_CLEARANCE, gap: SP.lg },
  entryHead: { alignItems: "center", gap: SP.md, paddingVertical: SP.lg },
  action: { ...TYPE.body, fontFamily: FONT.medium, textAlign: READ },
});
