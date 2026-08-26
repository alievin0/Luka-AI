import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack } from "../src/scanners";
import { theme } from "../src/theme";
import { getOffers, purchase, purchasesAvailable, restore, type Offer } from "../src/purchases";

export default function Paywall() {
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    (async () => {
      const available = await getOffers();
      setOffers(available);
      setSelected(available[0]?.id ?? null);
    })();
  }, []);

  const buy = async () => {
    if (!selected) return;
    setWorking(true);
    try {
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

        {!purchasesAvailable() ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              الاشتراكات مش مفعّلة بهالنسخة. ضيف مفاتيح RevenueCat واعمل dev build
              عشان تظهر الأسعار وتشتغل عملية الشراء.
            </Text>
          </View>
        ) : offers.length === 0 ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} />
        ) : (
          <View style={styles.offers}>
            {offers.map((offer) => (
              <Pressable
                key={offer.id}
                style={[styles.offer, selected === offer.id && styles.offerActive]}
                onPress={() => setSelected(offer.id)}
              >
                <Text style={styles.offerTitle}>{offer.title}</Text>
                <Text style={styles.offerPrice}>{offer.price}</Text>
              </Pressable>
            ))}
          </View>
        )}
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
  offerTitle: { color: theme.text, fontSize: 16, fontWeight: "600" },
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
