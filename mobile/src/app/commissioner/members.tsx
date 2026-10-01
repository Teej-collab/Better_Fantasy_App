import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CommishScreen, commishStyles as s, ErrorText, errorMessage, OutlineButton, SectionHead } from '@/components/commissioner/CommishUI';
import { ListPanel } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useActiveLeague, useLeagueMembers, useMe } from '@/lib/queries';

// Port of the web's MembersSection: promote, demote, or remove members.
export default function MembersScreen() {
  const accent = useAppearance().accent;
  const myUserId = useMe().data?.user_id;
  const league = useActiveLeague().data;
  const members = useLeagueMembers(league?.id);
  const [error, setError] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [removeBusyId, setRemoveBusyId] = useState<number | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['league-members', league?.id] });
  }

  async function changeRole(userId: number, role: 'commissioner' | 'member') {
    if (!league) return;
    setRoleBusyId(userId);
    try {
      await api.setMemberRole(league.id, userId, role);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Couldn't change that member's role."));
    } finally {
      setRoleBusyId(null);
    }
  }

  async function remove(userId: number) {
    if (!league) return;
    setRemoveBusyId(userId);
    try {
      await api.removeMember(league.id, userId);
      setConfirmId(null);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Couldn't remove that member."));
    } finally {
      setRemoveBusyId(null);
    }
  }

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Members' }} />
      <SectionHead title="Members" />
      {error && <ErrorText>{error}</ErrorText>}
      {members.isPending && league?.id !== undefined ? (
        <LoadingState />
      ) : !members.data?.length ? (
        <Text style={s.muted}>No members yet.</Text>
      ) : (
        <ListPanel color={accent}>
          {members.data.map((m, i) => (
            <View key={m.user_id} style={[s.item, i > 0 && s.divided]}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.body}>
                  {m.display_name} <Text style={s.small}>{m.role === 'commissioner' ? '· Commissioner' : ''}</Text>
                </Text>
                {m.user_id !== myUserId && (
                  <View style={s.row}>
                    <OutlineButton
                      small
                      label={m.role === 'commissioner' ? 'Demote' : 'Promote'}
                      disabled={roleBusyId === m.user_id}
                      onPress={() => changeRole(m.user_id, m.role === 'commissioner' ? 'member' : 'commissioner')}
                    />
                    <OutlineButton small tone="danger" label="Remove" onPress={() => setConfirmId(m.user_id)} />
                  </View>
                )}
              </View>
              {confirmId === m.user_id && (
                <View style={s.dangerBox}>
                  <Text style={s.small}>
                    Remove {m.display_name} from this league? They&apos;ll lose access, but their history and any current team stay
                    untouched — reassign their team separately on the Teams page if needed.
                  </Text>
                  <View style={s.row}>
                    <OutlineButton
                      tone="danger"
                      label={removeBusyId === m.user_id ? 'Removing…' : 'Confirm remove'}
                      disabled={removeBusyId === m.user_id}
                      onPress={() => remove(m.user_id)}
                    />
                    <OutlineButton label="Cancel" onPress={() => setConfirmId(null)} />
                  </View>
                </View>
              )}
            </View>
          ))}
        </ListPanel>
      )}
    </CommishScreen>
  );
}
