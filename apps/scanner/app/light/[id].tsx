import { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolBadge } from "../../src/components/SymbolBadge";
import { pack, isScanner } from "../../src/packs";
import { t } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import { BG, TEXT_SOFT, gradeOf, FONT, TYPE, SP, READ, BACK } from "../../src/scanner-ui";
import {
  Card,
  Title,
  Subtitle,
  SectionTitle,
  Body,
  SeverityScale,
  Button,
  EmptyState,
} from "../../src/components/scanner-kit";

/**
 * One warning light, in full.
 *
 * A route rather than a state swap inside the list, so it animates in and the
 * back gesture closes it without a hand-rolled BackHandler.
 *
 * Two things only: what it means, and what to do. The guide deliberately does
 * not carry likely causes — the app diagnoses those from a photo of the
 * actual car, and a generic list here would invite diagnosis from a book.
 */

const GRADE_WORD = {
  critical: ui.gradeCritical,
  warning: ui.gradeWarning,
  info: ui.gradeInfo,
} as const;

export default function LightEntry() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const entry = useMemo(() => {
    const library = isScanner(pack) ? pack.library : undefined;
    return library?.find((e) => e.id === id) ?? null;
  }, [id]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/library"));

  if (!entry) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <EmptyState glyph="▤" title={t(ui.noMatch)} action={t(ui.backToList)} onAction={back} />
      </SafeAreaView>
    );
  }

  const grade = gradeOf(entry.severity);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.bar}>
        <Pressable
          onPress={back}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t(ui.backToList)}
          style={styles.barBtn}
        >
          <Text style={styles.barGlyph}>{BACK}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Here the colour is earned: one light, and its grade is the point. */}
        <View style={styles.head}>
          <SymbolBadge glyph={entry.glyph} colour={grade.fg} background={grade.bg} size={76} />
          <Title>{t(entry.title)}</Title>
          <Subtitle>{entry.subtitle}</Subtitle>
          {/* The grade said by quantity and by word as well as by colour, so
              the one screen that explains a light does not rely on hue to do
              it. The list stays a list; this is where the detail belongs. */}
          <SeverityScale
            severity={entry.severity}
            label={t(GRADE_WORD[entry.severity])}
            caption={t(ui.severityLevel)}
          />
        </View>

        <Card>
          <SectionTitle>{t(ui.whatItMeans)}</SectionTitle>
          <Body>{t(entry.summary)}</Body>
        </Card>

        <Card tone={entry.severity}>
          <SectionTitle>{t(ui.whatToDoNow)}</SectionTitle>
          <Text style={[styles.action, { color: grade.fg }]}>{t(entry.action)}</Text>
        </Card>

        <Button label={t(ui.backToList)} block onPress={back} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  bar: { flexDirection: "row", paddingHorizontal: SP.md },
  barBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  barGlyph: { color: TEXT_SOFT, fontSize: 22 },
  content: { paddingHorizontal: SP.lg, paddingBottom: SP.section, gap: SP.lg },
  head: { alignItems: "center", gap: SP.md, paddingVertical: SP.lg },
  action: { ...TYPE.body, fontFamily: FONT.medium, textAlign: READ },
});
