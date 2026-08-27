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
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Feather from "@expo/vector-icons/Feather";
import { pack, bulletText, bulletDetail, bulletIcon, bulletGlyph } from "../src/packs";
import { t, fill } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { UI_FONT } from "../src/ui-font";
import { theme } from "../src/theme";
import { GRADE, READ, BACK } from "../src/scanner-ui";
import { privacyUrl, supportUrl, termsUrl } from "../src/legal";
import { getOffers, purchase, purchasesAvailable, restore, type Offer } from "../src/purchases";

/**
 * The purchase screen.
 *
 * Its job is to answer the same question the app answers, one level up: a
 * driver is deciding whether this is worth carrying before the next time a
 * light comes on. So it opens with the fear, shows the three answers the
 * product gives, and only then asks for money.
 *
 * The one rule enforced in code rather than copy: a trial is only ever
 * offered for a plan that has one. An annual plan sitting under "start your
 * 3-day trial" when the trial belongs to the weekly plan is a false claim on
 * a purchase screen — the kind App Review rejects and, worse, the kind a
 * buyer discovers on their statement.
 */
export default function Paywall() {
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    (async () => {
      const live = await getOffers();
      // Fall back to the pack's configured pricing so the paywall is always
      // a real screen — in dev, and if offerings fail to load on a bad network.
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

  return (
    <View style={styles.root}>
      {/* A night road, drawn rather than photographed. A stock photo of
          someone else's car would be decoration pretending to be evidence. */}
      <LinearGradient
        colors={["#1A1206", "#12131A", theme.bg]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Pressable
          style={styles.close}
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t(ui.cancel)}
        >
          <Feather name="x" size={22} color={theme.textSoft} />
        </Pressable>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.headline}>{t(pack.paywall.headline)}</Text>
          <Text style={styles.sub}>{t(ui.paywallSub)}</Text>

          {/* The severity language, met here first rather than at the
              roadside. Three cards, three colours, three sentences. */}
          <View style={styles.grades}>
            <GradeCard
              tone="critical"
              icon="octagon"
              title={t(ui.cardStopTitle)}
              line={t(ui.cardStopLine)}
            />
            <GradeCard
              tone="warning"
              icon="alert-triangle"
              title={t(ui.cardCautionTitle)}
              line={t(ui.cardCautionLine)}
            />
            <GradeCard
              tone="info"
              icon="check-circle"
              title={t(ui.cardOkTitle)}
              line={t(ui.cardOkLine)}
            />
          </View>

          <View style={styles.benefits}>
            <Text style={styles.benefitsTitle}>{t(ui.youGet)}</Text>
            <View style={styles.benefitRow}>
              {pack.paywall.bullets.map((bullet) => {
                const icon = bulletIcon(bullet);
                const detail = bulletDetail(bullet);
                return (
                  <View key={t(bulletText(bullet))} style={styles.benefit}>
                    {icon ? (
                      <Feather
                        name={icon as React.ComponentProps<typeof Feather>["name"]}
                        size={20}
                        color={theme.accent}
                      />
                    ) : (
                      <Text style={styles.benefitGlyph}>{bulletGlyph(bullet)}</Text>
                    )}
                    <Text style={styles.benefitTitle}>{t(bulletText(bullet))}</Text>
                    {detail ? <Text style={styles.benefitDetail}>{t(detail)}</Text> : null}
                  </View>
                );
              })}
            </View>
          </View>

          {offers.length === 0 ? (
            <ActivityIndicator color={theme.textSoft} style={styles.loading} />
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
                      <View style={styles.ribbon}>
                        <Text style={styles.ribbonText}>{t(configured.badge)}</Text>
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
              <Feather name="shield" size={20} color={GRADE.info.fg} />
              <View style={styles.reassureBody}>
                <Text style={styles.reassureTitle}>
                  {fill(ui.trialSafeTitle, { n: trialDays })}
                </Text>
                <Text style={styles.reassureLine}>{t(ui.trialSafeBody)}</Text>
              </View>
            </View>
          ) : null}

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
              <ActivityIndicator color={theme.bg} />
            ) : (
              <>
                <Text style={styles.ctaText}>
                  {trialDays ? fill(ui.startTrialDays, { n: trialDays }) : t(ui.subscribeNow)}
                </Text>
                <Text style={styles.ctaChevron}>{BACK === "‹" ? "›" : "‹"}</Text>
              </>
            )}
          </Pressable>

          <View style={styles.trust}>
            <Trust icon="rotate-ccw" label={t(ui.trustCancel)} />
            <Trust icon="headphones" label={t(ui.trustArabic)} />
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

/** One of the three answers the product gives, in its own colour. */
function GradeCard({
  tone,
  icon,
  title,
  line,
}: {
  tone: keyof typeof GRADE;
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  line: string;
}) {
  const grade = GRADE[tone];
  return (
    <View style={[styles.grade, { borderColor: grade.line, backgroundColor: grade.bg }]}>
      <Text style={[styles.gradeTitle, { color: grade.fg }]} numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.gradeMark}>
        <Feather name={icon} size={34} color={grade.fg} />
        {tone === "critical" ? (
          <Text style={[styles.gradeStop, { color: grade.fg }]}>STOP</Text>
        ) : null}
      </View>
      <Text style={styles.gradeLine} numberOfLines={2}>
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
      <Feather name={icon} size={14} color={theme.textFaint} />
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
  root: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1 },
  close: { alignSelf: "flex-start", padding: 16 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 20 },

  headline: {
    color: theme.text,
    fontSize: 30,
    lineHeight: 46,
    fontFamily: UI_FONT.bold,
    textAlign: "center",
  },
  sub: {
    color: theme.textSoft,
    fontSize: 15,
    lineHeight: 26,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
  },

  grades: { flexDirection: "row", gap: 8 },
  grade: {
    flex: 1,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  gradeTitle: { fontSize: 12, lineHeight: 17, fontFamily: UI_FONT.bold, textAlign: "center" },
  gradeMark: { alignItems: "center", justifyContent: "center" },
  gradeStop: { position: "absolute", fontSize: 9, fontFamily: UI_FONT.bold, letterSpacing: 0.2 },
  gradeLine: {
    color: theme.text,
    fontSize: 12,
    lineHeight: 20,
    fontFamily: UI_FONT.medium,
    textAlign: "center",
  },

  benefits: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  benefitsTitle: {
    color: theme.text,
    fontSize: 16,
    fontFamily: UI_FONT.bold,
    textAlign: READ,
  },
  /* Wraps rather than squeezing: five items across a small phone would give
     each about sixty points, and a benefit nobody can read is not one. */
  benefitRow: { flexDirection: "row", flexWrap: "wrap", rowGap: 18, columnGap: 8 },
  benefit: { flexGrow: 1, flexBasis: "28%", minWidth: 92, alignItems: "center", gap: 6 },
  benefitGlyph: { color: theme.accent, fontSize: 18 },
  benefitTitle: {
    color: theme.text,
    fontSize: 12.5,
    fontFamily: UI_FONT.bold,
    textAlign: "center",
  },
  benefitDetail: {
    color: theme.textFaint,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
  },

  loading: { marginVertical: 24 },
  offers: { gap: 10 },
  offer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 76,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  offerActive: { borderColor: theme.accent, backgroundColor: theme.surfaceAlt },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: theme.accent },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.accent },
  offerBody: { flex: 1, gap: 3 },
  offerTitle: { color: theme.text, fontSize: 18, fontFamily: UI_FONT.bold },
  offerNote: { color: theme.textFaint, fontSize: 12, fontFamily: UI_FONT.regular },
  offerPriceWrap: { alignItems: "flex-end", gap: 2 },
  offerPrice: { color: theme.text, fontSize: 22, fontFamily: UI_FONT.bold },
  offerPeriod: { color: theme.textFaint, fontSize: 11, fontFamily: UI_FONT.regular },
  ribbon: {
    position: "absolute",
    top: -9,
    [READ === "right" ? "right" : "left"]: 16,
    backgroundColor: theme.accent,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  ribbonText: { color: theme.bg, fontSize: 10.5, fontFamily: UI_FONT.bold },

  reassure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: GRADE.info.bg,
    borderWidth: 1,
    borderColor: GRADE.info.line,
    borderRadius: 14,
    padding: 14,
  },
  reassureBody: { flex: 1, gap: 3 },
  reassureTitle: { color: theme.text, fontSize: 14.5, fontFamily: UI_FONT.bold, textAlign: READ },
  reassureLine: {
    color: theme.textSoft,
    fontSize: 12.5,
    lineHeight: 21,
    fontFamily: UI_FONT.regular,
    textAlign: READ,
  },

  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: theme.accent,
    borderRadius: 16,
    minHeight: 60,
  },
  ctaOff: { opacity: 0.45 },
  ctaText: { color: theme.bg, fontSize: 18, fontFamily: UI_FONT.bold },
  ctaChevron: { color: theme.bg, fontSize: 20, fontFamily: UI_FONT.bold },

  trust: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  trustItem: { flex: 1, alignItems: "center", gap: 5 },
  trustText: {
    color: theme.textFaint,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
  },

  restore: {
    color: theme.textSoft,
    fontSize: 13,
    fontFamily: UI_FONT.medium,
    textAlign: "center",
  },
  renewal: {
    color: theme.textFaint,
    fontSize: 11,
    lineHeight: 19,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
  },
  legalRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  legalLink: {
    color: theme.textSoft,
    fontSize: 12,
    fontFamily: UI_FONT.regular,
    textDecorationLine: "underline",
  },
  legalDot: { color: theme.textFaint, fontSize: 12 },
});
