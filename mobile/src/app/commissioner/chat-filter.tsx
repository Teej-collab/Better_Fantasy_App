import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { CommishScreen, commishStyles as s, ErrorText, errorMessage, Input, PrimaryButton, SectionHead } from '@/components/commissioner/CommishUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { queryClient, useChatFilter } from '@/lib/queries';

// The league's own chat-filter words (2026-10). Slurs and hate speech are
// masked in every league already (backend app/moderation.py); these are
// extra words this league wants hidden too — in chat, the draft room, and
// the Punishment Wheel. Each change saves right away.
export default function ChatFilterScreen() {
  const q = useChatFilter();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = q.data?.words ?? [];

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(['chat-filter'], await api.updateChatFilter(next));
      return true;
    } catch (e) {
      setError(errorMessage(e, "Couldn't save the filter."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const word = draft.trim().toLowerCase();
    if (!word) return;
    if (/\s/.test(word)) return setError('One word at a time.');
    if (words.includes(word)) return setDraft('');
    if (await save([...words, word])) setDraft('');
  }

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Chat Filter' }} />
      <SectionHead
        title="Chat Filter"
        subtitle="Slurs and hate speech are always hidden in every league. Add any other words you want masked with *** in your league's chat, draft room and Punishment Wheel. Regular swearing is allowed unless you add it here."
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorText>{errorMessage(q.error, "Couldn't load the filter.")}</ErrorText>
      ) : (
        <View style={s.gap}>
          <View style={s.row}>
            <Input value={draft} onChangeText={setDraft} placeholder="Add a word" maxLength={40} onSubmitEditing={() => void add()} style={{ flex: 1 }} />
            <PrimaryButton label="Add" busyLabel="Saving…" busy={busy} disabled={!draft.trim()} onPress={() => void add()} />
          </View>
          {error && <ErrorText>{error}</ErrorText>}
          {words.length === 0 ? (
            <Text style={s.muted}>No extra words yet — only the built-in list applies.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {words.map((word) => (
                <Pressable
                  key={word}
                  disabled={busy}
                  onPress={() => void save(words.filter((w) => w !== word))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${word}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                  <Text style={s.bodySoft}>{word}</Text>
                  <Text style={s.muted}>✕</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </CommishScreen>
  );
}
