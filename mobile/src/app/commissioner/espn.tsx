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
  PrimaryButton,
  SectionHead,
} from '@/components/commissioner/CommishUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { queryClient, useEspnConnection } from '@/lib/queries';

type Panel = 'idle' | 'connecting' | 'syncing' | 'disconnecting';

// Port of the web's EspnConnectionSection: connect your own ESPN
// league, sync on demand, or disconnect.
export default function EspnConnectionScreen() {
  const q = useEspnConnection();
  const [leagueId, setLeagueId] = useState('');
  const [s2, setS2] = useState('');
  const [swid, setSwid] = useState('');
  const [panel, setPanel] = useState<Panel>('idle');
  const [error, setError] = useState<string | null>(null);
  const status = q.data;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['espn-connection'] });
  }

  async function connect() {
    const id = Number(leagueId);
    if (!Number.isFinite(id) || id <= 0) return setError('Enter a valid ESPN League ID.');
    if (!s2.trim() || !swid.trim()) return setError('ESPN_S2 and SWID are both required.');
    setPanel('connecting');
    setError(null);
    try {
      await api.connectEspn(id, s2.trim(), swid.trim());
      await refresh();
      setS2('');
      setSwid('');
    } catch (e) {
      setError(errorMessage(e, "Couldn't connect that ESPN league."));
    } finally {
      setPanel('idle');
    }
  }

  async function run(next: Panel, action: () => Promise<unknown>, fallback: string) {
    setPanel(next);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, fallback));
    } finally {
      setPanel('idle');
    }
  }

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'ESPN Connection' }} />
      <SectionHead title="ESPN Connection" subtitle="Import teams, matchups, and standings from a real ESPN league into this league." />
      {q.isPending ? (
        <LoadingState />
      ) : !status ? (
        <ErrorText>{errorMessage(q.error, "Couldn't load ESPN connection status.")}</ErrorText>
      ) : status.connected ? (
        <View style={s.gap}>
          <View style={{ gap: 4 }}>
            <Text style={s.bodySoft}>
              Connected to ESPN league <Text style={s.medium}>{status.espn_league_id}</Text>
            </Text>
            <Text style={s.muted}>
              {status.last_synced_at ? `Last synced ${new Date(status.last_synced_at).toLocaleString()}` : 'Never synced yet'}
            </Text>
            {status.last_sync_error && <ErrorText>Last sync failed: {status.last_sync_error}</ErrorText>}
          </View>
          <View style={s.row}>
            <PrimaryButton
              label="Sync now"
              busyLabel="Syncing…"
              busy={panel === 'syncing'}
              disabled={panel === 'disconnecting'}
              onPress={() => run('syncing', api.syncEspn, 'Sync failed.')}
            />
            <OutlineButton
              label={panel === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
              disabled={panel !== 'idle'}
              onPress={() => run('disconnecting', api.disconnectEspn, "Couldn't disconnect.")}
            />
          </View>
          {error && <ErrorText>{error}</ErrorText>}
        </View>
      ) : (
        <View style={s.gap}>
          <View style={s.gapSm}>
            <Text style={s.bodySoft}>ESPN League ID</Text>
            <Text style={s.small}>The number in your league&apos;s ESPN URL (fantasy.espn.com/football/league?leagueId=...).</Text>
            <Input value={leagueId} onChangeText={setLeagueId} numeric />
          </View>
          <View style={s.gapSm}>
            <Text style={s.bodySoft}>ESPN_S2</Text>
            <Text style={s.small}>From a private league only — your browser&apos;s espn_s2 cookie value while signed into ESPN.</Text>
            <Input value={s2} onChangeText={setS2} secure />
          </View>
          <View style={s.gapSm}>
            <Text style={s.bodySoft}>SWID</Text>
            <Text style={s.small}>Your browser&apos;s SWID cookie value, including the curly braces.</Text>
            <Input value={swid} onChangeText={setSwid} />
          </View>
          <View style={s.row}>
            <PrimaryButton label="Connect ESPN league" busyLabel="Connecting…" busy={panel === 'connecting'} onPress={connect} />
          </View>
          {error && <ErrorText>{error}</ErrorText>}
        </View>
      )}
    </CommishScreen>
  );
}
