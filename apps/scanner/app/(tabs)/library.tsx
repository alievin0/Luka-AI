import { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolBadge } from "../../src/components/SymbolBadge";
import { pack, isScanner, type LibraryEntry } from "../../src/packs";
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
  gradeOf,
  type Severity,
} from "../../src/scanner-ui";
import { SeverityDot, SearchField, Button, Segmented, type TabItem } from "../../src/components/scanner-kit";
import { NAV_CLEARANCE } from "../../src/components/ScannerNav";
import { useTabToTop } from "../../src/tab-to-top";

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

/** Forty-eight is a long way to scroll to reach the eight that matter. */
type Filter = "all" | Severity;

const FILTERS: TabItem<Filter>[] = [
  { key: "all", label: "" },
  { key: "critical", label: "" },
  { key: "warning", label: "" },
  { key: "info", label: "" },
];

const FILTER_WORD = {
  all: ui.filterAll,
  critical: ui.filterCritical,
  warning: ui.filterWarning,
  info: ui.filterInfo,
} as const;

export default function Library() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const list = useTabToTop<LibraryEntry>();

  const scannerPack = isScanner(pack) ? pack : null;
  const entries = useMemo(() => scannerPack?.library ?? [], [scannerPack]);

  const matches = useMemo(() => {
    const q = normalise(query.trim());
    const bySeverity = filter === "all" ? entries : entries.filter((e) => e.severity === filter);
    const found = q
      ? bySeverity.filter((e) =>
          [t(e.title), e.subtitle, t(e.summary)].some((field) => normalise(field).includes(q)),
        )
      : bySeverity;
    return [...found].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  }, [query, filter, entries]);

  if (entries.length === 0) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.fill} edges={["top"]}>
          <NotInTheGuide onScan={() => router.push("/")} />
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
          <Segmented
            items={FILTERS.map((f) => ({ ...f, label: t(FILTER_WORD[f.key]) }))}
            value={filter}
            onChange={setFilter}
          />
        </View>

        <FlatList
          ref={list}
          data={matches}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<NotInTheGuide onScan={() => router.push("/")} />}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              onPress={() => router.push({ pathname: "/light/[id]", params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${t(item.title)} — ${t(GRADE_WORD[item.severity])}`}
            >
              {/* The symbol carries the grade too. A red dot next to a grey
                  symbol is two different answers to the same question, and
                  the symbol is the half the eye lands on first. */}
              <SymbolBadge
                glyph={item.glyph}
                colour={gradeOf(item.severity).fg}
                background="transparent"
                size={40}
              />
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
  notHere: { gap: SP.md, alignItems: "center", paddingHorizontal: SP.xl, paddingTop: SP.section },
  notHereTitle: { color: TEXT, ...TYPE.section, fontFamily: FONT.bold, textAlign: "center" },
  notHereBody: {
    color: TEXT_SOFT,
    ...TYPE.body,
    fontFamily: FONT.regular,
    textAlign: "center",
  },

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

/**
 * What a search that finds nothing should say.
 *
 * "Nothing matches that" is true and useless: the driver is left believing the
 * app does not know their car. The guide covers the lights nearly every car
 * shares; a dashboard carries many more, and the scanner is not limited to
 * this list — it reads symbols the guide never names. Pointing at the camera
 * is the honest end of a failed search, and the only one that helps.
 */
function NotInTheGuide({ onScan }: { onScan: () => void }) {
  return (
    <View style={styles.notHere}>
      <Text style={styles.notHereTitle}>{t(ui.guideNotHere)}</Text>
      <Text style={styles.notHereBody}>{t(ui.guideNotHereBody)}</Text>
      <Button label={t(ui.guidePhotographIt)} variant="secondary" onPress={onScan} />
    </View>
  );
}
