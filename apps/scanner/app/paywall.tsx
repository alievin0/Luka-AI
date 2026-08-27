import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack } from "../src/packs";
import { theme } from "../src/theme";
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
            title: product.label,
            price: product.fallbackPrice,
            period: product.period,
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
        Alert.alert("وضع تجريبي", "الشراء مش مفعّل بهالنسخة.");
        return;
      }
      if (await purchase(selected)) {
        router.back();
      } else {
        Alert.alert("ما تمت العملية", "ما انفعّل الاشتراك. جرّب كمان مرة.");
      }
    } catch {
      Alert.alert("ما تمت العملية", "انلغى الشراء أو صار خطأ.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <View style={styles.body}>
        <Text style={styles.headline}>{pack.paywall.headline}</Text>

        <View style={styles.bullets}>
          {pack.paywall.bullets.map((bullet) => (
            <View key={bullet} style={styles.bulletRow}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.bulletText}>{bullet}</Text>
            </View>
          ))}
        </View>

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
                          <Text style={styles.badgeText}>{configured.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    {configured?.note ? (
                      <Text style={styles.offerNote}>{configured.note}</Text>
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
            جرّب {trialDays} أيام مجاناً — بتقدر تلغي بأي وقت قبل ما ينتهي
          </Text>
        ) : null}

        {!purchasesAvailable() ? (
          <Text style={styles.devNote}>
            وضع تجريبي: ضيف مفاتيح RevenueCat واعمل dev build عشان يشتغل الشراء فعلياً.
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          style={[styles.cta, (!selected || working) && styles.ctaDisabled]}
          onPress={buy}
          disabled={!selected || working}
        >
          {working ? (
            <ActivityIndicator color="#0C0E13" />
          ) : (
            <Text style={styles.ctaText}>ابدأ الآن</Text>
          )}
        </Pressable>
        <Pressable onPress={() => restore()}>
          <Text style={styles.restore}>استعادة عملية شراء سابقة</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  close: { alignSelf: "flex-start", padding: 18 },
  closeText: { color: theme.textFaint, fontSize: 20 },
  body: { flex: 1, paddingHorizontal: 24 },
  headline: { color: theme.text, fontSize: 30, fontWeight: "800", lineHeight: 44 },
  bullets: { marginTop: 28, gap: 14 },
  bulletRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  check: { color: theme.accent, fontSize: 17, fontWeight: "700" },
  bulletText: { color: theme.textSoft, fontSize: 16, lineHeight: 27, flex: 1 },
  offers: { marginTop: 32, gap: 10 },
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
  offerTitle: { color: theme.text, fontSize: 16, fontWeight: "600" },
  offerNote: { color: theme.textFaint, fontSize: 12 },
  badge: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  badgeText: { color: theme.bg, fontSize: 10, fontWeight: "800" },
  trialLine: {
    color: theme.textSoft,
    fontSize: 13,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 22,
  },
  devNote: { color: theme.textFaint, fontSize: 12, textAlign: "center", marginTop: 10 },
  offerPrice: { color: theme.accent, fontSize: 17, fontWeight: "700" },
  notice: {
    marginTop: 32,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
  },
  noticeText: { color: theme.textFaint, fontSize: 14, lineHeight: 24 },
  footer: { padding: 24, gap: 14 },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 18,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: "#0C0E13", fontSize: 17, fontWeight: "700" },
  restore: { color: theme.textFaint, fontSize: 13, textAlign: "center" },
});
