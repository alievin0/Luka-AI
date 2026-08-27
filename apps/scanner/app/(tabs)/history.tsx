import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Image, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack } from "../../src/packs";
import { locale, t } from "../../src/i18n";
import { ui } from "../../src/i18n/ui";
import { getHistory, removeFromHistory, type HistoryEntry } from "../../src/storage";
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
import { SeverityDot, EmptyState, Caption } from "../../src/components/scanner-kit";
import { NAV_CLEARANCE } from "../../src/components/ScannerNav";

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

  useFocusEffect(
    useCallback(() => {
      getHistory().then(setEntries);
    }, []),
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <Text style={styles.title}>{t(ui.history)}</Text>

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
            contentContainerStyle={styles.content}
            data={entries}
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
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: TEXT, ...TYPE.body, fontFamily: FONT.semibold, textAlign: READ },
  rowMeta: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.regular, textAlign: READ },
});
