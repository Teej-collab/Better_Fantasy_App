import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  CommishScreen,
  commishStyles as s,
  ErrorText,
  errorMessage,
  GroupLabel,
  Input,
  OutlineButton,
  PrimaryButton,
  SectionHead,
} from '@/components/commissioner/CommishUI';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { queryClient, useActiveLeague, useRivalrySuggestions } from '@/lib/queries';
import type { RivalrySuggestion } from '@/lib/types';

// Port of the web's RivalrySuggestionsSection: rivalries the league's
// history suggests; the commissioner names one and makes it official,
// or dismisses it for good.
export default function RivalriesScreen() {
  const league = useActiveLeague().data;
  const suggestions = useRivalrySuggestions(league?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['rivalrySuggestions', league?.id] });
    await queryClient.invalidateQueries({ queryKey: ['commish', 'summary'] });
  }

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Rivalries' }} />
      <SectionHead
        title="Rivalries"
        subtitle="Pairs your league's history says have real beef. Make one official and it shows on the Rivalries page and in their matchups."
      />
      {error && <ErrorText>{error}</ErrorText>}
      {suggestions.isPending ? (
        <Text style={s.muted}>Looking through your league&apos;s history…</Text>
      ) : !suggestions.data?.length ? (
        <Text style={s.muted}>No new rivalries to review. New ones show up here as your league plays more games.</Text>
      ) : (
        suggestions.data.map((sug) =>
          league ? <SuggestionCard key={sug.id} leagueId={league.id} suggestion={sug} onDone={refresh} onError={setError} /> : null,
        )
      )}
    </CommishScreen>
  );
}

function SuggestionCard({
  leagueId,
  suggestion: sug,
  onDone,
  onError,
}: {
  leagueId: number;
  suggestion: RivalrySuggestion;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(sug.suggested_name ?? `${sug.owner_a_name} vs ${sug.owner_b_name}`);
  const [tagline, setTagline] = useState(sug.suggested_tagline ?? '');
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);

  async function act(kind: 'approve' | 'dismiss') {
    setBusy(kind);
    try {
      if (kind === 'approve') await api.approveRivalry(leagueId, sug.id, name.trim(), tagline.trim());
      else await api.dismissRivalry(leagueId, sug.id);
      await onDone();
    } catch (e) {
      onError(errorMessage(e, "Couldn't save that."));
      setBusy(null);
    }
  }

  return (
    <View style={s.box}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={[s.medium, s.flex]}>
          {sug.owner_a_name} vs {sug.owner_b_name}
        </Text>
        <Text style={s.small}>{sug.tier}</Text>
      </View>
      {sug.reasons.map((reason) => (
        <Text key={reason} style={[s.small, { color: 'rgba(255,255,255,0.7)' }]}>
          · {reason}
        </Text>
      ))}
      <GroupLabel>Name</GroupLabel>
      <Input value={name} onChangeText={setName} placeholder="Rivalry name" />
      <GroupLabel>Tagline</GroupLabel>
      <Input value={tagline} onChangeText={setTagline} placeholder="Optional" />
      <View style={s.row}>
        <PrimaryButton
          label="Make it official"
          busyLabel="Saving…"
          busy={busy === 'approve'}
          disabled={busy !== null || !name.trim()}
          onPress={() => act('approve')}
        />
        <OutlineButton label={busy === 'dismiss' ? 'Dismissing…' : 'Not a rivalry'} disabled={busy !== null} onPress={() => act('dismiss')} />
      </View>
    </View>
  );
}
