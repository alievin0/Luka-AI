import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { t } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { theme } from "../src/theme";
import { KARATS, money, valuate } from "../src/gold";
import { getSpot, isStale, setSpot, type Spot } from "../src/gold-price";
import { currencyFor, getProfile } from "../src/storage";

const VERDICT = {
  fair: { key: ui.verdictFair, color: theme.info, bg: theme.infoBg },
  high: { key: ui.verdictHigh, color: theme.warning, bg: theme.warningBg },
  "very-high": { key: ui.verdictVeryHigh, color: theme.critical, bg: theme.criticalBg },
  "below-metal": { key: ui.verdictBelow, color: theme.warning, bg: theme.warningBg },
  unknown: null,
} as const;

export default function PriceCheck() {
  const [spot, setSpotState] = useState<Spot | null>(null);
  const [currency, setCurrency] = useState("$");
  const [rateInput, setRateInput] = useState("");
  const [weight, setWeight] = useState("");
  const [karat, setKarat] = useState(21);
  const [asking, setAsking] = useState("");

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setSpotState(await getSpot());
        setCurrency(currencyFor(await getProfile()));
      })();
    }, []),
  );

  const result = useMemo(() => {
    const w = parseFloat(weight);
    if (!spot || !Number.isFinite(w) || w <= 0) return null;
    const ask = parseFloat(asking);
    return valuate({
      weight: w,
      karat,
      spotPerGram: spot.perGram,
      askingPrice: Number.isFinite(ask) && ask > 0 ? ask : undefined,
    });
  }, [weight, karat, asking, spot]);

  const saveRate = async () => {
    const v = parseFloat(rateInput);
    if (!Number.isFinite(v) || v <= 0) return;
    setSpotState(await setSpot(v, currency));
    setRateInput("");
  };

  const stale = isStale(spot);
  const verdict = result ? VERDICT[result.verdict] : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.card, stale && styles.cardWarn]}>
        <Text style={styles.label}>{t(ui.todaysRate)}</Text>
        {spot ? (
          <Text style={styles.rate}>
            {money(spot.perGram)} {spot.currency}{" "}
            <Text style={styles.rateUnit}>{t(ui.perGram24k)}</Text>
          </Text>
        ) : null}
        {stale ? <Text style={styles.warnText}>{t(ui.rateStale)}</Text> : null}
        <View style={styles.rateRow}>
          <TextInput
            style={styles.input}
            value={rateInput}
            onChangeText={setRateInput}
            keyboardType="decimal-pad"
            placeholder={`0.00 ${currency}`}
            placeholderTextColor={theme.textFaint}
          />
          <Pressable style={styles.rateButton} onPress={saveRate}>
            <Text style={styles.rateButtonText}>{t(ui.setRate)}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t(ui.weightGrams)}</Text>
        <TextInput
          style={styles.input}
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          placeholder="0.0"
          placeholderTextColor={theme.textFaint}
        />

        <Text style={[styles.label, { marginTop: 14 }]}>{t(ui.karat)}</Text>
        <View style={styles.karats}>
          {KARATS.map((k) => (
            <Pressable
              key={k}
              style={[styles.karat, karat === k && styles.karatActive]}
              onPress={() => setKarat(k)}
            >
              <Text style={[styles.karatText, karat === k && styles.karatTextActive]}>
                {k}K
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 14 }]}>
          {t(ui.askingPrice)} <Text style={styles.faint}>· {t(ui.optional)}</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={asking}
          onChangeText={setAsking}
          keyboardType="decimal-pad"
          placeholder={`0.00 ${currency}`}
          placeholderTextColor={theme.textFaint}
        />
      </View>

      {!spot ? (
        <Text style={styles.hint}>{t(ui.enterRateFirst)}</Text>
      ) : result ? (
        <>
          {verdict ? (
            <View style={[styles.verdict, { backgroundColor: verdict.bg, borderColor: verdict.color }]}>
              <Text style={[styles.verdictText, { color: verdict.color }]}>
                {t(verdict.key)}
              </Text>
              {result.makingPercent !== null ? (
                <Text style={styles.verdictPercent}>
                  {t(ui.makingCharge)}: {money(result.makingCharge ?? 0)} {currency} ·{" "}
                  {Math.round(result.makingPercent)}% {t(ui.ofGoldValue)}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.card}>
            <Row label={t(ui.pureGoldIn)} value={`${result.goldGrams.toFixed(2)} g`} />
            <Row label={t(ui.metalValue)} value={`${money(result.metalValue)} ${currency}`} strong />
            <Row label={t(ui.sellBackToday)} value={`${money(result.scrapValue)} ${currency}`} />
          </View>
        </>
      ) : null}

      <Text style={styles.disclaimer}>{t(ui.goldDisclaimer)}</Text>
    </ScrollView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 8,
  },
  cardWarn: { borderColor: theme.warning },
  label: { color: theme.textFaint, fontSize: 13, fontWeight: "600" },
  faint: { color: theme.textFaint, fontWeight: "400" },
  rate: { color: theme.accent, fontSize: 26, fontWeight: "800" },
  rateUnit: { color: theme.textFaint, fontSize: 13, fontWeight: "400" },
  warnText: { color: theme.warning, fontSize: 13 },
  rateRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    color: theme.text,
    fontSize: 17,
    textAlign: "right",
  },
  rateButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  rateButtonText: { color: theme.bg, fontSize: 15, fontWeight: "700" },
  karats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  karat: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "transparent",
  },
  karatActive: { backgroundColor: theme.accent },
  karatText: { color: theme.textSoft, fontSize: 15, fontWeight: "600" },
  karatTextActive: { color: theme.bg },
  verdict: { borderWidth: 1, borderRadius: theme.radius, padding: 16, gap: 6 },
  verdictText: { fontSize: 18, fontWeight: "700", lineHeight: 28 },
  verdictPercent: { color: theme.textSoft, fontSize: 14 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  rowLabel: { color: theme.textSoft, fontSize: 15 },
  rowValue: { color: theme.text, fontSize: 16, fontVariant: ["tabular-nums"] },
  rowValueStrong: { color: theme.accent, fontSize: 19, fontWeight: "800" },
  hint: { color: theme.textFaint, fontSize: 14, textAlign: "center", paddingVertical: 20 },
  disclaimer: {
    color: theme.textFaint,
    fontSize: 12,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 10,
  },
});
