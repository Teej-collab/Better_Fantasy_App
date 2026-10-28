import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { DEFAULT_CHUG_RULE_NAME, useHouseRules } from '@/lib/queries';
import { glossary, tour } from '@/lib/tour';

// Every term in The Weekend in a sentence, with where to find it
// (2026-10-28, the approved New Here mockup). Opened from the profile
// circle's menu under Help (and Settings › Help & feedback); the top row
// replays the tour.

export default function GlossaryScreen() {
  const insets = useSafeAreaInsets();
  const rules = useHouseRules().data;
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const all = glossary(rules?.chugRuleName ?? DEFAULT_CHUG_RULE_NAME, Boolean(rules?.chugEnabled));
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((g) => ({ ...g, terms: g.terms.filter((t) => `${t.term} ${t.def}`.toLowerCase().includes(q)) }))
      .filter((g) => g.terms.length > 0);
  }, [rules?.chugRuleName, rules?.chugEnabled, query]);

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.head}>
        <Display style={styles.title}>Glossary</Display>
        <Text style={styles.sub}>Every term in The Weekend, in a sentence.</Text>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Try “chug” or “Gamecast”"
        placeholderTextColor={Colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel="Search the glossary"
        style={styles.input}
      />

      <Pressable
        onPress={() => {
          haptics.tap();
          tour.open(0);
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.replay, pressed && styles.pressed]}
      >
        <View style={styles.flex}>
          <Text style={styles.replayTitle}>Replay the New Here tour</Text>
          <Text style={styles.sub}>The welcome slides, any time</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>

      {groups.length === 0 && <Text style={styles.sub}>Nothing matches “{query.trim()}”.</Text>}

      {groups.map((g) => (
        <View key={g.name} style={styles.group}>
          <Text style={[styles.groupName, { color: g.color }]} accessibilityRole="header">{g.name}</Text>
          <View style={styles.card}>
            {g.terms.map((t, i) => (
              <View key={t.term} style={[styles.term, i > 0 && styles.termLine]}>
                <Text style={styles.termName}>{t.term}</Text>
                <Text style={styles.def}>{t.def}</Text>
                {Boolean(t.where) && (
                  <View style={styles.where}>
                    <Text style={styles.whereText}>Find it: {t.where}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: Spacing.md, gap: 16 },
  head: { gap: 4 },
  title: { fontSize: 34, textTransform: 'uppercase', color: Colors.text },
  sub: { color: Colors.textSecondary, fontSize: 14 },
  input: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, color: Colors.text, fontSize: 16, paddingHorizontal: 14 },
  replay: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.08)', paddingHorizontal: 16, paddingVertical: 10 },
  replayTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  chev: { color: Colors.accent, fontSize: 22 },
  pressed: { opacity: 0.7 },
  group: { gap: 6 },
  groupName: { fontSize: 12, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 4 },
  card: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, overflow: 'hidden' },
  term: { paddingHorizontal: 14, paddingVertical: 11, gap: 3 },
  termLine: { borderTopWidth: 1, borderTopColor: Colors.border },
  termName: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  def: { color: '#aeb5c1', fontSize: 13, lineHeight: 19 },
  where: { alignSelf: 'flex-start', marginTop: 3, backgroundColor: 'rgba(57,255,20,0.08)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  whereText: { color: Colors.accent, fontSize: 12, fontWeight: '600' },
});
