import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, BackHandler } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolBadge } from "../src/components/SymbolBadge";
import { pack, isScanner, type LibraryEntry } from "../src/packs";
import { normalise } from "../src/countries";
import { t, fill } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import {
  BG,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  gradeOf,
  FONT,
  TYPE,
  SP,
  RADIUS,
  READ,
  BACK,
} from "../src/scanner-ui";
import {
  Card,
  Title,
  Subtitle,
  SectionTitle,
  Body,
  SeverityBadge,
  SeverityDot,
  SearchField,
  Button,
  EmptyState,
} from "../src/components/scanner-kit";
import { ScannerNav, NAV_CLEARANCE } from "../src/components/ScannerNav";

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
  const [openId, setOpenId] = useState<string | null>(null);

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

  const open = useMemo(() => entries.find((e) => e.id === openId) ?? null, [entries, openId]);

  /* Android's back gesture should close the entry, not leave the guide. */
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpenId(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const close = useCallback(() => setOpenId(null), []);

  if (entries.length === 0) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.fill} edges={["top"]}>
          <EmptyState glyph="▤" title={t(ui.noMatch)} />
        </SafeAreaView>
        <ScannerNav />
      </View>
    );
  }

  if (open) return <Entry entry={open} onBack={close} />;

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
              onPress={() => setOpenId(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`${t(item.title)} — ${t(GRADE_WORD[item.severity])}`}
            >
              <SymbolBadge
                glyph={item.glyph}
                colour={gradeOf(item.severity).fg}
                background="transparent"
                size={30}
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
      <ScannerNav />
    </View>
  );
}

/**
 * One light, in full.
 *
 * Two things only: what it means, and what to do. The guide deliberately does
 * not carry likely causes — the app knows those from a photo of the actual
 * car, and printing a generic list here would invite a driver to diagnose
 * from a book instead of from their own dashboard.
 */
function Entry({ entry, onBack }: { entry: LibraryEntry; onBack: () => void }) {
  const grade = gradeOf(entry.severity);
  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <View style={styles.bar}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t(ui.backToList)}
            style={styles.barBtn}
          >
            <Text style={styles.barGlyph}>{BACK}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.entry} showsVerticalScrollIndicator={false}>
          <View style={styles.entryHead}>
            <SymbolBadge
              glyph={entry.glyph}
              colour={grade.fg}
              background={grade.bg}
              size={64}
            />
            <Title>{t(entry.title)}</Title>
            <Subtitle>{entry.subtitle}</Subtitle>
            <SeverityBadge severity={entry.severity} label={t(GRADE_WORD[entry.severity])} />
          </View>

          <Card>
            <SectionTitle>{t(ui.whatItMeans)}</SectionTitle>
            <Body>{t(entry.summary)}</Body>
          </Card>

          {/* The instruction carries the grade's colour, because what to do
              about a red light and what to do about an amber one are different
              kinds of urgency and the colour says so before the words do. */}
          <Card tone={entry.severity}>
            <SectionTitle>{t(ui.whatToDoNow)}</SectionTitle>
            <Text style={[styles.action, { color: grade.fg }]}>{t(entry.action)}</Text>
          </Card>

          <Button label={t(ui.backToList)} block onPress={onBack} />
        </ScrollView>
      </SafeAreaView>
      <ScannerNav />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  fill: { flex: 1 },

  head: { paddingHorizontal: SP.lg, paddingBottom: SP.md, gap: SP.md },
  pageTitle: { color: TEXT, ...TYPE.title, fontFamily: FONT.bold, textAlign: READ },

  list: { paddingHorizontal: SP.lg, paddingBottom: NAV_CLEARANCE, gap: SP.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    minHeight: 62,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
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
