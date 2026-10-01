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
import { ListPanel } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useActiveLeague, usePolls } from '@/lib/queries';

// Port of the web's PollsManagementSection: create, watch results, close.
export default function PollsScreen() {
  const accent = useAppearance().accent;
  const league = useActiveLeague().data;
  const polls = usePolls(league?.id ?? null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [createBusy, setCreateBusy] = useState(false);
  const [closeBusyId, setCloseBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['polls', league?.id] });
  }

  async function create() {
    if (!league || !question.trim() || cleanOptions.length < 2) return;
    setCreateBusy(true);
    try {
      await api.createPoll(league.id, question.trim(), cleanOptions);
      setQuestion('');
      setOptions(['', '']);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Couldn't create that poll."));
    } finally {
      setCreateBusy(false);
    }
  }

  async function close(pollId: number) {
    if (!league) return;
    setCloseBusyId(pollId);
    try {
      await api.closePoll(league.id, pollId);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Couldn't close that poll."));
    } finally {
      setCloseBusyId(null);
    }
  }

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Polls' }} />
      <SectionHead title="Polls" subtitle="Ask your league a question — members vote from the League Overview page." />
      {error && <ErrorText>{error}</ErrorText>}

      <View style={s.box}>
        <GroupLabel>New poll</GroupLabel>
        <Input value={question} onChangeText={setQuestion} placeholder="Ask your league a question…" />
        {options.map((opt, i) => (
          <Input
            key={i}
            value={opt}
            onChangeText={(v) => setOptions((prev) => prev.map((o, j) => (j === i ? v : o)))}
            placeholder={`Option ${i + 1}`}
          />
        ))}
        <View style={s.row}>
          <OutlineButton label="+ Add option" onPress={() => setOptions((prev) => [...prev, ''])} />
          <PrimaryButton
            label="Create poll"
            busyLabel="Creating…"
            busy={createBusy}
            disabled={!question.trim() || cleanOptions.length < 2}
            onPress={create}
          />
        </View>
      </View>

      {!polls.data?.length ? (
        <Text style={s.muted}>No polls yet.</Text>
      ) : (
        <ListPanel color={accent}>
          {polls.data.map((p, i) => {
            const total = p.results.reduce((a, b) => a + b, 0);
            return (
              <View key={p.id} style={[s.item, i > 0 && s.divided]}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <Text style={[s.medium, s.flex]}>
                    {p.question} <Text style={s.small}>{p.status === 'closed' ? '· Closed' : '· Open'}</Text>
                  </Text>
                  {p.status === 'open' && (
                    <OutlineButton small label={closeBusyId === p.id ? 'Closing…' : 'Close'} disabled={closeBusyId === p.id} onPress={() => close(p.id)} />
                  )}
                </View>
                {p.options.map((opt, j) => (
                  <View key={j} style={[s.row, { justifyContent: 'space-between' }]}>
                    <Text style={[s.small, { color: 'rgba(255,255,255,0.7)' }]}>{opt}</Text>
                    <Text style={[s.small, { fontVariant: ['tabular-nums'] }]}>
                      {p.results[j]} {p.results[j] === 1 ? 'vote' : 'votes'}
                      {total > 0 ? ` (${Math.round((p.results[j] / total) * 100)}%)` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </ListPanel>
      )}
    </CommishScreen>
  );
}
