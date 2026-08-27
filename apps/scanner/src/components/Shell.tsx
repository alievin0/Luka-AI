import { useEffect, useState, type ReactNode } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { t } from "../i18n";
import { ui } from "../i18n/ui";
import { FONTS, SCALE } from "../type";
import { useLayout, MAX_CONTENT } from "../layout";
import { getLectureCount, lectureAllowed } from "../lectures";
import { isPro } from "../purchases";
import { pack, isAudio } from "../packs";
import {
  GOLD,
  GOLD_BRIGHT,
  GOLD_DEEP,
  INK,
  BLOOM,
  HAIRLINE,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  SP,
  RADIUS,
  READ,
  glow,
  audio as s,
} from "./audio-theme";
import { TabBar, TAB_CLEARANCE } from "./TabBar";

/**
 * The application shell.
 *
 * One component decides where the destinations live, because that decision
 * depends on how much room there is and nothing else. On a phone the record
 * button belongs under the thumb, so the destinations run along the bottom
 * with recording raised in the middle. On a laptop that same row would be a
 * strip of buttons a metre from where the eye is, so the destinations move to
 * a quiet column on the side and the content keeps the middle.
 *
 * Screens hand Shell their content and never think about this again — which
 * is also why the paywall check for recording lives here rather than being
 * copy-pasted into every screen that shows a record button.
 */

type Destination = {
  path: string;
  label: string;
  glyph: string;
  /** Shown in the phone's bottom bar. The rest are sidebar-only. */
  bottom?: boolean;
};

function destinations(): Destination[] {
  return [
    { path: "/", label: t(ui.tabHome), glyph: "⌂", bottom: true },
    { path: "/lectures", label: t(ui.tabLibrary), glyph: "▤", bottom: true },
    { path: "/tasks", label: t(ui.navTasks), glyph: "☑", bottom: true },
    { path: "/search", label: t(ui.tabSearch), glyph: "⌕", bottom: true },
    { path: "/study", label: t(ui.aiStudy), glyph: "✦" },
    { path: "/settings", label: t(ui.settings), glyph: "⚙" },
  ];
}

export function Shell({
  children,
  /** Leave the navigation off entirely — recording and analysing are sessions,
   *  not places, and offering an exit mid-lecture is how a recording is lost. */
  bare,
}: {
  children: ReactNode;
  bare?: boolean;
}) {
  const router = useRouter();
  const layout = useLayout();

  const onRecord = async () => {
    if (await lectureAllowed()) router.push("/record");
    else router.push("/paywall");
  };

  const ground = (
    <LinearGradient colors={BLOOM} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
  );

  if (bare) {
    return (
      <View style={s.root}>
        {ground}
        <SafeAreaView style={s.safe} edges={["top"]}>
          {children}
        </SafeAreaView>
      </View>
    );
  }

  if (layout.desktop || layout.tablet) {
    return (
      <View style={s.root}>
        {ground}
        <SafeAreaView style={[s.safe, sh.wide]} edges={["top", "bottom"]}>
          <Sidebar compact={layout.tablet} onRecord={onRecord} />
          <View style={sh.main}>
            <View style={[sh.column, { maxWidth: MAX_CONTENT }]}>{children}</View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {ground}
      <SafeAreaView style={s.safe} edges={["top"]}>
        {children}
      </SafeAreaView>
      <TabBar onRecord={onRecord} />
    </View>
  );
}

/**
 * The side column.
 *
 * Deliberately narrow and deliberately dim: it is a way back, not the
 * subject. On a tablet it drops to glyphs alone, because a labelled column
 * there would eat a third of the width the content needs.
 */
function Sidebar({ compact, onRecord }: { compact: boolean; onRecord: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pro, setPro] = useState<boolean | null>(null);
  /** What is actually left, not the allowance — "1 lecture left" shown to
   *  someone who has already spent it is the app lying about their account. */
  const [left, setLeft] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const [yes, used] = await Promise.all([isPro(), getLectureCount()]);
      if (!live) return;
      setPro(yes);
      setLeft(isAudio(pack) ? Math.max(0, pack.freeLectures - used) : 0);
    })();
    return () => {
      live = false;
    };
  }, []);

  const items = destinations();

  return (
    <View style={[sh.side, compact && sh.sideCompact]}>
      <View style={[s.wordmarkWrap, sh.mark, compact && sh.markCompact]}>
        <Text style={s.wordmarkArabic}>مَحضَر</Text>
        {compact ? null : <Text style={s.wordmarkLatin}>MAHDAR</Text>}
      </View>

      <Pressable
        onPress={onRecord}
        accessibilityRole="button"
        accessibilityLabel={t(ui.tabRecord)}
        style={({ pressed }) => [sh.rec, compact && sh.recCompact, pressed && s.pressed]}
      >
        <LinearGradient
          colors={[GOLD_BRIGHT, GOLD, GOLD_DEEP]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[StyleSheet.absoluteFill, glow(GOLD, 18, 0.26)]}
        />
        <Text style={sh.recGlyph}>🎙</Text>
        {compact ? null : <Text style={sh.recLabel}>{t(ui.tabRecord)}</Text>}
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={sh.links}>
        {items.map((item) => {
          const active = pathname === item.path;
          return (
            <Pressable
              key={item.path}
              onPress={() => router.replace(item.path as never)}
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={({ pressed }) => [
                sh.link,
                compact && sh.linkCompact,
                active && sh.linkActive,
                pressed && s.pressed,
              ]}
            >
              <Text style={[sh.linkGlyph, active && { color: GOLD }]}>{item.glyph}</Text>
              {compact ? null : (
                <Text style={[sh.linkLabel, active && sh.linkLabelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Plan status, said once and quietly. A subscription prompt that shouts
          from the sidebar of every screen is an advert, not an interface. */}
      {compact || pro === null ? null : (
        <Pressable
          onPress={() => (pro ? router.push("/settings") : router.push("/paywall"))}
          accessibilityRole="button"
          style={({ pressed }) => [sh.plan, pressed && s.pressed]}
        >
          <Text style={sh.planLabel} numberOfLines={2}>
            {pro ? t(ui.planPro) : `${t(ui.planFree)} · ${left} ${t(ui.lecturesLeft)}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Bottom clearance content must leave so the navigation never covers a row. */
export function useContentPad() {
  const layout = useLayout();
  return layout.phone ? TAB_CLEARANCE + SP.xl : SP.section;
}

const sh = StyleSheet.create({
  wide: { flexDirection: "row" },
  main: { flex: 1, alignItems: "center" },
  column: { flex: 1, width: "100%" },

  side: {
    width: 218,
    borderRightWidth: 1,
    borderRightColor: HAIRLINE,
    paddingHorizontal: SP.md,
    paddingBottom: SP.lg,
    gap: SP.lg,
  },
  sideCompact: { width: 76, paddingHorizontal: SP.sm },
  mark: { marginTop: SP.lg, alignSelf: "stretch", justifyContent: "center" },
  markCompact: { paddingHorizontal: SP.sm },

  rec: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SP.sm,
    borderRadius: RADIUS.md,
    paddingVertical: SP.md + 2,
    overflow: "hidden",
  },
  recCompact: { paddingVertical: SP.md, aspectRatio: 1 },
  recGlyph: { fontSize: 17 },
  recLabel: { color: INK, fontSize: SCALE.body, fontFamily: FONTS.displayBold },

  links: { gap: 2, paddingTop: SP.sm },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    borderRadius: RADIUS.md,
    paddingVertical: SP.md,
    paddingHorizontal: SP.md,
  },
  linkCompact: { justifyContent: "center", paddingHorizontal: 0 },
  linkActive: { backgroundColor: "rgba(217,185,104,0.08)" },
  linkGlyph: { color: TEXT_FAINT, fontSize: 16, width: 18, textAlign: "center" },
  linkLabel: { flex: 1, color: TEXT_SOFT, fontSize: SCALE.body, fontFamily: FONTS.body, textAlign: READ },
  linkLabelActive: { color: TEXT, fontFamily: FONTS.bodyMedium },

  plan: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: SP.md,
    paddingHorizontal: SP.md,
  },
  planLabel: { color: TEXT_FAINT, fontSize: SCALE.micro, fontFamily: FONTS.body, textAlign: READ },
});
