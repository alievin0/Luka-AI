import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, Linking } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { pack } from "../src/scanners";
import { theme } from "../src/theme";
import { clearHistory, getProfile, updateProfile, type Profile } from "../src/storage";
import { purchasesAvailable, restore } from "../src/purchases";
import { CountryField } from "../src/components/CountryField";

function Row({
  label,
  value,
  onPress,
  danger,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Text style={[styles.rowLabel, danger && styles.danger]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
    </Pressable>
  );
}

export default function Settings() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [editingCountry, setEditingCountry] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getProfile().then(setProfile);
    }, []),
  );

  const confirmClear = () =>
    Alert.alert("مسح كل الفحوصات؟", "رح تنمسح كل الفحوصات المحفوظة على جهازك. ما في رجعة.", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "امسح",
        style: "destructive",
        onPress: async () => {
          await clearHistory();
          Alert.alert("انمسحت", "ما ضل ولا فحص محفوظ.");
        },
      },
    ]);

  const doRestore = async () => {
    if (!purchasesAvailable()) {
      Alert.alert("غير متاح", "الاشتراكات مش مفعّلة بهالنسخة.");
      return;
    }
    const restored = await restore();
    Alert.alert(
      restored ? "تمت الاستعادة" : "ما لقينا اشتراك",
      restored ? "اشتراكك رجع فعّال." : "ما في اشتراك سابق على هذا الحساب.",
    );
  };

  if (editingCountry) {
    return (
      <View style={styles.screen}>
        <View style={styles.pickerHead}>
          <Text style={styles.pickerTitle}>غيّر بلدك</Text>
          <Pressable onPress={() => setEditingCountry(false)} hitSlop={10}>
            <Text style={styles.cancel}>إلغاء</Text>
          </Pressable>
        </View>
        <View style={styles.pickerBody}>
          <CountryField
            onSelect={async (country) => {
              setProfile(await updateProfile({ region: country.name }));
              setEditingCountry(false);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.section}>عام</Text>
      <View style={styles.group}>
        <Row
          label="بلدك"
          value={profile.region || "غير محدد"}
          onPress={() => setEditingCountry(true)}
        />
        {pack.library ? (
          <Row label={pack.libraryTitle ?? "الدليل"} onPress={() => router.push("/library")} />
        ) : null}
      </View>

      <Text style={styles.section}>الاشتراك</Text>
      <View style={styles.group}>
        <Row label="ترقية" onPress={() => router.push("/paywall")} />
        <Row label="استعادة عملية شراء" onPress={doRestore} />
      </View>

      <Text style={styles.section}>البيانات</Text>
      <View style={styles.group}>
        <Row label="امسح كل الفحوصات" onPress={confirmClear} danger />
      </View>
      <Text style={styles.note}>
        الفحوصات بتنحفظ على جهازك بس. ما بنخزّن صورك على خوادمنا.
      </Text>

      <Text style={styles.section}>عن التطبيق</Text>
      <View style={styles.group}>
        <Row label="النسخة" value={Constants.expoConfig?.version ?? "—"} />
        <Row
          label="سياسة الخصوصية"
          onPress={() =>
            Linking.openURL("https://example.com/privacy").catch(() =>
              Alert.alert("ما فتحت", "ضيف رابط سياسة الخصوصية قبل الإطلاق."),
            )
          }
        />
      </View>

      <Text style={styles.disclaimer}>{pack.disclaimer}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 48 },
  section: {
    color: theme.textFaint,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 22,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  group: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  rowLabel: { color: theme.text, fontSize: 16 },
  rowValue: { color: theme.textFaint, fontSize: 15 },
  danger: { color: theme.critical },
  note: { color: theme.textFaint, fontSize: 13, lineHeight: 22, marginTop: 10, paddingHorizontal: 4 },
  disclaimer: {
    color: theme.textFaint,
    fontSize: 12,
    lineHeight: 21,
    marginTop: 28,
    paddingHorizontal: 4,
  },
  pickerHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  pickerTitle: { color: theme.text, fontSize: 20, fontWeight: "700" },
  cancel: { color: theme.accent, fontSize: 16 },
  pickerBody: { flex: 1, paddingHorizontal: 16 },
});
