import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, Divided, relativeTime, RoleBadge } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { api } from '@/lib/api';

// Port of the web's AdminLeagueDetail.
export default function AdminLeagueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leagueId = Number(id);
  const q = useQuery({ queryKey: ['admin', 'league', leagueId], queryFn: () => api.admin.league(leagueId, 7) });
  const league = q.data;
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: league?.name ?? 'League' }} />
      {!league ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load this league.</Text>
      ) : (
        <>
          <View style={{ gap: 2 }}>
            <Text style={styles.name}>{league.name}</Text>
            <Text style={s.soft}>
              Created {relativeTime(league.created_at)} · Invite code {league.invite_code}
            </Text>
          </View>
          <AdminSection title={`Members (${league.members.length})`}>
            {league.members.map((m, i) => (
              <Divided key={m.user_id} index={i}>
                <View style={s.between}>
                  <Pressable
                    disabled={!m.owner_id}
                    onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: String(m.user_id) } })}
                    style={s.flex}>
                    <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                      <Text style={s.medium}>{m.display_name}</Text>
                      {m.role === 'commissioner' && <RoleBadge label="Commissioner" />}
                    </View>
                    <Text style={s.small}>{m.team_name ?? 'No team yet'}</Text>
                  </Pressable>
                  <View>
                    <Text style={[s.small, s.right]}>{m.last_active ? `Active ${relativeTime(m.last_active)}` : 'Never active'}</Text>
                    <Text style={[s.small, s.right]}>{m.recent_events} events (7d)</Text>
                  </View>
                </View>
              </Divided>
            ))}
          </AdminSection>
        </>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  name: { color: Colors.text, fontSize: 20, fontWeight: '600' },
});
