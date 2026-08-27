import { type ReactNode } from "react";
import Feather from "@expo/vector-icons/Feather";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import {
  BG,
  SURFACE,
  SURFACE_HIGH,
  BORDER,
  TEXT,
  TEXT_SOFT,
  TEXT_FAINT,
  ACCENT,
  ACTION,
  ACTION_TEXT,
  GRADE,
  gradeOf,
  verdictGrade,
  type Severity,
  type VerdictLevel,
  FONT,
  TYPE,
  SP,
  RADIUS,
  TAP,
  READ,
  lift,
} from "../scanner-ui";

/**
 * The pieces every Dash Light screen is built from.
 *
 * Kept in one file so a card on the result screen and a card in the light
 * guide cannot quietly drift apart — which is exactly what happened before,
 * when each screen carried its own copy of the same shape.
 */

/* ---- text -------------------------------------------------------------- */

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[k.title, style]}>{children}</Text>;
}

/** The English name of a light, under an Arabic title. Always Latin. */
export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={k.subtitle}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={k.section}>{children}</Text>;
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[k.body, style]}>{children}</Text>;
}

export function Caption({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[k.caption, style]}>{children}</Text>;
}

/* ---- surfaces ---------------------------------------------------------- */

export function Card({
  children,
  tone,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  /** Tints the card to a severity. Only for content that IS that severity. */
  tone?: Severity;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const grade = tone ? gradeOf(tone) : null;
  const box: StyleProp<ViewStyle> = [
    k.card,
    grade && { backgroundColor: grade.bg, borderColor: grade.line },
    style,
  ];
  if (!onPress) return <View style={box}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [box, pressed && k.pressed]}
    >
      {children}
    </Pressable>
  );
}

/* ---- the severity language --------------------------------------------- */

/** The grade of a light, as a word and a colour together. */
export function SeverityBadge({ severity, label }: { severity: Severity; label: string }) {
  const grade = gradeOf(severity);
  return (
    <View style={[k.badge, { backgroundColor: grade.bg, borderColor: grade.line }]}>
      <Text style={[k.badgeText, { color: grade.fg }]}>{label}</Text>
    </View>
  );
}

/** A grade at list scale, where there is no room for the word. The list rows
 *  carry the name beside it, so the dot is a scan aid rather than the signal. */
export function SeverityDot({ severity, size = 8 }: { severity: Severity; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: gradeOf(severity).fg,
      }}
    />
  );
}

/**
 * The answer.
 *
 * This is the single most important element in the product, so it is the
 * largest, the most saturated, and the first thing below the title. It is
 * never allowed to disagree with the severity: both colours come from the
 * same resolver.
 */
export function VerdictBand({
  level,
  text,
  reason,
}: {
  level: VerdictLevel;
  text: string;
  /** One line, under the judgement. Not the summary — the shortest possible
   *  answer to "why", for someone who has already read the verdict. */
  reason?: string;
}) {
  const grade = verdictGrade(level);
  const icon = level === "stop" ? "alert-octagon" : level === "caution" ? "alert-triangle" : "check-circle";

  return (
    <View
      style={[k.verdict, { backgroundColor: grade.bg, borderColor: grade.fg }]}
      accessibilityRole="alert"
      accessibilityLabel={reason ? `${text}. ${reason}` : text}
    >
      <View style={k.verdictTop}>
        <Feather name={icon} size={30} color={grade.fg} />
        <Text style={[k.verdictText, { color: grade.fg }]}>{text}</Text>
      </View>
      {reason ? <Text style={k.verdictReason}>{reason}</Text> : null}
    </View>
  );
}

/**
 * How sure the model is, as five pips.
 *
 * Shown because a confident wrong answer about brakes is the worst thing this
 * app can do. Low confidence is drawn in amber rather than red — the reading
 * is uncertain, which is a reason for caution, not a danger in itself.
 */
export function ConfidenceMeter({
  level,
  label,
}: {
  level: "high" | "medium" | "low";
  label: string;
}) {
  const filled = level === "high" ? 5 : level === "medium" ? 3 : 1;
  const colour = level === "low" ? GRADE.warning.fg : TEXT_SOFT;
  return (
    <View style={k.confidence}>
      <Text style={k.confidenceLabel}>{label}</Text>
      <View style={k.pips}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[k.pip, { backgroundColor: i < filled ? colour : BORDER }]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * How bad this one is, said three ways at once.
 *
 * A dot alone carries the grade in hue and nothing else, which is no signal
 * at all to a driver who cannot separate red from amber. Here the count of
 * filled bars says it by quantity, the word says it in language, and the
 * colour says it to everyone else. Any one of the three is enough on its own.
 */
export function SeverityScale({
  severity,
  label,
  caption,
}: {
  severity: Severity;
  label: string;
  caption: string;
}) {
  const filled = severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
  const colour = GRADE[severity].fg;
  return (
    <View style={k.scale} accessibilityLabel={`${caption}: ${label}`}>
      <Text style={k.scaleCaption}>{caption}</Text>
      <View style={k.scaleBars}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[k.scaleBar, { backgroundColor: i < filled ? colour : BORDER }]} />
        ))}
      </View>
      <Text style={[k.scaleWord, { color: colour }]}>{label}</Text>
    </View>
  );
}

/* ---- actions ----------------------------------------------------------- */

export function Button({
  label,
  onPress,
  /** primary is the light one, and there is at most one per screen. */
  variant = "secondary",
  glyph,
  busy,
  disabled,
  block,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  glyph?: string;
  busy?: boolean;
  disabled?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      style={({ pressed }) => [
        k.btn,
        variant === "primary" && k.btnPrimary,
        variant === "ghost" && k.btnGhost,
        block && { alignSelf: "stretch" },
        off && { opacity: 0.45 },
        pressed && k.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={variant === "primary" ? ACTION_TEXT : TEXT} />
      ) : glyph ? (
        <Text style={[k.btnGlyph, variant === "primary" && { color: ACTION_TEXT }]}>{glyph}</Text>
      ) : null}
      <Text style={[k.btnLabel, variant === "primary" && { color: ACTION_TEXT }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The quiet chrome over the camera. Low contrast on purpose — the camera is
 *  the interface and these must not compete with it. */
export function Pill({
  label,
  onPress,
  active,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [k.pill, active && k.pillActive, pressed && k.pressed]}
    >
      <Text style={[k.pillText, active && { color: BG }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/* ---- rows -------------------------------------------------------------- */

/** A numbered instruction. Steps are ordered because under stress people do
 *  them in the order they are printed. */
export function Step({ index, text }: { index: number; text: string }) {
  return (
    <View style={k.step}>
      <View style={k.stepNum}>
        <Text style={k.stepNumText}>{index}</Text>
      </View>
      <Text style={k.stepText}>{text}</Text>
    </View>
  );
}

/** An unordered point — a cause, a symptom. */
export function Bullet({ text, tone }: { text: string; tone?: Severity }) {
  return (
    <View style={k.bulletRow}>
      <View style={[k.bulletDot, tone && { backgroundColor: gradeOf(tone).fg }]} />
      <Text style={k.bulletText}>{text}</Text>
    </View>
  );
}

/** A label/value pair from "At a glance". */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={k.fact}>
      <Text style={k.factLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={k.factValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/* ---- navigation -------------------------------------------------------- */

export type TabItem<K extends string> = { key: K; label: string };

/** The segmented row inside a screen — the result's four views, and the
 *  guide's filters. Scrollable would hide options; four fit, so they share. */
export function Segmented<K extends string>({
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
    <View style={[k.segmented, style]}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            style={({ pressed }) => [k.segment, active && k.segmentActive, pressed && k.pressed]}
          >
            <Text style={[k.segmentText, active && k.segmentTextActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <View style={k.search}>
      <Text style={k.searchGlyph}>⌕</Text>
      <TextInput
        style={k.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={TEXT_FAINT}
        autoCorrect={false}
        textAlign={READ}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChange("")} hitSlop={12} accessibilityRole="button">
          <Text style={k.searchClear}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---- states ------------------------------------------------------------ */

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
    <View style={k.empty}>
      <Text style={k.emptyGlyph}>{glyph}</Text>
      <Text style={k.emptyTitle}>{title}</Text>
      {body ? <Text style={k.emptyBody}>{body}</Text> : null}
      {action && onAction ? <Button label={action} onPress={onAction} variant="primary" /> : null}
    </View>
  );
}

const k = StyleSheet.create({
  pressed: { opacity: 0.85 },

  title: { color: TEXT, ...TYPE.title, fontFamily: FONT.bold, textAlign: READ },
  subtitle: { color: TEXT_SOFT, ...TYPE.caption, fontFamily: FONT.latin, textAlign: READ },
  section: { color: TEXT, ...TYPE.section, fontFamily: FONT.semibold, textAlign: READ },
  body: { color: TEXT_SOFT, ...TYPE.body, fontFamily: FONT.regular, textAlign: READ },
  caption: { color: TEXT_FAINT, ...TYPE.caption, fontFamily: FONT.regular, textAlign: READ },

  card: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.lg,
    padding: SP.lg,
    gap: SP.md,
  },

  badge: {
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingVertical: SP.xs + 1,
    paddingHorizontal: SP.md,
    alignSelf: "flex-start",
  },
  badgeText: { ...TYPE.small, fontFamily: FONT.bold, letterSpacing: 0.6 },

  verdict: {
    borderWidth: 1.5,
    borderRadius: RADIUS.lg,
    paddingVertical: SP.xl,
    paddingHorizontal: SP.lg,
    gap: SP.sm,
  },
  verdictTop: { flexDirection: "row", alignItems: "center", gap: SP.md },
  verdictText: { flex: 1, ...TYPE.verdict, fontFamily: FONT.bold, textAlign: READ },
  verdictReason: { color: TEXT, ...TYPE.body, fontFamily: FONT.regular, textAlign: READ },

  confidence: { flexDirection: "row", alignItems: "center", gap: SP.md },
  confidenceLabel: { color: TEXT_SOFT, ...TYPE.caption, fontFamily: FONT.medium },
  pips: { flexDirection: "row", gap: 3 },
  scale: { flexDirection: "row", alignItems: "center", gap: SP.md },
  scaleCaption: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.regular },
  scaleBars: { flexDirection: "row", gap: 3 },
  scaleBar: { width: 16, height: 4, borderRadius: 2 },
  scaleWord: { ...TYPE.caption, fontFamily: FONT.bold, letterSpacing: 0.4 },
  pip: { width: 14, height: 5, borderRadius: 2.5 },

  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SP.sm,
    minHeight: TAP,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.xl,
    backgroundColor: SURFACE_HIGH,
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnPrimary: { backgroundColor: ACTION, borderColor: ACTION },
  btnGhost: { backgroundColor: "transparent", borderColor: "transparent" },
  btnGlyph: { color: TEXT_SOFT, ...TYPE.body },
  btnLabel: { color: TEXT, ...TYPE.body, fontFamily: FONT.semibold },

  pill: {
    minHeight: 34,
    justifyContent: "center",
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md + 2,
    backgroundColor: "rgba(12,14,19,0.55)",
    borderWidth: 1,
    borderColor: "rgba(242,244,248,0.16)",
  },
  pillActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  pillText: { color: TEXT, ...TYPE.small, fontFamily: FONT.medium },

  step: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE_HIGH,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepNumText: { color: TEXT_SOFT, ...TYPE.small, fontFamily: FONT.bold },
  stepText: { flex: 1, color: TEXT, ...TYPE.body, fontFamily: FONT.regular, textAlign: READ },

  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: SP.md },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: TEXT_FAINT,
    marginTop: 9,
  },
  bulletText: { flex: 1, color: TEXT_SOFT, ...TYPE.body, fontFamily: FONT.regular, textAlign: READ },

  fact: {
    flexGrow: 1,
    flexBasis: "44%",
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: SP.sm,
  },
  factLabel: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.regular, textAlign: READ },
  factValue: { color: TEXT, ...TYPE.caption, fontFamily: FONT.semibold, textAlign: READ },

  segmented: {
    flexDirection: "row",
    gap: SP.xs,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    padding: SP.xs,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.sm,
    paddingHorizontal: SP.xs,
  },
  segmentActive: { backgroundColor: SURFACE_HIGH },
  segmentText: { color: TEXT_FAINT, ...TYPE.small, fontFamily: FONT.medium },
  segmentTextActive: { color: TEXT, fontFamily: FONT.semibold },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: SP.md,
    minHeight: TAP,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.lg,
  },
  searchGlyph: { color: TEXT_FAINT, fontSize: 18 },
  searchInput: { flex: 1, color: TEXT, ...TYPE.body, fontFamily: FONT.regular, paddingVertical: SP.md },
  searchClear: { color: TEXT_FAINT, fontSize: 15 },

  empty: { alignItems: "center", gap: SP.md, paddingVertical: SP.section, paddingHorizontal: SP.xl },
  emptyGlyph: { color: BORDER, fontSize: 40 },
  emptyTitle: { color: TEXT, ...TYPE.section, fontFamily: FONT.semibold, textAlign: "center" },
  emptyBody: {
    color: TEXT_FAINT,
    ...TYPE.caption,
    fontFamily: FONT.regular,
    textAlign: "center",
    maxWidth: 300,
  },
});

export { lift };
