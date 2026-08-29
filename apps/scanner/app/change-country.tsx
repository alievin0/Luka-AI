import { useRouter } from "expo-router";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CountryField } from "../src/components/CountryField";
import { updateProfile } from "../src/storage";
import { t } from "../src/i18n";
import { ui } from "../src/i18n/ui";
import { theme } from "../src/theme";
import { UI_FONT } from "../src/ui-font";
import { READ } from "../src/scanner-ui";

/**
 * Changing the country the estimates are priced in.
 *
 * This used to be a `useState` branch inside settings, which meant it drew
 * from the top of the window with no safe area — its title landed on top of
 * the clock — and it changed with no transition at all. As a route it clears
 * the status bar like every other screen and animates in, and the back
 * gesture closes it for free.
 */
export default function ChangeCountry() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <Text style={styles.title}>{t(ui.changeCountry)}</Text>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          style={styles.cancelBtn}
        >
          <Text style={styles.cancel}>{t(ui.cancel)}</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <CountryField
          onSelect={async (country) => {
            // The code, not the label: a stored name breaks the moment a label is edited.
            await updateProfile({ region: country.code });
            router.back();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: theme.text, fontSize: 22, fontFamily: UI_FONT.bold, textAlign: READ },
  cancelBtn: { minHeight: 44, justifyContent: "center" },
  cancel: { color: theme.textSoft, fontSize: 16, fontFamily: UI_FONT.medium },
  body: { flex: 1, paddingHorizontal: 16 },
});
