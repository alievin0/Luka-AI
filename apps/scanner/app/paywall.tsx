import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack, bulletText, bulletGlyph } from "../src/packs";
import { t, fill } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { UI_FONT } from "../src/ui-font";
import { theme } from "../src/theme";
import { privacyUrl, supportUrl, termsUrl } from "../src/legal";
import { getOffers, purchase, purchasesAvailable, restore, type Offer } from "../src/purchases";

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

  const trialDays = pack.pricing.products.find((p) => p.id === selected)?.trialDays;

  const buy = async () => {
    if (!selected) return;
    setWorking(true);
    try {
      if (!purchasesAvailable()) {
        Alert.alert(t(ui.devMode), t(ui.purchaseOffBody));
        return;
      }
      if (await purchase(selected)) {
        router.back();
      } else {
        Alert.alert(t(ui.purchaseFailed), t(ui.purchaseFailedBody));
      }
    } catch {
      Alert.alert(t(ui.purchaseFailed), t(ui.purchaseCancelled));
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headline}>{t(pack.paywall.headline)}</Text>

        <View style={styles.bullets}>
          {pack.paywall.bullets.map((bullet) => (
            <View key={t(bulletText(bullet))} style={styles.bulletRow}>
              <Text style={styles.check}>{bulletGlyph(bullet)}</Text>
              <Text style={styles.bulletText}>{t(bulletText(bullet))}</Text>
            </View>
          ))}
        </View>


      </ScrollView>

      {/* The plan choice and the button that acts on it stay together and
          stay on screen. Above the fold is the argument; this is the decision,
          and a driver should never have to scroll to find half of it. */}
      <View style={styles.footer}>
        {offers.length === 0 ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} />
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
                >
                  <View style={styles.offerBody}>
                    <View style={styles.offerTitleRow}>
                      <Text style={styles.offerTitle}>{offer.title}</Text>
                      {configured?.badge ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{t(configured.badge)}</Text>
                        </View>
                      ) : null}
                    </View>
                    {configured?.note ? (
                      <Text style={styles.offerNote}>{t(configured.note)}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.offerPrice}>{offer.price}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {trialDays ? (
          <Text style={styles.trialLine}>
            {t(ui.trialLine).replace("{n}", String(trialDays))}
          </Text>
        ) : null}

        <Pressable
          style={[styles.cta, (!selected || working) && styles.ctaDisabled]}
          onPress={buy}
          disabled={!selected || working}
        >
          {working ? (
            <ActivityIndicator color={theme.onAction} />
          ) : (
            <Text style={styles.ctaText}>
              {trialDays ? fill(ui.startTrialDays, { n: trialDays }) : t(ui.subscribeNow)}
            </Text>
          )}
        </Pressable>
        <Pressable onPress={() => restore()}>
          <Text style={styles.restore}>{t(ui.restorePrior)}</Text>
        </Pressable>

        {/* Apple wants the renewal terms and both links on the purchase screen
            itself, not only in a document linked from somewhere else. */}
        <Text style={styles.renewal}>{t(ui.renewalTerms)}</Text>
        <View style={styles.legalRow}>
          <Pressable onPress={() => Linking.openURL(termsUrl()).catch(() => undefined)} hitSlop={8}>
            <Text style={styles.legalLink}>{t(ui.terms)}</Text>
          </Pressable>
          <Text style={styles.legalDot}>·</Text>
          <Pressable onPress={() => Linking.openURL(privacyUrl()).catch(() => undefined)} hitSlop={8}>
            <Text style={styles.legalLink}>{t(ui.privacyPolicy)}</Text>
          </Pressable>
          <Text style={styles.legalDot}>·</Text>
          <Pressable onPress={() => Linking.openURL(supportUrl()).catch(() => undefined)} hitSlop={8}>
            <Text style={styles.legalLink}>{t(ui.support)}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  close: { alignSelf: "flex-start", padding: 18 },
  closeText: { color: theme.textFaint, fontSize: 20 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 24, paddingBottom: 24 },
  headline: { color: theme.text, fontSize: 30, fontFamily: UI_FONT.bold, lineHeight: 44 },
  bullets: { marginTop: 28, gap: 14 },
  bulletRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  check: { color: theme.accent, fontSize: 17, fontFamily: UI_FONT.bold },
  bulletText: { color: theme.textSoft, fontSize: 16, fontFamily: UI_FONT.regular, lineHeight: 27, flex: 1 },
  offers: { gap: 10 },
  offer: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1.5,
    borderColor: theme.border,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  offerActive: { borderColor: theme.accent, backgroundColor: theme.surfaceAlt },
  offerBody: { flex: 1, gap: 3 },
  offerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  offerTitle: { color: theme.text, fontSize: 16, fontFamily: UI_FONT.medium },
  offerNote: { color: theme.textFaint, fontSize: 12 },
  badge: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  badgeText: { color: theme.bg, fontSize: 10, fontFamily: UI_FONT.bold },
  trialLine: {
    color: theme.textSoft,
    fontSize: 13,
    fontFamily: UI_FONT.regular,
    textAlign: "center",
    lineHeight: 22,
  },
  offerPrice: { color: theme.text, fontSize: 17, fontFamily: UI_FONT.bold },
  notice: {
    marginTop: 32,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
  },
  noticeText: { color: theme.textFaint, fontSize: 14, fontFamily: UI_FONT.regular, lineHeight: 24 },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  cta: {
    backgroundColor: theme.action,
    borderRadius: theme.radius,
    minHeight: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: theme.onAction, fontSize: 17, fontFamily: UI_FONT.bold },
  renewal: {
    color: theme.textFaint,
    fontSize: 11, fontFamily: UI_FONT.regular,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 14,
  },
  legalRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  legalLink: { color: theme.textSoft, fontSize: 12, fontFamily: UI_FONT.regular, textDecorationLine: "underline" },
  legalDot: { color: theme.textFaint, fontSize: 12 },
  restore: { color: theme.textFaint, fontSize: 13, fontFamily: UI_FONT.regular, textAlign: "center" },
});
