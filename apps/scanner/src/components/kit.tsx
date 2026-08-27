import { useState, type ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { FONTS, SCALE } from "../type";
import {
  GOLD,
  GOLD_BRIGHT,
  GOLD_DEEP,
  INK,
  PANEL_GRADIENT,
  RAISED_GRADIENT,
  PANEL_BORDER,
  WELL,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  STATE,
  type StateName,
  SP,
  RADIUS,
  READ,
  lift,
  glow,
} from "./audio-theme";

/**
 * Mahdar's component kit.
 *
 * Before this file every screen declared its own card, its own chip, its own
 * search field — the search box in the library and the one on the search
 * screen were byte-identical and written twice. That is how an app drifts:
 * not by anyone deciding to make two things different, but by nobody being
 * able to make them the same.
 *
 * So the rule is that a shape used twice lives here, and a screen's own
 * StyleSheet is only ever for the arrangement that is unique to it.
 */

/* ---- surfaces ---------------------------------------------------------- */

type CardProps = {
  children: ReactNode;
  /** Raised cards catch more of the lamp. Reserve them for the one thing on
   *  a screen that is genuinely the subject — otherwise nothing is. */
  raised?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Card({ children, raised, onPress, style, accessibilityLabel }: CardProps) {
  const body = (
    <>
      <LinearGradient
        colors={raised ? RAISED_GRADIENT : PANEL_GRADIENT}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </>
  );

  if (!onPress) {
    return <View style={[k.card, lift, style]}>{body}</View>;
  }
  return (
    <Pressable
      style={({ pressed }) => [k.card, lift, style, pressed && k.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </Pressable>
  );
}

/* ---- type -------------------------------------------------------------- */

/** A screen's own name. One per screen, and nothing else at this size. */
export function PageTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[k.pageTitle, style]}>{children}</Text>;
}

/**
 * The heading over a group of cards, with an optional way out of the group.
 *
 * The action sits on the heading rather than at the foot of the list, so a
 * student who has decided they want "all of them" does not have to scroll
 * past the three we chose to show them first.
 */
export function SectionTitle({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={k.sectionRow}>
      <Text style={k.sectionTitle}>{children}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={k.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[k.body, style]}>{children}</Text>;
}

export function Meta({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[k.meta, style]}>{children}</Text>;
}

/* ---- actions ----------------------------------------------------------- */

type ButtonProps = {
  label: string;
  onPress: () => void;
  /** primary is the gold one. There is at most one per screen. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  glyph?: string;
  disabled?: boolean;
  busy?: boolean;
  /** Fill the row. Off by default so buttons size to their words. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "md",
  glyph,
  disabled,
  busy,
  block,
  style,
}: ButtonProps) {
  const pad = size === "lg" ? SP.lg : size === "sm" ? SP.sm : SP.md;
  const font = size === "lg" ? SCALE.body + 1.5 : size === "sm" ? SCALE.label : SCALE.body;
  const off = disabled || busy;

  const inner = (
    <View style={[k.btnInner, { paddingVertical: pad, paddingHorizontal: pad + SP.md }]}>
      {busy ? (
        <ActivityIndicator size="small" color={variant === "primary" ? INK : TEXT_SOFT} />
      ) : glyph ? (
        <Text style={[k.btnGlyph, { fontSize: font }, variant === "primary" && { color: INK }]}>
          {glyph}
        </Text>
      ) : null}
      <Text
        style={[
          k.btnLabel,
          { fontSize: font },
          variant === "primary" && k.btnLabelPrimary,
          variant === "danger" && { color: STATE.danger.fg },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      style={({ pressed }) => [
        k.btn,
        block && { flex: 1 },
        variant === "secondary" && k.btnSecondary,
        variant === "ghost" && k.btnGhost,
        variant === "danger" && k.btnDanger,
        off && { opacity: 0.5 },
        pressed && k.pressed,
        style,
      ]}
    >
      {variant === "primary" ? (
        <LinearGradient
          colors={[GOLD_BRIGHT, GOLD, GOLD_DEEP]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[StyleSheet.absoluteFill, glow(GOLD, 20, 0.28)]}
        />
      ) : null}
      {inner}
    </Pressable>
  );
}

/** A single glyph with a real 44pt target under it, whatever it looks like. */
export function IconButton({
  glyph,
  onPress,
  label,
  tone = "soft",
  size = 40,
}: {
  glyph: string;
  onPress: () => void;
  label: string;
  tone?: "soft" | "gold" | "bare";
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={Math.max(0, (44 - size) / 2)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        k.icon,
        { width: size, height: size, borderRadius: size / 2 },
        tone === "bare" && { backgroundColor: "transparent", borderColor: "transparent" },
        tone === "gold" && { backgroundColor: GOLD, borderColor: GOLD },
        pressed && k.pressed,
      ]}
    >
      <Text
        style={[
          k.iconGlyph,
          { fontSize: size * 0.42 },
          tone === "gold" && { color: INK },
        ]}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

/* ---- small pieces ------------------------------------------------------ */

/**
 * A concept, a state, a count. Chips carry one word and are tappable when
 * that word leads somewhere.
 */
export function Chip({
  label,
  tone,
  gold,
  onPress,
  active,
}: {
  label: string;
  tone?: StateName;
  gold?: boolean;
  onPress?: () => void;
  active?: boolean;
}) {
  const palette = tone ? STATE[tone] : null;
  const content = (
    <Text
      style={[
        k.chipText,
        palette && { color: palette.fg },
        gold && { color: GOLD, fontFamily: FONTS.bodyMedium },
        active && { color: INK, fontFamily: FONTS.bodyMedium },
      ]}
      numberOfLines={1}
    >
      {label}
    </Text>
  );
  const box: StyleProp<ViewStyle> = [
    k.chip,
    palette && { backgroundColor: palette.bg, borderColor: palette.line },
    gold && { backgroundColor: "rgba(217,185,104,0.10)", borderColor: "rgba(217,185,104,0.32)" },
    active && { backgroundColor: GOLD, borderColor: GOLD },
  ];

  if (!onPress) return <View style={box}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      style={({ pressed }) => [box, pressed && k.pressed]}
    >
      {content}
    </Pressable>
  );
}

/** Progress, as a fraction of one. Gold, because progress is one of the four
 *  things gold is allowed to mean. */
export function ProgressBar({
  value,
  height = 4,
  label,
}: {
  value: number;
  height?: number;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      style={[k.track, { height, borderRadius: height / 2 }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
    >
      <View
        style={[k.trackFill, { width: `${pct * 100}%`, height, borderRadius: height / 2 }]}
      />
    </View>
  );
}

/**
 * The shape of the sound.
 *
 * Bars are drawn from the loudness the recorder actually measured, so this is
 * a picture of the lecture rather than decoration — a run of tall bars is a
 * passage the lecturer raised their voice over, which is the whole point.
 */
export function Waveform({
  bars,
  progress,
  height = 34,
  onSeek,
}: {
  bars: number[];
  /** 0–1. Bars before it are lit, bars after are not. */
  progress?: number;
  height?: number;
  onSeek?: (fraction: number) => void;
}) {
  /** Measured rather than guessed from the bar count — the strip is flex-laid,
   *  so its width is the container's, not the bars'. */
  const [width, setWidth] = useState(0);

  const cut = progress === undefined ? bars.length : Math.round(progress * bars.length);

  return (
    <View
      style={[kWave.wrap, { height }]}
      onLayout={onSeek ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}
      onStartShouldSetResponder={onSeek ? () => true : undefined}
      onResponderRelease={
        onSeek
          ? (e) => {
              if (!width) return;
              onSeek(Math.max(0, Math.min(1, e.nativeEvent.locationX / width)));
            }
          : undefined
      }
      accessible={Boolean(onSeek)}
      accessibilityRole={onSeek ? "adjustable" : undefined}
    >
      {bars.map((level, i) => (
        <View
          key={i}
          style={[
            kWave.bar,
            {
              height: Math.max(2, Math.min(1, level) * height),
              backgroundColor: progress === undefined ? GOLD_DEEP : i < cut ? GOLD : "#2C2519",
            },
          ]}
        />
      ))}
    </View>
  );
}

const kWave = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 2, overflow: "hidden" },
  bar: { flex: 1, minWidth: 1.5, borderRadius: 1 },
});

/* ---- fields ------------------------------------------------------------ */

export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[k.field, style]}>
      <Text style={k.fieldGlyph}>⌕</Text>
      <TextInput
        style={k.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={TEXT_FAINT}
        autoCorrect={false}
        autoFocus={autoFocus}
        textAlign={READ}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChange("")} hitSlop={12} accessibilityRole="button">
          <Text style={k.fieldClear}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---- navigation -------------------------------------------------------- */

export type TabItem<K extends string> = { key: K; label: string };

/**
 * The tab row inside a screen.
 *
 * Scrollable rather than squeezed: five Arabic labels do not fit across a
 * phone, and shrinking them until they do is how you get a row of unreadable
 * three-letter stubs.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  style,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={k.tabs}
      style={style}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            style={({ pressed }) => [k.tab, active && k.tabActive, pressed && k.pressed]}
          >
            <Text style={[k.tabText, active && k.tabTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ---- states ------------------------------------------------------------ */

/**
 * Nothing here yet — said in a way that sounds like the room is waiting
 * rather than like the app is broken.
 */
export function EmptyState({
  glyph,
  title,
  body,
  action,
  onAction,
}: {
  glyph: string;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Card style={k.state}>
      <Text style={k.stateGlyph}>{glyph}</Text>
      <Text style={k.stateTitle}>{title}</Text>
      {body ? <Text style={k.stateBody}>{body}</Text> : null}
      {action && onAction ? (
        <Button label={action} onPress={onAction} variant="primary" size="sm" />
      ) : null}
    </Card>
  );
}

export type Step = { label: string; state: "done" | "active" | "waiting" };

/**
 * Work in progress, named.
 *
 * A spinner tells a student that something is happening and nothing about
 * what. These are the actual stages, so the wait has a shape and they can
 * see it moving.
 */
export function LoadingState({ title, steps }: { title?: string; steps: Step[] }) {
  return (
    <Card style={k.state}>
      {title ? <Text style={k.stateTitle}>{title}</Text> : null}
      <View style={k.steps}>
        {steps.map((step) => (
          <View key={step.label} style={k.step}>
            {step.state === "active" ? (
              <ActivityIndicator size="small" color={GOLD} style={k.stepMark} />
            ) : (
              <Text
                style={[
                  k.stepGlyph,
                  step.state === "done" && { color: STATE.stated.fg },
                ]}
              >
                {step.state === "done" ? "✓" : "·"}
              </Text>
            )}
            <Text
              style={[
                k.stepLabel,
                step.state === "waiting" && { color: TEXT_FAINT },
                step.state === "active" && { color: TEXT, fontFamily: FONTS.bodyMedium },
              ]}
            >
              {step.label}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Something failed. Says what survived, then offers the way out. */
export function ErrorState({
  title,
  body,
  action,
  onAction,
  secondary,
  onSecondary,
}: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
  secondary?: string;
  onSecondary?: () => void;
}) {
  return (
    <Card style={[k.state, { borderColor: STATE.danger.line }]}>
      <Text style={[k.stateTitle, { color: STATE.danger.fg }]}>{title}</Text>
      <Text style={k.stateBody}>{body}</Text>
      <View style={k.stateActions}>
        {action && onAction ? <Button label={action} onPress={onAction} size="sm" /> : null}
        {secondary && onSecondary ? (
          <Button label={secondary} onPress={onSecondary} variant="ghost" size="sm" />
        ) : null}
      </View>
    </Card>
  );
}

/* ---- styles ------------------------------------------------------------ */

const k = StyleSheet.create({
  pressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },

  card: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.xl,
    padding: SP.xl,
    overflow: "hidden",
  },

  pageTitle: {
    color: TEXT,
    fontSize: SCALE.title,
    lineHeight: SCALE.titleLine,
    fontFamily: FONTS.display,
    textAlign: READ,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: SP.md,
    marginBottom: SP.md,
  },
  sectionTitle: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.section,
    lineHeight: SCALE.sectionLine,
    fontFamily: FONTS.bodyMedium,
    textAlign: READ,
  },
  sectionAction: { color: GOLD, fontSize: SCALE.label, fontFamily: FONTS.bodyMedium },
  body: {
    color: TEXT_SOFT,
    fontSize: SCALE.body,
    lineHeight: SCALE.bodyLine,
    fontFamily: FONTS.body,
    textAlign: READ,
  },
  meta: {
    color: TEXT_FAINT,
    fontSize: SCALE.micro,
    fontFamily: FONTS.body,
    textAlign: READ,
  },

  btn: { borderRadius: RADIUS.md, overflow: "hidden", alignItems: "center" },
  btnSecondary: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: PANEL_BORDER },
  btnGhost: { backgroundColor: "transparent" },
  btnDanger: { backgroundColor: STATE.danger.bg, borderWidth: 1, borderColor: STATE.danger.line },
  btnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SP.sm },
  btnGlyph: { color: TEXT_SOFT },
  btnLabel: { color: TEXT, fontFamily: FONTS.bodyMedium },
  btnLabelPrimary: { color: INK, fontFamily: FONTS.displayBold },

  icon: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  iconGlyph: { color: TEXT_SOFT },

  chip: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: RADIUS.pill,
    paddingVertical: SP.sm - 1,
    paddingHorizontal: SP.md + 2,
  },
  chipText: { color: TEXT_SOFT, fontSize: SCALE.label, fontFamily: FONTS.body },

  track: { flex: 1, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  trackFill: { backgroundColor: GOLD },

  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    backgroundColor: WELL,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.lg,
  },
  fieldGlyph: { color: TEXT_FAINT, fontSize: 17 },
  fieldInput: {
    flex: 1,
    color: TEXT,
    fontSize: SCALE.body,
    fontFamily: FONTS.body,
    paddingVertical: SP.md + 2,
  },
  fieldClear: { color: TEXT_FAINT, fontSize: 15 },

  tabs: { gap: SP.sm, paddingVertical: SP.xs },
  tab: {
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: RADIUS.pill,
    paddingVertical: SP.sm + 1,
    paddingHorizontal: SP.lg,
  },
  tabActive: { backgroundColor: GOLD, borderColor: GOLD },
  tabText: { color: TEXT_SOFT, fontSize: SCALE.label, fontFamily: FONTS.body },
  tabTextActive: { color: INK, fontFamily: FONTS.bodyMedium },

  state: { alignItems: "center", gap: SP.md, paddingVertical: SP.section },
  stateGlyph: { color: "#332C1E", fontSize: 34 },
  stateTitle: {
    color: TEXT,
    fontSize: SCALE.section,
    lineHeight: SCALE.sectionLine,
    fontFamily: FONTS.bodyMedium,
    textAlign: "center",
  },
  stateBody: {
    color: TEXT_FAINT,
    fontSize: SCALE.label,
    lineHeight: SCALE.labelLine + 6,
    fontFamily: FONTS.body,
    textAlign: "center",
    maxWidth: 300,
  },
  stateActions: { flexDirection: "row", gap: SP.sm, flexWrap: "wrap", justifyContent: "center" },

  steps: { gap: SP.md, alignSelf: "stretch", marginTop: SP.xs },
  step: { flexDirection: "row", alignItems: "center", gap: SP.md },
  stepMark: { width: 16 },
  stepGlyph: { width: 16, textAlign: "center", color: TEXT_FAINT, fontSize: SCALE.body },
  stepLabel: { flex: 1, color: TEXT_SOFT, fontSize: SCALE.label, fontFamily: FONTS.body, textAlign: READ },
});
