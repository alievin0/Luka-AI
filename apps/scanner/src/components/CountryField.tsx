import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Keyboard,
} from "react-native";
import * as Haptics from "expo-haptics";
import { t } from "../i18n";
import { ui } from "../i18n/ui";
import { theme } from "../theme";
import { READ } from "../scanner-ui";
import { searchCountries, type Country } from "../countries";

/**
 * Type-to-filter country picker. Scrolling a 25-item list to find your own
 * country is the slowest possible way to answer this, so the field filters
 * as you type and matches English names and Arabic spelling variants.
 */
export function CountryField({
  onSelect,
}: {
  onSelect: (country: Country) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchCountries(query), [query]);

  const choose = (country: Country) => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    onSelect(country);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={t(ui.searchCountry)}
          placeholderTextColor={theme.textFaint}
          autoCorrect={false}
          returnKeyType="search"
          textAlign={READ}
          onSubmitEditing={() => results[0] && choose(results[0])}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={10}>
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        )}
      </View>

      {results.length === 0 ? (
        <Text style={styles.empty}>{t(ui.noCountry)}</Text>
      ) : (
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {results.map((country) => (
            <Pressable
              key={country.code}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => choose(country)}
            >
              <Text style={styles.rowName}>{country.name}</Text>
              <Text style={styles.rowCurrency}>{country.currency}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 20, flex: 1 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingHorizontal: 16,
  },
  searchGlyph: { color: theme.textFaint, fontSize: 20 },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 17,
    paddingVertical: 16,
    textAlign: READ,
  },
  clear: { color: theme.textFaint, fontSize: 15, paddingHorizontal: 4 },
  list: { marginTop: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surfaceAlt },
  rowName: { color: theme.text, fontSize: 17 },
  rowCurrency: { color: theme.textFaint, fontSize: 14 },
  empty: {
    color: theme.textFaint,
    fontSize: 15,
    textAlign: "center",
    marginTop: 32,
  },
});
