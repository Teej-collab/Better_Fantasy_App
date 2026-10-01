import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import type { ChatGif } from '@/lib/types';

// Port of the web's components/chat/GifPicker.tsx as a sheet: live GIPHY
// search (through the backend, so the key stays server-side), plus
// one-tap topics for the moments a league chat actually needs.
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_QUERY = 'fantasy football';
const TOPICS = ['Touchdown', 'Celebrate', 'Trash talk', 'Crying', 'LOL', 'Fumble', 'Bench', 'Waiver wire', 'Let’s go', 'Shocked'];
const GAP = 6;

export function GifPicker({ visible, onSelect, onClose }: { visible: boolean; onSelect: (gif: ChatGif) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState(DEFAULT_QUERY);

  // Debounced: one request per pause in typing, not per keystroke. The
  // empty query still searches the default so the sheet never opens blank.
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim() || DEFAULT_QUERY), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const results = useQuery({
    queryKey: ['gifs', term],
    queryFn: () => api.searchGifs(term),
    enabled: visible,
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 503) && count < 1,
  });
  const unconfigured = results.error instanceof ApiError && results.error.status === 503;
  const tile = (width - Spacing.lg * 2 - GAP) / 2;

  function pickTopic(topic: string) {
    haptics.select();
    setQuery(topic);
    setTerm(topic);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search GIFs"
            placeholderTextColor={Colors.textSecondary}
            accessibilityLabel="Search GIFs"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => setTerm(query.trim() || DEFAULT_QUERY)}
            clearButtonMode="while-editing"
            style={styles.search}
          />
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" style={styles.close}>
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topics} style={styles.topicsBar} keyboardShouldPersistTaps="handled">
          {TOPICS.map((t) => {
            const on = term.toLowerCase() === t.toLowerCase();
            return (
              <Pressable key={t} onPress={() => pickTopic(t)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.topic, on && styles.topicOn]}>
                <Text style={[styles.topicText, on && styles.topicTextOn]}>{t}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {unconfigured ? (
          <Text style={styles.message}>GIF search isn&apos;t set up for this app yet.</Text>
        ) : results.isError ? (
          <Text style={styles.message}>Couldn&apos;t reach GIF search — try again in a moment.</Text>
        ) : results.isPending ? (
          <ActivityIndicator color={Colors.accent} style={styles.spinner} />
        ) : results.data.length === 0 ? (
          <Text style={styles.message}>No GIFs found.</Text>
        ) : (
          <FlatList
            data={results.data}
            keyExtractor={(g) => g.id}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              // Keep each GIF's own shape, within sensible bounds.
              const ratio = item.width && item.height ? Math.min(1.6, Math.max(0.6, item.height / item.width)) : 0.75;
              return (
                <Pressable
                  onPress={() => {
                    haptics.tap();
                    onSelect(item);
                  }}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={item.description ? `Send GIF: ${item.description}` : 'Send GIF'}
                  style={({ pressed }) => [styles.tile, { width: tile, height: tile * ratio }, pressed && styles.pressed]}>
                  <Image source={{ uri: item.preview_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} recyclingKey={item.id} />
                </Pressable>
              );
            }}
            ListFooterComponent={<Text style={styles.attribution}>Powered by GIPHY</Text>}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.sm },
  search: {
    flex: 1,
    backgroundColor: Colors.tile,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  close: { paddingVertical: 6 },
  closeText: { color: Colors.accent, fontSize: 16, fontWeight: '600' },
  topicsBar: { flexGrow: 0 },
  topics: { gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  topic: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 6 },
  topicOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  topicText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  topicTextOn: { color: '#06110a' },
  grid: { paddingHorizontal: Spacing.lg, gap: GAP, paddingBottom: Spacing.xl },
  row: { gap: GAP, alignItems: 'flex-start' },
  tile: { borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.tile },
  pressed: { opacity: 0.7 },
  spinner: { marginTop: Spacing.xl * 2 },
  message: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: Spacing.xl * 2, paddingHorizontal: Spacing.xl },
  attribution: { color: Colors.textSecondary, fontSize: 11, textAlign: 'center', paddingTop: Spacing.md },
});
