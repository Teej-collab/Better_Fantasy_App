import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  CommishScreen,
  commishStyles as s,
  ErrorText,
  errorMessage,
  Input,
  OutlineButton,
  Picker,
  PrimaryButton,
  SectionHead,
} from '@/components/commissioner/CommishUI';
import { ListPanel } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useActiveLeague, useLeagueMembers, useLeagueTeams } from '@/lib/queries';

// Port of the web's TeamsSection: reassign a team, or add one for a member.
export default function TeamsScreen() {
  const accent = useAppearance().accent;
  const league = useActiveLeague().data;
  const members = useLeagueMembers(league?.id).data ?? [];
  const teams = useLeagueTeams(league?.id);
  const memberOptions = members.map((m) => ({ value: m.user_id, label: m.display_name }));
  const [error, setError] = useState<string | null>(null);

  const [reassignTeamId, setReassignTeamId] = useState<number | null>(null);
  const [reassignUserId, setReassignUserId] = useState<number | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addUserId, setAddUserId] = useState<number | null>(null);
  const [addName, setAddName] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['league-teams', league?.id] }),
      queryClient.invalidateQueries({ queryKey: ['league-members', league?.id] }),
    ]);
  }

  async function submitReassign() {
    if (!league || reassignTeamId === null || reassignUserId === null) return;
    setReassignBusy(true);
    try {
      await api.reassignTeam(league.id, reassignTeamId, reassignUserId);
      setReassignTeamId(null);
      setReassignUserId(null);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Couldn't reassign that team."));
    } finally {
      setReassignBusy(false);
    }
  }

  async function submitAdd() {
    if (!league || addUserId === null || !addName.trim()) return;
    setAddBusy(true);
    try {
      await api.createTeamForMember(league.id, addUserId, addName.trim());
      setShowAdd(false);
      setAddUserId(null);
      setAddName('');
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Couldn't create that team."));
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Teams' }} />
      <SectionHead title="Teams" />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={s.gapSm}>
        <OutlineButton label={showAdd ? 'Cancel' : '+ Add team for a member'} onPress={() => setShowAdd((v) => !v)} />
        {showAdd && (
          <View style={s.box}>
            <Picker value={addUserId} options={memberOptions} placeholder="Pick a member…" onChange={setAddUserId} />
            <Input value={addName} onChangeText={setAddName} placeholder="Team name" />
            <PrimaryButton
              label="Create team"
              busyLabel="Creating…"
              busy={addBusy}
              disabled={addUserId === null || !addName.trim()}
              onPress={submitAdd}
            />
          </View>
        )}
      </View>

      {teams.isPending && league?.id !== undefined ? (
        <LoadingState />
      ) : !teams.data?.length ? (
        <Text style={s.muted}>No teams yet.</Text>
      ) : (
        <ListPanel color={accent}>
          {teams.data.map((t, i) => (
            <View key={t.team_id} style={[s.item, i > 0 && s.divided]}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={[s.body, s.flex]}>
                  {t.team_name} <Text style={s.label}>— {t.owner_name}</Text>
                </Text>
                <OutlineButton
                  small
                  label="Reassign"
                  onPress={() => {
                    setReassignTeamId(reassignTeamId === t.team_id ? null : t.team_id);
                    setReassignUserId(null);
                  }}
                />
              </View>
              {reassignTeamId === t.team_id && (
                <View style={s.row}>
                  <Picker value={reassignUserId} options={memberOptions} placeholder="Pick a member…" onChange={setReassignUserId} />
                  <PrimaryButton label="Confirm" busyLabel="Reassigning…" busy={reassignBusy} disabled={reassignUserId === null} onPress={submitReassign} />
                </View>
              )}
            </View>
          ))}
        </ListPanel>
      )}
    </CommishScreen>
  );
}
