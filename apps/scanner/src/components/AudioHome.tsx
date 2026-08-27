import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { t, locale } from "../i18n";
import { ui } from "../i18n/ui";
import { GOLD, INK, READ, READ_END } from "./audio-theme";
import type { AudioPack, Lecture } from "../packs";
import { getLectures, lectureAllowed } from "../lectures";

/**
 * Mahdar's home screen, laid out to match the existing web product: the
 * wordmark and language pill centred at the top, the badge, the headline set
 * large, the two actions side by side, then the lecture list — or the quiet
 * hall when there is nothing yet.
 */
export function AudioHome({ pack }: { pack: AudioPack }) {
  const router = useRouter();
  const [lectures, setLectures] = useState<Lecture[]>([]);

  /** The free tier is counted on lectures ever recorded, not lectures kept,
   *  so deleting one doesn't buy another. The count is spent when a lecture
   *  is actually saved, not here: a denied microphone or a student who backs
   *  out of the record screen would otherwise burn the only free lecture
   *  without ever producing one. */
  const startLecture = async () => {
    if (await lectureAllowed()) router.push("/record");
    else router.push("/paywall");
  };

  useFocusEffect(
    useCallback(() => {
      getLectures().then(setLectures);
    }, []),
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.wordmarkWrap}>
            <Pressable
              style={styles.langPill}
              onPress={() => router.push("/settings")}
              hitSlop={6}
            >
              <Text style={styles.langText}>{locale === "ar" ? "EN" : "ع"}</Text>
            </Pressable>
            <Text style={styles.wordmarkLatin}>{pack.wordmark}</Text>
            <Text style={styles.wordmarkDot}>•</Text>
            <Text style={styles.wordmarkArabic}>{t(pack.appName)}</Text>
          </View>

          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>{t(pack.badge)}</Text>
          </View>

          <Text style={styles.headline}>{t(pack.headline)}</Text>
          <Text style={styles.intro}>{t(pack.intro)}</Text>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={startLecture}
            >
              <Text style={styles.primaryGlyph}>◉</Text>
              <Text style={styles.primaryText}>{t(pack.primaryAction)}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => router.push("/paste")}
            >
              <Text style={styles.secondaryGlyph}>▤</Text>
              <Text style={styles.secondaryText}>{t(pack.secondaryAction)}</Text>
            </Pressable>
          </View>

          {lectures.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t(pack.emptyTitle)}</Text>
              <Text style={styles.emptyBody}>{t(pack.emptyBody)}</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {lectures.map((lecture) => (
                <Pressable
                  key={lecture.id}
                  style={styles.row}
                  onPress={() =>
                    router.push({ pathname: "/lecture", params: { id: lecture.id } })
                  }
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {lecture.title}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {new Date(lecture.at).toLocaleDateString(locale)} ·{" "}
                      {Math.round(lecture.duration / 60)} {t(ui.minutes)}
                    </Text>
                  </View>
                  {lecture.status !== "ready" ? (
                    <View style={styles.statusPill}>
                      <Text style={styles.statusText}>
                        {lecture.status === "processing"
                          ? t(ui.processing)
                          : lecture.status === "failed"
                            ? t(ui.failed)
                            : t(ui.recording)}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.disclaimer}>{t(pack.disclaimer)}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}



const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  safe: { flex: 1 },
  content: { paddingHorizontal: 24, paddingBottom: 56, paddingTop: 8 },

  wordmarkWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    alignSelf: "center",
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  langPill: {
    borderWidth: 1,
    borderColor: "#3A3324",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 14,
  },
  langText: { color: "#C9BC9A", fontSize: 12, letterSpacing: 1.5, fontWeight: "600" },
  wordmarkLatin: { color: "#B8A87E", fontSize: 13, letterSpacing: 3, fontWeight: "500" },
  wordmarkDot: { color: GOLD, fontSize: 13 },
  wordmarkArabic: { color: GOLD, fontSize: 22, fontWeight: "700" },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: READ_END,
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 34,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  badgeText: { color: "#C9BC9A", fontSize: 13 },

  headline: {
    color: "#F5EEDF",
    fontSize: 46,
    fontWeight: "800",
    lineHeight: 66,
    marginTop: 26,
    textAlign: READ,
  },
  intro: {
    color: "#9C9382",
    fontSize: 16,
    lineHeight: 32,
    marginTop: 22,
    textAlign: READ,
  },

  actions: { flexDirection: "row", gap: 12, marginTop: 34, justifyContent: READ_END },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 26,
  },
  primaryGlyph: { color: INK, fontSize: 15 },
  primaryText: { color: INK, fontSize: 16, fontWeight: "700" },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 22,
  },
  secondaryGlyph: { color: "#C9BC9A", fontSize: 15 },
  secondaryText: { color: "#E8E0CE", fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.85 },

  empty: {
    backgroundColor: "#141209",
    borderWidth: 1,
    borderColor: "#241F14",
    borderRadius: 22,
    paddingVertical: 60,
    paddingHorizontal: 28,
    marginTop: 34,
    alignItems: "center",
    gap: 16,
  },
  emptyTitle: { color: "#E8E0CE", fontSize: 30, fontWeight: "700" },
  emptyBody: {
    color: "#8E8676",
    fontSize: 15,
    lineHeight: 28,
    textAlign: "center",
  },

  list: { marginTop: 30, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#141209",
    borderWidth: 1,
    borderColor: "#241F14",
    borderRadius: 16,
    padding: 16,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { color: "#E8E0CE", fontSize: 16, fontWeight: "600" },
  rowMeta: { color: "#8E8676", fontSize: 13 },
  statusPill: {
    backgroundColor: "#241F14",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  statusText: { color: GOLD, fontSize: 11, fontWeight: "700" },

  disclaimer: {
    color: "#6E685C",
    fontSize: 12,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 34,
  },
});
