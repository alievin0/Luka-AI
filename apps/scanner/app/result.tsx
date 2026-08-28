import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack, isScanner, optionLabel, optionValue } from "../src/packs";
import Feather from "@expo/vector-icons/Feather";
import { SymbolBadge } from "../src/components/SymbolBadge";
import { currencyFor, getHistory, getProfile, updateProfile, type HistoryEntry, type Profile } from "../src/storage";
import { isPro } from "../src/purchases";
import { decide } from "../src/decision";
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
 *
 * Half of this screen is the product. The verdict, the light's name and how
 * sure the model is are free forever: they are what a driver on the hard
 * shoulder needs to decide whether to keep driving, and a safety judgement is
 * not something to sell. Everything that follows — why it happened, what it
 * costs, what breaks if they carry on — is the subscription, and a free reader
 * sees a panel naming exactly those parts instead.
 *
 * That panel lists only what this particular result actually holds, for the
 * same reason the tabs above it do. Selling a driver "what it means on your
 * car" when the model returned no `carContext` is a promise the purchase
 * cannot keep, and they find that out after paying.
 */

type View4 = "summary" | "causes" | "actions" | "also";

/** The words for each roadside class, and whether it needs the safe-place
 *  question. Only the two that mean "the journey is over" ask it — putting it
 *  under "you can continue" would teach people to dismiss it. */
const ROADSIDE = {
  "do-not-move": { title: ui.roadDoNotMoveTitle, line: ui.roadDoNotMoveLine, ask: true, tone: "critical" },
  "move-to-safety": { title: ui.roadMoveToSafetyTitle, line: ui.roadMoveToSafetyLine, ask: true, tone: "critical" },
  "drive-with-care": { title: ui.roadDriveWithCareTitle, line: ui.roadDriveWithCareLine, ask: false, tone: "warning" },
  monitor: { title: ui.roadMonitorTitle, line: ui.roadMonitorLine, ask: false, tone: "info" },
} as const;

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
  // Starts locked. A subscriber sees the report a moment later; the opposite
  // default would flash the whole thing to someone who has not bought it.
  const [pro, setPro] = useState(false);
  const [safeHere, setSafeHere] = useState<boolean | null>(null);
  const [symptoms, setSymptoms] = useState<boolean | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    (async () => {
      const [history, saved, subscribed] = await Promise.all([
        getHistory(),
        getProfile(),
        isPro(),
      ]);
      setEntry(history.find((h) => h.id === id) ?? null);
      setProfile(saved);
      setPro(subscribed);
      setLoading(false);
    })();
  }, [id]);

  /* The moment the whole flow is built around: they read the verdict, tapped
     "open the full report", subscribed, and Apple's sheet dropped them back
     here. Reading `isPro()` once on mount would leave that screen locked with
     the receipt already issued — the report they just paid for, still behind
     the button that sold it. So it is re-read every time the screen is looked
     at, which is also what refreshes it after a restore or an expiry. */
  useFocusEffect(
    useCallback(() => {
      let live = true;
      isPro().then((yes) => {
        if (live) setPro(yes);
      });
      return () => {
        live = false;
      };
    }, []),
  );

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
  const locked = !pro;

  /* The decision hierarchy lives in src/decision.ts, where it can be given
     inputs and asked what it concluded. Keeping it here would leave the one
     rule that can get somebody hurt testable only by reading the JSX. */
  const decision = decide(result, symptoms);
  const { overridden, level, severity } = decision;
  const roadside = ROADSIDE[decision.roadside] ?? null;

  /** The report's contents, named one by one — and only the ones that are
   *  actually in this result. Same rule as the tabs: never advertise an empty
   *  panel, least of all one behind a price. */
  const inTheReport = [
    result.causes?.length ? ui.reportCauses : null,
    result.ifIgnored ? ui.reportIfIgnored : null,
    result.actions?.length || result.seekHelpIf?.length ? ui.reportActions : null,
    showCost && result.cost ? ui.reportCost : null,
    result.carContext ? ui.reportCar : null,
    result.alsoDetected?.length ? ui.reportAlso : null,
  ].filter((line): line is NonNullable<typeof line> => line !== null);

  /* If the model returned nothing beyond the verdict, there is no report to
     sell. Offering one anyway would be charging for an empty screen — the
     same mistake as a tab that opens on nothing, with a price on it. */
  const sellReport = locked && inTheReport.length > 0;

  /* The first question the driver has not answered yet, or nothing once they
     have answered them all or waved it away for this result. */
  const nextQuestion =
    isScanner(pack) && !skipped
      ? pack.onboarding.find((q) => !profile[q.key as keyof Profile])
      : undefined;

  const saveAnswer = async (key: string, value: string) => {
    if (!value) return;
    setProfile(await updateProfile({ [key]: value } as Profile));
    setTyped("");
  };
  const grade = gradeOf(severity);
  const verdict = verdictGrade(level);
  const active = views.some((v) => v.key === view) ? view : "summary";

  /* Shares what the screen is showing, and no more. A locked report that can
     be forwarded in full out of the share sheet is not locked. */
  const share = () =>
    Share.share({
      message: [
        `${result.title}${result.subtitle ? ` (${result.subtitle})` : ""}`,
        result.verdict,
        "",
        result.summary,
        ...(!locked && result.actions?.length
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
              level={level}
              text={overridden ? t(ui.symptomStopTitle) : result.verdict}
              reason={overridden ? t(ui.symptomStopBody) : result.summary}
            />
          ) : null}

          {/* What to do with the car, before what is wrong with it. This is
              the product: every competitor stops at "here is what the light
              means", and a driver on the hard shoulder has already read that
              and still does not know whether to switch the engine off.

              Free, always, and outside the paywall gate entirely — it is the
              safety half of the answer, and the words are the app's own, so
              nothing here can be a hallucination. */}
          {roadside ? (
            <Card tone={roadside.tone} style={styles.road}>
              <Text style={[styles.roadTitle, { color: gradeOf(roadside.tone).fg }]}>
                {t(roadside.title)}
              </Text>
              <Body style={{ color: TEXT }}>{t(roadside.line)}</Body>

              {roadside.ask ? (
                <View style={styles.safe}>
                  <Text style={styles.safeQ}>{t(ui.safePlaceQuestion)}</Text>
                  {safeHere === null ? (
                    <View style={styles.safeRow}>
                      <Button label={t(ui.safePlaceYes)} variant="secondary" onPress={() => setSafeHere(true)} />
                      <Button label={t(ui.safePlaceNo)} variant="secondary" onPress={() => setSafeHere(false)} />
                    </View>
                  ) : safeHere ? (
                    <Body style={{ color: TEXT }}>{t(ui.safePlaceGood)}</Body>
                  ) : (
                    <View style={styles.safeSteps}>
                      {ui.safePlaceSteps.map((step, i) => (
                        <Step key={i} index={i + 1} text={t(step)} />
                      ))}
                    </View>
                  )}
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* The reservation, asked instead of printed.
              A line saying "we only read the lamp" is a disclaimer, and in a
              hurry nobody reads one. A question gets answered — by the only
              party who can see the smoke. Asked on every result, because it
              matters most under a verdict that just said not to worry. */}
          <Card tone={symptoms ? "critical" : undefined} style={styles.symptom}>
            <Text style={styles.safeQ}>{t(ui.symptomQuestion)}</Text>
            <Caption>{t(ui.lampOnly)}</Caption>
            {symptoms === null ? (
              <View style={styles.safeRow}>
                <Button label={t(ui.safePlaceYes)} variant="secondary" onPress={() => setSymptoms(true)} />
                <Button label={t(ui.safePlaceNo)} variant="secondary" onPress={() => setSymptoms(false)} />
              </View>
            ) : symptoms ? (
              /* The band at the top now carries the override itself, so this
                 says only what changed and why — repeating the instruction
                 here would make one decision look like two. */
              <Body style={{ color: GRADE.critical.fg }}>{t(ui.symptomOverrode)}</Body>
            ) : (
              <Body>{t(ui.symptomNoneBody)}</Body>
            )}
          </Card>

          {/* Only then: what it was. The symbol is large because matching a
              shape is faster than reading a name. */}
          <Card tone={severity} style={styles.head}>
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
              <SeverityBadge severity={severity} label={t(severityWord(severity))} />
            </View>
          </Card>

          <ConfidenceMeter level={result.confidence} label={t(CONFIDENCE_LABEL[result.confidence])} />

          {!locked && views.length > 1 ? (
            <Segmented items={views} value={active} onChange={setView} style={styles.tabs} />
          ) : null}

          {!locked && active === "summary" ? (
            <View style={styles.stack}>
              {/* Consequence, in the grade's own colour. This is what turns a
                  warning into a decision. */}
              {result.ifIgnored ? (
                <Card tone={severity}>
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
                      icon={severity === "critical" ? "clock" : "tool"}
                      tone={severity === "critical" ? "critical" : undefined}
                      text={t(severity === "critical" ? ui.costDontDelay : ui.costLikelySmall)}
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

          {!locked && active === "causes" ? (
            <Card>
              <SectionTitle>{labels ? t(labels.causes) : ""}</SectionTitle>
              {result.causes.map((cause, i) => (
                <Bullet key={`${cause}-${i}`} text={cause} />
              ))}
            </Card>
          ) : null}

          {!locked && active === "actions" ? (
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

          {!locked && active === "also" ? (
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

          {/* The questions that used to stand in front of the app.
              Asked here because here they have a reason: there is an answer on
              the screen, and these make the next one sharper. One at a time,
              skippable, and the pack's own content — only the moment moved. */}
          {nextQuestion ? (
            <Card style={styles.sharpen}>
              <SectionTitle>{t(ui.sharpenTitle)}</SectionTitle>
              <Caption>{t(ui.sharpenWhy)}</Caption>
              <Text style={styles.safeQ}>{t(nextQuestion.question)}</Text>
              {nextQuestion.options ? (
                <View style={styles.sharpenOptions}>
                  {nextQuestion.options.map((option) => (
                    <Pressable
                      key={t(optionLabel(option))}
                      style={styles.chip}
                      onPress={() => void saveAnswer(nextQuestion.key, optionValue(option, t))}
                    >
                      <Text style={styles.chipText}>{t(optionLabel(option))}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : nextQuestion.input ? (
                <View style={styles.sharpenTyped}>
                  <TextInput
                    style={styles.sharpenInput}
                    value={typed}
                    onChangeText={setTyped}
                    placeholder={t(nextQuestion.input.placeholder)}
                    placeholderTextColor={TEXT_FAINT}
                    keyboardType={nextQuestion.input.keyboard ?? "default"}
                    maxLength={nextQuestion.input.maxLength}
                    textAlign={READ}
                  />
                  <Button
                    label={t(ui.sharpenSave)}
                    variant="secondary"
                    onPress={() => void saveAnswer(nextQuestion.key, typed.trim())}
                  />
                </View>
              ) : null}
              <Pressable onPress={() => setSkipped(true)} hitSlop={8}>
                <Text style={styles.sharpenSkip}>{t(ui.sharpenSkip)}</Text>
              </Pressable>
            </Card>
          ) : null}

          {/* What was withheld, named. A blurred screenshot of the real
              thing would convert better and would also be a picture of an
              answer they cannot read — this says plainly what is inside. */}
          {sellReport ? (
            <Card style={styles.locked}>
              <View style={styles.lockedHead}>
                <Feather name="lock" size={16} color={TEXT_SOFT} />
                <SectionTitle>{t(ui.fullReport)}</SectionTitle>
              </View>
              <Caption>{t(ui.fullReportSub)}</Caption>
              <View style={styles.lockedList}>
                {inTheReport.map((line, i) => (
                  <View key={i} style={styles.lockedRow}>
                    <Feather name="lock" size={13} color={TEXT_FAINT} />
                    <Text style={styles.lockedText}>{t(line)}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {/* Said once, at the foot, in the smallest type on the screen —
              present because it has to be, not competing with the verdict. */}
          <Text style={styles.disclaimer}>{t(pack.disclaimer)}</Text>
        </ScrollView>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.footer}>
        {sellReport ? (
          <Button
            label={t(ui.openFullReport)}
            variant="primary"
            block
            onPress={() => router.push({ pathname: "/paywall", params: { after: level } })}
          />
        ) : (
          <Button label={t(ui.scanAgain)} variant="primary" block onPress={() => router.replace("/")} />
        )}
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

  road: { gap: SP.sm },
  symptom: { gap: SP.sm },
  sharpen: { gap: SP.sm },
  sharpenOptions: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm },
  chip: {
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: RADIUS.pill,
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: TAP - 8,
    justifyContent: "center",
  },
  chipText: { color: TEXT, ...TYPE.caption, fontFamily: FONT.medium },
  sharpenTyped: { flexDirection: "row", gap: SP.sm, alignItems: "center" },
  sharpenInput: {
    flex: 1,
    color: TEXT,
    ...TYPE.body,
    fontFamily: FONT.regular,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    minHeight: TAP,
  },
  sharpenSkip: { color: TEXT_FAINT, ...TYPE.caption, fontFamily: FONT.medium, textAlign: "center" },
  symptomStop: { gap: SP.xs },
  roadTitle: { ...TYPE.section, fontFamily: FONT.bold, textAlign: READ },
  safe: { gap: SP.md, marginTop: SP.sm, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: SP.md },
  safeQ: { color: TEXT, ...TYPE.body, fontFamily: FONT.bold, textAlign: READ },
  safeRow: { flexDirection: "row", gap: SP.sm },
  safeSteps: { gap: SP.sm },
  locked: { gap: SP.sm },
  lockedHead: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  lockedList: { gap: SP.sm, marginTop: SP.xs },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: SP.sm },
  lockedText: {
    flex: 1,
    color: TEXT,
    ...TYPE.body,
    fontFamily: FONT.regular,
    textAlign: READ,
  },

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
