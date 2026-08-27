import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack, isScanner } from "../src/packs";
import Feather from "@expo/vector-icons/Feather";
import { SymbolBadge } from "../src/components/SymbolBadge";
import { currencyFor, getHistory, getProfile, type HistoryEntry, type Profile } from "../src/storage";
import { formatMoneyRange } from "../src/money";
import { carLabel } from "../src/car";
import { t, fill } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import {
  BG,
  BORDER,
  SURFACE,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  GRADE,
  gradeOf,
  verdictGrade,
  FONT,
  TYPE,
  SP,
  RADIUS,
  TAP,
  READ,
  BACK,
} from "../src/scanner-ui";
import {
  Card,
  Title,
  Subtitle,
  SectionTitle,
  Body,
  Caption,
  SeverityBadge,
  SeverityDot,
  VerdictBand,
  ConfidenceMeter,
  Button,
  Segmented,
  Step,
  Bullet,
  Fact,
  EmptyState,
} from "../src/components/scanner-kit";

/**
 * The answer.
 *
 * A driver has stopped on the hard shoulder and wants one thing before
 * anything else: can I keep driving? So the verdict sits at the top, at the
 * largest size on the screen, and everything that explains it is filed behind
 * four views they can reach when they are ready to read rather than to act.
 *
 * The severity of the light and the verdict about driving come from one
 * resolver, so the two can never contradict each other in the markup — the
 * failure that would matter most here is a red warning above the words "safe
 * to continue".
 */

type View4 = "summary" | "causes" | "actions" | "also";

const CONFIDENCE_LABEL = {
  high: ui.confidenceHigh,
  medium: ui.confidenceMedium,
  low: ui.confidenceLow,
} as const;

const scannerPack = isScanner(pack) ? pack : null;

export default function Result() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View4>("summary");

  useEffect(() => {
    (async () => {
      const [history, saved] = await Promise.all([getHistory(), getProfile()]);
      setEntry(history.find((h) => h.id === id) ?? null);
      setProfile(saved);
      setLoading(false);
    })();
  }, [id]);

  const result = entry?.result;

  /** Only the views that have something in them. A tab that opens on an empty
   *  panel teaches the driver the tabs are not worth pressing. */
  const views = useMemo(() => {
    // Also guards the shape: a photo that was never read has none of these
    // fields, and the not-detected screen below has no tabs at all.
    if (!result?.detected) return [];
    const out: { key: View4; label: string }[] = [{ key: "summary", label: t(ui.resTabSummary) }];
    if (result.causes?.length) out.push({ key: "causes", label: t(ui.resTabCauses) });
    if (result.actions?.length || result.seekHelpIf?.length)
      out.push({ key: "actions", label: t(ui.resTabActions) });
    if (result.alsoDetected?.length) out.push({ key: "also", label: t(ui.resTabAlso) });
    return out;
  }, [result]);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={TEXT_SOFT} />
      </View>
    );
  }

  if (!entry || !result) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <EmptyState
          glyph="⌕"
          title={t(ui.notFound)}
          action={t(ui.scanAgain)}
          onAction={() => router.replace("/")}
        />
      </SafeAreaView>
    );
  }

  /* Nothing readable in the photo. This is its own screen, not a result with
   * empty fields — and it never blames the driver for the light being dim. */
  if (!result.detected) {
    return (
      <NotDetected
        reason={result.notDetectedReason}
        onRetake={() => router.replace("/")}
        // Retaking at the roadside is not always possible — it may be raining,
        // or the car may already be on a truck. A photo taken earlier is often
        // the better one, so the camera screen opens straight into the picker.
        onGallery={() => router.replace({ pathname: "/", params: { pick: "1" } })}
      />
    );
  }

  const labels = scannerPack?.labels;
  const showCost = scannerPack?.showCost ?? false;
  const grade = gradeOf(result.severity);
  const verdict = verdictGrade(result.verdictLevel);
  const active = views.some((v) => v.key === view) ? view : "summary";

  const share = () =>
    Share.share({
      message: [
        `${result.title}${result.subtitle ? ` (${result.subtitle})` : ""}`,
        result.verdict,
        "",
        result.summary,
        ...(result.actions?.length
          ? ["", `${labels ? t(labels.actions) : t(ui.resTabActions)}:`, ...result.actions.map((a, i) => `${i + 1}. ${a}`)]
          : []),
      ].join("\n"),
    });

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        {/* One line of chrome. The driver came here for the verdict, not to
            navigate. */}
        <View style={styles.bar}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t(ui.scanAgain)}
            style={styles.barBtn}
          >
            <Text style={styles.barGlyph}>{BACK}</Text>
          </Pressable>
          <Text style={styles.barTitle}>{t(ui.resultTitle)}</Text>
          <Pressable
            onPress={share}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t(ui.share)}
            style={styles.barBtn}
          >
            <Text style={styles.barGlyph}>↗</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* The judgement, first and largest.
              A driver stopped on the hard shoulder is not reading — they are
              looking for one answer. Putting the light's name above this made
              them find the verdict instead of being told it, which is the
              difference between an emergency tool and a reference app. */}
          {result.verdict ? (
            <VerdictBand
              level={result.verdictLevel}
              text={result.verdict}
              reason={result.summary}
            />
          ) : null}

          {/* Only then: what it was. The symbol is large because matching a
              shape is faster than reading a name. */}
          <Card tone={result.severity} style={styles.head}>
            <View style={styles.headRow}>
              {result.glyph ? (
                <SymbolBadge glyph={result.glyph} colour={grade.fg} background="transparent" size={56} />
              ) : null}
              <View style={styles.headText}>
                <Title>{result.title}</Title>
                {result.subtitle ? <Subtitle>{result.subtitle}</Subtitle> : null}
                {/* Their own car, from what they typed — never from a guess.
                    It qualifies the estimate below it, so it has to be true. */}
                {carLabel(profile) ? (
                  <Text style={styles.forCar}>{carLabel(profile)}</Text>
                ) : null}
              </View>
              <SeverityBadge severity={result.severity} label={t(severityWord(result.severity))} />
            </View>
          </Card>

          <ConfidenceMeter level={result.confidence} label={t(CONFIDENCE_LABEL[result.confidence])} />

          {views.length > 1 ? (
            <Segmented items={views} value={active} onChange={setView} style={styles.tabs} />
          ) : null}

          {active === "summary" ? (
            <View style={styles.stack}>
              {/* Consequence, in the grade's own colour. This is what turns a
                  warning into a decision. */}
              {result.ifIgnored ? (
                <Card tone={result.severity}>
                  <Text style={[styles.consequenceLabel, { color: verdict.fg }]}>
                    {t(ui.ifIgnored)}
                  </Text>
                  <Body style={{ color: TEXT }}>{result.ifIgnored}</Body>
                </Card>
              ) : null}

              {result.facts?.length ? (
                <Card>
                  <SectionTitle>{labels ? t(labels.facts) : ""}</SectionTitle>
                  <View style={styles.facts}>
                    {result.facts.map((fact, i) => (
                      <Fact key={`${fact.label}-${i}`} label={fact.label} value={fact.value} />
                    ))}
                  </View>
                </Card>
              ) : null}

              {showCost && result.cost ? (
                <Card>
                  <SectionTitle>{t(ui.estimatedCost)}</SectionTitle>
                  {/* The user's own currency, not the model's echo of it. The
                      two agree in practice, but only one of them is something
                      the app knows to be true. */}
                  <Text style={styles.cost}>
                    {formatMoneyRange(result.cost.min, result.cost.max, currencyFor(profile))}
                  </Text>

                  {/* A range on its own tells a driver almost nothing: they
                      cannot tell a cheap fix from a deferred disaster. These
                      three lines are what turns a number into a decision, and
                      the urgency one is read off the light's own grade rather
                      than invented. */}
                  <View style={styles.costNotes}>
                    <CostNote
                      icon={result.severity === "critical" ? "clock" : "tool"}
                      tone={result.severity === "critical" ? "critical" : undefined}
                      text={t(result.severity === "critical" ? ui.costDontDelay : ui.costLikelySmall)}
                    />
                    <CostNote icon="map-pin" text={t(ui.costVaries)} />
                  </View>

                  {result.cost.note ? <Caption>{result.cost.note}</Caption> : null}
                </Card>
              ) : null}

              {result.carContext ? (
                <Card>
                  <SectionTitle>{t(ui.onYourCar)}</SectionTitle>
                  <Body>{result.carContext}</Body>
                </Card>
              ) : null}
            </View>
          ) : null}

          {active === "causes" ? (
            <Card>
              <SectionTitle>{labels ? t(labels.causes) : ""}</SectionTitle>
              {result.causes.map((cause, i) => (
                <Bullet key={`${cause}-${i}`} text={cause} />
              ))}
            </Card>
          ) : null}

          {active === "actions" ? (
            <View style={styles.stack}>
              {result.actions?.length ? (
                <Card>
                  <SectionTitle>{labels ? t(labels.actions) : t(ui.whatToDoNow)}</SectionTitle>
                  {result.actions.map((action, i) => (
                    <Step key={`${action}-${i}`} index={i + 1} text={action} />
                  ))}
                </Card>
              ) : null}
              {result.seekHelpIf?.length ? (
                <Card>
                  <SectionTitle>{labels ? t(labels.seekHelp) : ""}</SectionTitle>
                  {result.seekHelpIf.map((line, i) => (
                    <Bullet key={`${line}-${i}`} text={line} tone="warning" />
                  ))}
                </Card>
              ) : null}
            </View>
          ) : null}

          {active === "also" ? (
            <Card>
              <SectionTitle>{t(ui.alsoDetected)}</SectionTitle>
              {(result.alsoDetected ?? []).map((other, i) => (
                <View key={`${other.title}-${i}`} style={styles.alsoRow}>
                  <SeverityDot severity={other.severity} />
                  <Text style={styles.alsoText}>{other.title}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {/* Said once, at the foot, in the smallest type on the screen —
              present because it has to be, not competing with the verdict. */}
          <Text style={styles.disclaimer}>{t(pack.disclaimer)}</Text>
        </ScrollView>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.footer}>
        <Button label={t(ui.scanAgain)} variant="primary" block onPress={() => router.replace("/")} />
      </SafeAreaView>
    </View>
  );
}

/** One qualifier beside the estimate. Icon from the same family as the rest
 *  of the app, and coloured only when it is carrying urgency. */
function CostNote({
  icon,
  text,
  tone,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  text: string;
  tone?: "critical";
}) {
  const colour = tone ? gradeOf(tone).fg : TEXT_FAINT;
  return (
    <View style={styles.costNote}>
      <Feather name={icon} size={14} color={colour} />
      <Text style={[styles.costNoteText, tone && { color: colour }]}>{text}</Text>
    </View>
  );
}

const severityWord = (severity: "critical" | "warning" | "info") =>
  severity === "critical" ? ui.gradeCritical : severity === "warning" ? ui.gradeWarning : ui.gradeInfo;

/**
 * The photo showed nothing we could read.
 *
 * Written as an instruction rather than an error. The dashboard was dim, or
 * the phone moved — neither is something to make a frightened driver feel
 * they got wrong.
 */
function NotDetected({
  reason,
  onRetake,
  onGallery,
}: {
  reason?: string;
  onRetake: () => void;
  onGallery: () => void;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.notFoundContent}>
        <View style={styles.reticle}>
          <Text style={styles.reticleGlyph}>?</Text>
        </View>

        <Text style={styles.notFoundTitle}>{t(ui.notDetectedTitle)}</Text>

        <Card style={styles.tips}>
          <SectionTitle>{t(ui.tipsToTry)}</SectionTitle>
          <Body style={{ color: TEXT }}>{reason || (scannerPack ? t(scannerPack.captureHint) : "")}</Body>
        </Card>

        <View style={styles.notFoundActions}>
          <Button label={t(ui.retakePhoto)} variant="primary" block onPress={onRetake} />
          <Button label={t(ui.chooseFromGallery)} block onPress={onGallery} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  fill: { flex: 1 },
  centre: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" },

  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  barBtn: { width: TAP, height: TAP, alignItems: "center", justifyContent: "center" },
  barGlyph: { color: TEXT_SOFT, fontSize: 22 },
  barTitle: { color: TEXT, ...TYPE.caption, fontFamily: FONT.semibold },

  content: { paddingHorizontal: SP.lg, paddingBottom: SP.section, gap: SP.lg },
  stack: { gap: SP.lg },

  head: { gap: SP.lg },
  headRow: { flexDirection: "row", alignItems: "center", gap: SP.lg, flexWrap: "wrap" },
  headText: { flex: 1, gap: 2, minWidth: 140 },


  consequenceLabel: { ...TYPE.caption, fontFamily: FONT.bold, textAlign: READ },

  tabs: { marginTop: SP.xs },

  facts: { flexDirection: "row", flexWrap: "wrap", gap: SP.lg },

  costNotes: { gap: SP.sm, marginTop: SP.xs },
  costNote: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  costNoteText: { flex: 1, color: TEXT_FAINT, ...TYPE.caption, fontFamily: FONT.regular, textAlign: READ },
  forCar: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.medium, textAlign: READ, marginTop: 2 },
  cost: { color: TEXT, ...TYPE.title, fontFamily: FONT.bold, textAlign: READ, fontVariant: ["tabular-nums"] },

  alsoRow: { flexDirection: "row", alignItems: "center", gap: SP.md, minHeight: 32 },
  alsoText: { flex: 1, color: TEXT, ...TYPE.body, fontFamily: FONT.regular, textAlign: READ },

  disclaimer: {
    color: TEXT_FAINT,
    ...TYPE.small,
    fontFamily: FONT.regular,
    textAlign: READ,
    marginTop: SP.sm,
  },

  footer: {
    paddingHorizontal: SP.lg,
    paddingTop: SP.md,
    paddingBottom: SP.sm,
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  notFoundContent: { padding: SP.xl, gap: SP.xl, alignItems: "center", flexGrow: 1, justifyContent: "center" },
  reticle: {
    width: 120,
    height: 96,
    borderRadius: RADIUS.lg,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  reticleGlyph: { color: TEXT_FAINT, fontSize: 34, fontFamily: FONT.bold },
  notFoundTitle: { color: TEXT, ...TYPE.title, fontFamily: FONT.bold, textAlign: "center" },
  tips: { alignSelf: "stretch", backgroundColor: SURFACE },
  notFoundActions: { alignSelf: "stretch", gap: SP.md },
});
