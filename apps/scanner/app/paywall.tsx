import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { DESIGN, designAsset } from "../src/design-assets";
import { pack, bulletText, bulletDetail, bulletIcon, bulletGlyph, bulletSymbol } from "../src/packs";
import { t, fill } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { UI_FONT } from "../src/ui-font";
import { BG, SURFACE, BORDER, TEXT, TEXT_SOFT, TEXT_FAINT, GRADE, READ } from "../src/scanner-ui";
import { privacyUrl, supportUrl, termsUrl } from "../src/legal";
import { getOffers, purchase, purchasesAvailable, restore, type Offer } from "../src/purchases";

/**
 * The purchase screen.
 *
 * Flat, dark, and deliberately undecorated. It is selling an instrument, and
 * an instrument that arrives wrapped in atmosphere is not one anybody trusts
 * at a roadside — so there is no photograph behind it, no gradient, no glow
 * and nothing floating. Separation comes from a hairline border and a surface
 * a shade off the ground, and from space.
 *
 * The one rule enforced in code rather than copy: a trial is only ever
 * offered for a plan that has one. An annual plan sitting under "start your
 * 3-day trial" when the trial belongs to the weekly plan is a false claim on
 * a purchase screen — the kind App Review rejects and, worse, the kind a
 * buyer discovers on their statement.
 */

/**
 * Measured off the design file, not guessed from a screenshot.
 *
 * Its canvas is 853x1844 — a 390x844 phone at 2.187x — so every value in it
 * divides down cleanly. The cards sit 38px from each edge, which is 17pt here;
 * the headline column is inset further, to 85px, which is 39pt. Two different
 * insets, and the difference between them is the reason the screen reads as
 * composed rather than merely padded.
 */
const GUTTER = 18;
const HEAD_INSET = 26;

export default function Paywall() {
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    (async () => {
      const live = await getOffers();
      // Fall back to the pack's configured pricing so the paywall is always a
      // real screen — in dev, and if offerings fail to load on a bad network.
      const shown: Offer[] = live.length
        ? live
        : pack.pricing.products.map((product) => ({
            id: product.id,
            title: t(product.label),
            price: product.fallbackPrice,
            period: t(product.period),
          }));
      setOffers(shown);
      setSelected(
        shown.find((o) => o.id === pack.pricing.defaultProductId)?.id ?? shown[0]?.id ?? null,
      );
    })();
  }, []);

  const chosen = pack.pricing.products.find((p) => p.id === selected);
  const trialDays = chosen?.trialDays;

  const buy = async () => {
    if (!selected) return;
    if (!purchasesAvailable()) {
      Alert.alert(t(ui.unavailable), t(ui.purchasesOff));
      return;
    }
    setWorking(true);
    const done = await purchase(selected);
    setWorking(false);
    if (done) router.back();
  };

  const benefits = pack.paywall.bullets;

  return (
    <View style={styles.root}>
      {/* The night road, from the design. It is already faint in the file
          itself, so it needs no opacity here — it sits behind the header and
          fades out before the first card, which is what keeps it a texture
          rather than a photograph. */}
      <Image
        source={DESIGN.scene.source}
        style={styles.scene}
        resizeMode="cover"
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Pressable
          style={styles.close}
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t(ui.cancel)}
        >
          <Feather name="x" size={24} color={TEXT_SOFT} />
        </Pressable>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.headline}>{t(pack.paywall.headline)}</Text>
          <Text style={styles.sub}>{t(ui.paywallSub)}</Text>

          {/* The severity language, met here first rather than at the
              roadside. Three equal cards, line-art, no effects. */}
          <View style={styles.grades}>
            <GradeCard tone="critical" mark={DESIGN.gradeStop} title={t(ui.cardStopTitle)} line={t(ui.cardStopLine)} />
            <GradeCard tone="warning" mark={DESIGN.gradeCaution} title={t(ui.cardCautionTitle)} line={t(ui.cardCautionLine)} />
            <GradeCard tone="info" mark={DESIGN.gradeOk} title={t(ui.cardOkTitle)} line={t(ui.cardOkLine)} />
          </View>

          {/* One card, one grid. Hairlines rather than boxes inside boxes. */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t(ui.youGet)}</Text>
            <View style={styles.grid}>
              {benefits.map((bullet, index) => {
                const mark = designAsset(bulletSymbol(bullet));
                const icon = bulletIcon(bullet);
                const detail = bulletDetail(bullet);
                return (
                  <View
                    key={t(bulletText(bullet))}
                    style={[
                      styles.cell,
                      index % 2 === 0 && index < benefits.length - 1 && styles.cellDivided,
                      index >= 2 && styles.cellRow,
                      // An odd count leaves one cell alone on the last row.
                      // Half a hairline hanging in space reads as a mistake,
                      // so it takes the whole row and the rule runs full width.
                      index === benefits.length - 1 && index % 2 === 0 && styles.cellWide,
                    ]}
                  >
                    {mark ? (
                      <Image
                        source={mark.source}
                        style={{ width: mark.width, height: mark.height }}
                        resizeMode="contain"
                      />
                    ) : icon ? (
                      <Feather
                        name={icon as React.ComponentProps<typeof Feather>["name"]}
                        size={18}
                        color={TEXT_SOFT}
                      />
                    ) : (
                      <Text style={styles.cellGlyph}>{bulletGlyph(bullet)}</Text>
                    )}
                    <Text style={styles.cellTitle}>{t(bulletText(bullet))}</Text>
                    {detail ? <Text style={styles.cellDetail}>{t(detail)}</Text> : null}
                  </View>
                );
              })}
            </View>
          </View>

          {offers.length === 0 ? (
            <ActivityIndicator color={TEXT_SOFT} style={styles.loading} />
          ) : (
            <View style={styles.offers}>
              {offers.map((offer) => {
                const configured = pack.pricing.products.find((p) => p.id === offer.id);
                const active = selected === offer.id;
                return (
                  <Pressable
                    key={offer.id}
                    style={[styles.offer, active && styles.offerActive]}
                    onPress={() => setSelected(offer.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${offer.title} ${offer.price}`}
                  >
                    <View style={[styles.radio, active && styles.radioOn]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>

                    <View style={styles.offerBody}>
                      <Text style={styles.offerTitle}>{offer.title}</Text>
                      {configured?.note ? (
                        <Text style={styles.offerNote}>{t(configured.note)}</Text>
                      ) : null}
                    </View>

                    <View style={styles.offerPriceWrap}>
                      <Text style={styles.offerPrice}>{offer.price}</Text>
                      <Text style={styles.offerPeriod}>{offer.period}</Text>
                    </View>

                    {configured?.badge ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{t(configured.badge)}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Shown only when the selected plan actually has a trial. */}
          {trialDays ? (
            <View style={styles.reassure}>
              <Feather name="shield" size={18} color="#FFFFFF" />
              <View style={styles.reassureBody}>
                <Text style={styles.reassureTitle}>{fill(ui.trialSafeTitle, { n: trialDays })}</Text>
                <Text style={styles.reassureLine}>{t(ui.trialSafeBody)}</Text>
              </View>
            </View>
          ) : null}

          {/* Off-white rather than amber: amber is the caution grade three
              cards up this same screen, and a button that wears the warning
              colour is the one confusion this app cannot afford. */}
          <Pressable
            style={({ pressed }) => [
              styles.cta,
              (!selected || working) && styles.ctaOff,
              pressed && { opacity: 0.9 },
            ]}
            onPress={buy}
            disabled={!selected || working}
            accessibilityRole="button"
          >
            {working ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={styles.ctaText}>
                {trialDays ? fill(ui.startTrialDays, { n: trialDays }) : t(ui.subscribeNow)}
              </Text>
            )}
          </Pressable>

          <View style={styles.trust}>
            <Trust icon="rotate-ccw" label={t(ui.trustCancel)} />
            <Trust icon="globe" label={t(ui.trustArabic)} />
            <Trust icon="lock" label={t(ui.trustPrivate)} />
          </View>

          <Pressable onPress={() => restore()} accessibilityRole="button">
            <Text style={styles.restore}>{t(ui.restorePrior)}</Text>
          </Pressable>

          {/* Apple wants the renewal terms and both links on the purchase
              screen itself, not only in a document linked from somewhere. */}
          <Text style={styles.renewal}>{t(ui.renewalTerms)}</Text>
          <View style={styles.legalRow}>
            <Legal label={t(ui.support)} url={supportUrl()} />
            <Text style={styles.legalDot}>·</Text>
            <Legal label={t(ui.privacyPolicy)} url={privacyUrl()} />
            <Text style={styles.legalDot}>·</Text>
            <Legal label={t(ui.terms)} url={termsUrl()} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * One grade, as the design draws it: the word, then the mark, then the
 * instruction.
 *
 * The mark is the design's own file, used as it comes. It is not tinted —
 * each arrives already red, amber or green — and it carries its own STOP or
 * OK inside the shape, so nothing is drawn on top of it here.
 */
function GradeCard({
  tone,
  mark,
  title,
  line,
}: {
  tone: keyof typeof GRADE;
  mark: { source: number; width: number; height: number };
  title: string;
  line: string;
}) {
  const grade = GRADE[tone];
  return (
    <View style={[styles.grade, { borderColor: grade.line, backgroundColor: grade.bg }]}>
      <Text style={[styles.gradeTitle, { color: grade.fg }]} numberOfLines={2}>
        {title}
      </Text>
      <Image
        source={mark.source}
        style={{ width: mark.width, height: mark.height }}
        resizeMode="contain"
      />
      <Text style={styles.gradeLine} numberOfLines={3}>
        {line}
      </Text>
    </View>
  );
}

function Trust({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
}) {
  return (
    <View style={styles.trustItem}>
      <Feather name={icon} size={14} color={TEXT_FAINT} />
      <Text style={styles.trustText} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function Legal({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(url).catch(() => undefined)} hitSlop={8}>
      <Text style={styles.legalLink}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scene: {
    position: "absolute",
    top: DESIGN.scene.top,
    left: 0,
    right: 0,
    height: DESIGN.scene.height,
    width: undefined,
  },
  safe: { flex: 1 },
  close: { alignSelf: "flex-start", padding: 20 },
  content: { paddingHorizontal: GUTTER, paddingBottom: 40, gap: 26 },

  headline: {
    color: TEXT,
    fontSize: 24,
    lineHeight: 34,
    fontFamily: UI_FONT.bold,
    textAlign: "center",
    paddingHorizontal: HEAD_INSET,
  },
  sub: {
    color: TEXT_SOFT,
    fontSize: 15,
    lineHeight: 25,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
    paddingHorizontal: HEAD_INSET,
  },

  grades: { flexDirection: "row", gap: 10 },
  grade: {
    flex: 1,
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  gradeTitle: { fontSize: 13, lineHeight: 19, fontFamily: UI_FONT.bold, textAlign: "center" },
  gradeLine: { color: TEXT, fontSize: 12.5, lineHeight: 19, fontFamily: UI_FONT.regular, textAlign: "center" },

  card: {
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 26,
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 20,
  },
  cardTitle: { color: TEXT, fontSize: 16, fontFamily: UI_FONT.bold, textAlign: READ },

  /* Two columns rather than five: five across a phone gives each about sixty
     points, and a benefit nobody can read is not one. */
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", gap: 7, paddingVertical: 14, paddingHorizontal: 10, alignItems: "center" },
  cellWide: { width: "100%" },
  cellDivided: { borderRightWidth: 1, borderRightColor: BORDER },
  cellRow: { borderTopWidth: 1, borderTopColor: BORDER },
  cellGlyph: { color: TEXT_SOFT, fontSize: 17 },
  cellTitle: { color: TEXT, fontSize: 14, fontFamily: UI_FONT.bold, textAlign: "center" },
  cellDetail: {
    color: TEXT_FAINT,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
  },

  loading: { marginVertical: 28 },
  offers: { gap: 12 },
  offer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    minHeight: 72,
    backgroundColor: SURFACE,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: BORDER,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  offerActive: { borderColor: "#F2A33C" },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: "#F2A33C" },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: "#F2A33C" },
  offerBody: { flex: 1, gap: 3 },
  offerTitle: { color: TEXT, fontSize: 17, fontFamily: UI_FONT.bold, textAlign: READ },
  offerNote: { color: TEXT_FAINT, fontSize: 12.5, fontFamily: UI_FONT.regular, textAlign: READ },
  offerPriceWrap: { alignItems: "flex-end", gap: 2 },
  offerPrice: { color: TEXT, fontSize: 19, fontFamily: UI_FONT.bold },
  offerPeriod: { color: TEXT_FAINT, fontSize: 11.5, fontFamily: UI_FONT.regular },
  badge: {
    position: "absolute",
    top: -10,
    [READ === "right" ? "right" : "left"]: 20,
    backgroundColor: "#F2A33C",
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  badgeText: { color: BG, fontSize: 11, fontFamily: UI_FONT.bold },

  reassure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#24562B",
    borderWidth: 1.5,
    borderColor: "#347A3E",
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  reassureBody: { flex: 1, gap: 3 },
  reassureTitle: { color: TEXT, fontSize: 15, fontFamily: UI_FONT.bold, textAlign: READ },
  reassureLine: {
    color: "#D6E8D8",
    fontSize: 13,
    lineHeight: 21,
    fontFamily: UI_FONT.regular,
    textAlign: READ,
  },

  cta: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8EDF2",
    borderRadius: 20,
    minHeight: 62,
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: BG, fontSize: 18, fontFamily: UI_FONT.bold },

  trust: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  trustItem: { flex: 1, alignItems: "center", gap: 6 },
  trustText: {
    color: TEXT_FAINT,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
  },

  restore: { color: TEXT_SOFT, fontSize: 13.5, fontFamily: UI_FONT.medium, textAlign: "center" },
  renewal: {
    color: TEXT_FAINT,
    fontSize: 11,
    lineHeight: 19,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
  },
  legalRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  legalLink: {
    color: TEXT_SOFT,
    fontSize: 12,
    fontFamily: UI_FONT.regular,
    textDecorationLine: "underline",
  },
  legalDot: { color: TEXT_FAINT, fontSize: 12 },
});
