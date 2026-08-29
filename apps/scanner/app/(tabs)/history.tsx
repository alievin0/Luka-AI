import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Image, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack } from "../../src/packs";
import { locale, t } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import {
  FREE_HISTORY,
  getHistory,
  removeFromHistory,
  type HistoryEntry,
} from "../../src/storage";
import { isPro } from "../../src/purchases";
import { fill } from "../../src/i18n";
import {
  BG,
  SURFACE,
  SURFACE_HIGH,
  BORDER,
  TEXT,
  TEXT_FAINT,
  FONT,
  TYPE,
  SP,
  RADIUS,
  READ,
} from "../../src/scanner-ui";
import { SeverityDot, EmptyState, Caption, Pill } from "../../src/components/scanner-kit";
import { NAV_CLEARANCE } from "../../src/components/ScannerNav";
import { useTabToTop } from "../../src/tab-to-top";

/**
 * Every scan the driver has made.
 *
 * Photos that could not be read are kept here too. They cost nothing and they
 * are the ones a driver most often wants to come back to — a light that was
 * too dim to capture at the roadside can be photographed again in daylight,
 * and having the first attempt to hand says what to do differently.
 */
export default function History() {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [pro, setPro] = useState(false);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const list = useTabToTop<HistoryEntry>();

  /* Re-read on focus rather than once on mount. Someone who has just bought
     the subscription comes back to this screen from Apple's sheet, and a
     cached `false` would leave them looking at the lock they paid to remove. */
  useFocusEffect(
    useCallback(() => {
      getHistory().then(setEntries);
      isPro().then(setPro);
    }, []),
  );

  /* Only the cars actually present in the history, so the filter never offers
     a car with nothing behind it. Entries saved before the vehicle was
     recorded have none, and are handled below rather than listed here. */
  const vehicles = [...new Set(entries.map((e) => e.vehicle).filter(Boolean))] as string[];
  const filtered = vehicle
    ? entries.filter((e) => e.vehicle === vehicle || !e.vehicle)
    : entries;

  // The gate is on what a free reader can open, not on what the filter found:
  // filtering to two entries must not quietly unlock a third.
  const visible = pro ? filtered : filtered.slice(0, FREE_HISTORY);
  const locked = filtered.length - visible.length;

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <Text style={styles.title}>{t(ui.history)}</Text>

        {pro && vehicles.length > 1 ? (
          <View style={styles.filter}>
            <Pill label={t(ui.allVehicles)} active={vehicle === null} onPress={() => setVehicle(null)} />
            {vehicles.map((name) => (
              <Pill key={name} label={name} active={vehicle === name} onPress={() => setVehicle(name)} />
            ))}
          </View>
        ) : null}

        {entries.length === 0 ? (
          <EmptyState
            glyph="◷"
            title={t(ui.noScansYet)}
            body={t(pack.tagline)}
            action={t(ui.scanAgain)}
            onAction={() => router.replace("/")}
          />
        ) : (
          <FlatList
            ref={list}
            contentContainerStyle={styles.content}
            data={visible}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={<Caption>{t(ui.longPressDelete)}</Caption>}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const reading = item.result.detected ? item.result : null;
              const name = reading ? reading.title : t(ui.notDetectedTitle);
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                  onPress={() => router.push({ params: { id: item.id }, pathname: "/result" })}
                  accessibilityRole="button"
                  accessibilityLabel={name}
                  onLongPress={() =>
                    Alert.alert(t(ui.deleteScan), name, [
                      { text: t(ui.cancel), style: "cancel" },
                      {
                        text: t(ui.delete),
                        style: "destructive",
                        onPress: async () => setEntries(await removeFromHistory(item.id)),
                      },
                    ])
                  }
                >
                  {/* The glyph sits behind the photo rather than replacing
                      it on error: scans saved before photos were copied out
                      of the cache directory may have lost their file, and a
                      row with an empty square reads as a broken app. */}
                  <View style={styles.thumb}>
                    <Text style={styles.thumbGlyph}>▣</Text>
                    <Image source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, !reading && { color: TEXT_FAINT }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {new Date(item.at).toLocaleDateString(locale, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  </View>
                  {reading ? <SeverityDot severity={reading.severity} size={10} /> : null}
                </Pressable>
              );
            }}
            ListFooterComponent={
              locked > 0 ? (
                <Pressable
                  style={({ pressed }) => [styles.locked, pressed && { opacity: 0.85 }]}
                  onPress={() => router.push({ params: { after: "history" }, pathname: "/paywall" })}
                  accessibilityRole="button"
                  accessibilityLabel={`${fill(ui.moreScansLocked, { n: locked })} — ${t(ui.unlockHistory)}`}
                >
                  <View style={styles.lockGlyph}>
                    <Text style={styles.lockGlyphText}>◈</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{fill(ui.moreScansLocked, { n: locked })}</Text>
                    <Text style={styles.rowMeta}>{t(ui.unlockHistory)}</Text>
                  </View>
                </Pressable>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  fill: { flex: 1 },
  title: {
    color: TEXT,
    ...TYPE.title,
    fontFamily: FONT.bold,
    textAlign: READ,
    paddingHorizontal: SP.lg,
    paddingBottom: SP.md,
  },
  content: { paddingHorizontal: SP.lg, paddingBottom: NAV_CLEARANCE, gap: SP.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    backgroundColor: SURFACE,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: RADIUS.sm,
    backgroundColor: SURFACE_HIGH,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbGlyph: { color: TEXT_FAINT, fontSize: 18 },
  filter: { flexDirection: "row", flexWrap: "wrap", gap: SP.sm, paddingHorizontal: SP.lg, paddingBottom: SP.md },
  locked: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    backgroundColor: SURFACE,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
    padding: SP.md,
  },
  lockGlyph: {
    width: 54,
    height: 54,
    borderRadius: RADIUS.sm,
    backgroundColor: SURFACE_HIGH,
    alignItems: "center",
    justifyContent: "center",
  },
  lockGlyphText: { color: TEXT_FAINT, fontSize: 20 },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: TEXT, ...TYPE.body, fontFamily: FONT.semibold, textAlign: READ },
  rowMeta: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.regular, textAlign: READ },
});
