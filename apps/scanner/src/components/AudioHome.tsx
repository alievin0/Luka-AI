import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Easing,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { t, locale } from "../i18n";
import { ui } from "../i18n/ui";
import {
  GOLD,
  GOLD_BRIGHT,
  GOLD_DEEP,
  INK,
  BLOOM,
  PANEL_GRADIENT,
  PANEL_BORDER,
  HAIRLINE,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  READ,
  READ_END,
  glow,
  lift,
  audio as s,
} from "./audio-theme";
import { FONTS } from "../type";
import type { AudioPack, Lecture } from "../packs";
import { getLectures, lectureAllowed, clock, scoreEnergy } from "../lectures";

/**
 * Mahdar's home screen.
 *
 * Laid out like the web product — wordmark centred, badge, headline set
 * large, two actions, then the lectures — but built on a lit surface rather
 * than flat fills, and with the lecture rows carrying the shape of the
 * lecture itself rather than a line of metadata.
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

  /* One entrance, once. The hero settles into place rather than appearing
   * fully formed, which is the difference between a screen that was designed
   * and one that was assembled. */
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 620,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const rise = (distance: number) => ({
    opacity: enter,
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
    ],
  });

  return (
    <View style={s.root}>
      {/* The lamp: a warm bloom at the top that the whole screen sits under. */}
      <LinearGradient colors={BLOOM} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={s.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View style={rise(-8)}>
            <View style={s.wordmarkWrap}>
              <Pressable style={s.langPill} onPress={() => router.push("/settings")} hitSlop={6}>
                <Text style={s.langText}>{locale === "ar" ? "EN" : "ع"}</Text>
              </Pressable>
              <Text style={s.wordmarkLatin}>{pack.wordmark}</Text>
              <Text style={s.wordmarkDot}>◆</Text>
              <Text style={s.wordmarkArabic}>{t(pack.appName)}</Text>
            </View>
          </Animated.View>

          <Animated.View style={rise(16)}>
            <View style={styles.badge}>
              <View style={styles.badgeDot} />
              <Text style={styles.badgeText}>{t(pack.badge)}</Text>
            </View>

            <Text style={styles.headline}>{t(pack.headline)}</Text>
            <View style={styles.rule} />
            <Text style={styles.intro}>{t(pack.intro)}</Text>
          </Animated.View>

          <Animated.View style={[styles.actions, rise(24)]}>
            <Pressable
              style={({ pressed }) => [styles.primaryWrap, pressed && s.pressed]}
              onPress={startLecture}
            >
              <LinearGradient
                colors={[GOLD_BRIGHT, GOLD, GOLD_DEEP]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primary}
              >
                <View style={styles.recDot} />
                <Text style={styles.primaryText}>{t(pack.primaryAction)}</Text>
              </LinearGradient>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && s.pressed]}
              onPress={() => router.push("/paste")}
            >
              <Text style={styles.secondaryGlyph}>❝</Text>
              <Text style={styles.secondaryText}>{t(pack.secondaryAction)}</Text>
            </Pressable>
          </Animated.View>

          {lectures.length === 0 ? (
            <EmptyHall pack={pack} style={rise(32)} />
          ) : (
            <Animated.View style={[styles.list, rise(32)]}>
              <View style={styles.listHead}>
                <Text style={styles.listLabel}>{t(ui.pastScans)}</Text>
                <View style={styles.listRule} />
                <Text style={styles.listCount}>{lectures.length}</Text>
              </View>
              {lectures.map((lecture) => (
                <LectureRow
                  key={lecture.id}
                  lecture={lecture}
                  onPress={() =>
                    router.push({ pathname: "/lecture", params: { id: lecture.id } })
                  }
                />
              ))}
            </Animated.View>
          )}

          <Text style={styles.disclaimer}>{t(pack.disclaimer)}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * The quiet hall.
 *
 * A large empty box reads as something failing to load. A drawn room — rows
 * of empty seats under the lamp — reads as a room waiting to be used, which
 * is what this state actually is.
 */
function EmptyHall({ pack, style }: { pack: AudioPack; style: object }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const seats = [0, 1, 2];

  return (
    <Animated.View style={style}>
      <View style={[styles.empty, lift]}>
        <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />

        <View style={styles.hall}>
          {seats.map((row) => (
            <View key={row} style={[styles.seatRow, { opacity: 0.9 - row * 0.24 }]}>
              {Array.from({ length: 5 - row }).map((_, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.seat,
                    {
                      width: 26 - row * 2,
                      opacity: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.35, 0.75],
                      }),
                    },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>

        <Text style={styles.emptyTitle}>{t(pack.emptyTitle)}</Text>
        <Text style={styles.emptyBody}>{t(pack.emptyBody)}</Text>
      </View>
    </Animated.View>
  );
}

/**
 * One lecture in the list.
 *
 * The bars are the lecture's own loudness, sampled across its length — so the
 * row shows where the lecturer got loud before it is opened. A row that is
 * only a title and a date tells a student nothing they did not already know.
 */
function LectureRow({ lecture, onPress }: { lecture: Lecture; onPress: () => void }) {
  const bars = useMemo(() => {
    const scored = scoreEnergy(lecture.segments).filter((seg) => seg.text.trim());
    if (scored.length === 0) return [];
    const BARS = 22;
    const step = Math.max(1, Math.floor(scored.length / BARS));
    return Array.from({ length: Math.min(BARS, scored.length) }, (_, i) => {
      const slice = scored.slice(i * step, (i + 1) * step);
      const peak = slice.reduce((top, seg) => Math.max(top, seg.emphasis), 0);
      return { height: 4 + peak * 16, hot: peak >= 0.5 };
    });
  }, [lecture.segments]);

  const pending = lecture.status !== "ready";
  const failed = lecture.status === "failed";

  return (
    <Pressable style={({ pressed }) => [styles.row, lift, pressed && s.pressed]} onPress={onPress}>
      <LinearGradient colors={PANEL_GRADIENT} style={StyleSheet.absoluteFill} />

      <View style={styles.rowTop}>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {lecture.title || t(ui.untitledLecture)}
          </Text>
          <Text style={styles.rowMeta}>
            {new Date(lecture.at).toLocaleDateString(locale, { day: "numeric", month: "long" })}
            {"  ·  "}
            {clock(lecture.duration)}
            {lecture.analysis?.tasks.length
              ? `  ·  ${lecture.analysis.tasks.length} ${t(ui.tasksCount)}`
              : ""}
          </Text>
        </View>

        {pending ? (
          <View style={[styles.statusPill, failed && styles.statusPillBad]}>
            <Text style={[styles.statusText, failed && styles.statusTextBad]}>
              {failed
                ? t(ui.failed)
                : lecture.status === "processing"
                  ? t(ui.processing)
                  : t(ui.recording)}
            </Text>
          </View>
        ) : (
          <Text style={styles.rowChevron}>{locale === "ar" ? "‹" : "›"}</Text>
        )}
      </View>

      {bars.length > 0 ? (
        <View style={styles.wave}>
          {bars.map((bar, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                { height: bar.height },
                bar.hot && styles.waveBarHot,
              ]}
            />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingBottom: 60, paddingTop: 6 },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: READ_END,
    backgroundColor: "rgba(32,27,18,0.7)",
    borderWidth: 1,
    borderColor: "#332B1C",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 13,
    marginTop: 38,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
  badgeText: { color: "#BBAE90", fontSize: 12.5, fontFamily: FONTS.body },

  headline: {
    color: TEXT,
    fontSize: 40,
    lineHeight: 62,
    marginTop: 22,
    textAlign: READ,
    fontFamily: FONTS.display,
    letterSpacing: -0.3,
  },
  rule: {
    height: 1,
    width: 54,
    backgroundColor: GOLD_DEEP,
    opacity: 0.55,
    marginTop: 20,
    alignSelf: READ_END,
  },
  intro: {
    color: TEXT_SOFT,
    fontSize: 15,
    lineHeight: 33,
    marginTop: 18,
    textAlign: READ,
    fontFamily: FONTS.body,
  },

  actions: { flexDirection: "row", gap: 10, marginTop: 32, justifyContent: READ_END },
  primaryWrap: { borderRadius: 999, ...glow(GOLD, 22, 0.3) },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 999,
    paddingVertical: 17,
    paddingHorizontal: 24,
  },
  recDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#8C2F22",
  },
  primaryText: { color: "#17130A", fontSize: 15, fontFamily: FONTS.displayBold },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(28,24,16,0.86)",
    borderWidth: 1,
    borderColor: "#332B1C",
    borderRadius: 999,
    paddingVertical: 17,
    paddingHorizontal: 20,
  },
  secondaryGlyph: { color: GOLD_DEEP, fontSize: 15, marginTop: 4 },
  secondaryText: { color: "#DED3BB", fontSize: 15, fontFamily: FONTS.bodyMedium },

  /* ------------------------------------------------------------ empty hall */
  empty: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 24,
    paddingVertical: 46,
    paddingHorizontal: 26,
    marginTop: 34,
    alignItems: "center",
    gap: 14,
    overflow: "hidden",
  },
  hall: { alignItems: "center", gap: 7, marginBottom: 16 },
  seatRow: { flexDirection: "row", gap: 7 },
  seat: { height: 9, borderRadius: 3, backgroundColor: GOLD_DEEP },

  emptyTitle: {
    color: TEXT,
    fontSize: 27,
    fontFamily: FONTS.script,
    lineHeight: 44,
    textAlign: "center",
  },
  emptyBody: {
    color: TEXT_FAINT,
    fontSize: 14,
    lineHeight: 28,
    textAlign: "center",
    fontFamily: FONTS.body,
    maxWidth: 300,
  },

  /* ----------------------------------------------------------------- list */
  list: { marginTop: 34, gap: 11 },
  listHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 3 },
  listLabel: {
    color: TEXT_FAINT,
    fontSize: 11,
    letterSpacing: 1.8,
    fontFamily: FONTS.bodyMedium,
    textTransform: "uppercase",
  },
  listRule: { flex: 1, height: 1, backgroundColor: HAIRLINE },
  listCount: { color: TEXT_FAINT, fontSize: 11, fontFamily: FONTS.bodyMedium },

  row: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 18,
    padding: 16,
    gap: 13,
    overflow: "hidden",
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowBody: { flex: 1, gap: 5 },
  rowTitle: { color: TEXT, fontSize: 16, fontFamily: FONTS.bodyMedium, textAlign: READ },
  rowMeta: { color: TEXT_FAINT, fontSize: 12, fontFamily: FONTS.body, textAlign: READ },
  rowChevron: { color: "#4E4838", fontSize: 20 },

  /* The lecture's own loudness, so the row shows where the voice rose. */
  wave: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 20,
    opacity: 0.85,
  },
  waveBar: { flex: 1, borderRadius: 2, backgroundColor: "#3B3524" },
  waveBarHot: { backgroundColor: GOLD },

  statusPill: {
    backgroundColor: "#2E2512",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  statusPillBad: { backgroundColor: "#331914" },
  statusText: { color: GOLD, fontSize: 10.5, fontFamily: FONTS.bodyMedium },
  statusTextBad: { color: "#DE9080" },

  disclaimer: {
    color: "#5C5648",
    fontSize: 11.5,
    lineHeight: 23,
    textAlign: "center",
    marginTop: 36,
    fontFamily: FONTS.body,
  },
});
