import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { pack, isAudio } from "../src/packs";
import { t, locale, isRTL } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { bumpLectureCount, lectureAllowed, newLectureId, saveLecture } from "../src/lectures";
import { GOLD, INK, audio as s, READ, READ_END } from "../src/components/audio-theme";

/** Text pasted in has no timestamps, so it is stored as one segment at zero.
 *  Splitting it into fake timestamps would put times on the screen that point
 *  at nothing. */
const MIN_CHARS = 40;

export default function Paste() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isAudio(pack)) return null;

  const study = async () => {
    const body = text.trim();
    if (body.length < MIN_CHARS) {
      setError(t(ui.needMoreText));
      return;
    }
    // The same gate the record button uses. Without it this screen is a free
    // route to the paid analysis for anyone who can paste.
    if (!(await lectureAllowed())) {
      router.push("/paywall");
      return;
    }

    const id = newLectureId();
    await bumpLectureCount();
    await saveLecture({
      id,
      title: title.trim(),
      at: Date.now(),
      // Roughly 130 words a minute of speech, so the review screen can show a
      // length rather than a zero it would have to explain.
      duration: Math.round((body.split(/\s+/).length / 130) * 60),
      segments: [{ at: 0, text: body }],
      status: "processing",
    });
    router.replace({ pathname: "/analyzing", params: { id } });
  };

  return (
    <View style={s.root}>
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={s.wordmarkWrap}>
              <View style={s.langPill}>
                <Text style={s.langText}>{locale === "ar" ? "EN" : "ع"}</Text>
              </View>
              <Text style={s.wordmarkLatin}>{pack.wordmark}</Text>
              <Text style={s.wordmarkDot}>•</Text>
              <Text style={s.wordmarkArabic}>{t(pack.appName)}</Text>
            </View>

            <Text style={styles.heading}>{t(ui.pasteTitle)}</Text>
            <Text style={styles.hint}>{t(ui.pasteHint)}</Text>

            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder={t(ui.lectureTitle)}
              placeholderTextColor="#6E685C"
              textAlign={isRTL ? "right" : "left"}
            />

            <TextInput
              style={styles.body}
              value={text}
              onChangeText={(next) => {
                setText(next);
                if (error) setError(null);
              }}
              placeholder={t(ui.pasteHere)}
              placeholderTextColor="#6E685C"
              multiline
              textAlignVertical="top"
              textAlign={isRTL ? "right" : "left"}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.primary, pressed && s.pressed]}
                onPress={study}
              >
                <Text style={styles.primaryText}>{t(ui.study)}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.ghost, pressed && s.pressed]}
                onPress={() => router.back()}
              >
                <Text style={styles.ghostText}>{t(ui.home)}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  heading: {
    color: "#F5EEDF",
    fontSize: 32,
    fontWeight: "800",
    marginTop: 30,
    textAlign: READ,
  },
  hint: { color: "#9C9382", fontSize: 15, lineHeight: 30, marginTop: 14, textAlign: READ },
  titleInput: {
    backgroundColor: "#141209",
    borderWidth: 1,
    borderColor: "#241F14",
    borderRadius: 14,
    color: "#E8E0CE",
    fontSize: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    marginTop: 22,
  },
  body: {
    backgroundColor: "#141209",
    borderWidth: 1,
    borderColor: "#241F14",
    borderRadius: 18,
    color: "#E8E0CE",
    fontSize: 15,
    lineHeight: 28,
    minHeight: 240,
    padding: 16,
    marginTop: 12,
  },
  error: { color: "#E08878", fontSize: 14, marginTop: 12, textAlign: READ },
  actions: { flexDirection: "row", gap: 10, marginTop: 22, justifyContent: READ_END },
  primary: {
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingVertical: 17,
    paddingHorizontal: 30,
  },
  primaryText: { color: INK, fontSize: 16, fontWeight: "700" },
  ghost: {
    backgroundColor: "#17150F",
    borderWidth: 1,
    borderColor: "#2A2519",
    borderRadius: 999,
    paddingVertical: 17,
    paddingHorizontal: 24,
  },
  ghostText: { color: "#E8E0CE", fontSize: 16, fontWeight: "600" },
});
