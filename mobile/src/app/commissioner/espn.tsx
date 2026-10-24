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
import { Segmented } from '@/components/commissioner/CommishParts';
import { queryClient, useEspnConnection, useSleeperConnection } from '@/lib/queries';

type Panel = 'idle' | 'connecting' | 'syncing' | 'disconnecting';

// Bring your league in from ESPN or Sleeper (2026-10-24): teams,
// matchups and live scores sync in, and everything else here (recaps,
// write-ups, chat, the trade tools) runs on top. ESPN takes the league's
// link (a public league needs nothing else); Sleeper takes its link.
// Same as the web's EspnConnectionSection.

type Source = 'espn' | 'sleeper';

export default function ImportLeagueScreen() {
  const espn = useEspnConnection().data;
  const sleeper = useSleeperConnection().data;
  const connected: Source | null = espn?.connected ? 'espn' : sleeper?.connected ? 'sleeper' : null;
  const [picked, setPicked] = useState<Source>('espn');
  const source = connected ?? picked;
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Bring Your League In' }} />
      <SectionHead
        title="Bring your league in"
        subtitle="Keep playing where you play. Your teams, matchups and live scores sync here, and everything else is built on top."
      />
      {connected === null && (
        <Segmented
          options={[
            { value: 'espn', label: 'ESPN' },
            { value: 'sleeper', label: 'Sleeper' },
          ]}
          value={source}
          onChange={setPicked}
        />
      )}
      {source === 'espn' ? <EspnPanel /> : <SleeperPanel />}
      {connected === null && <Text style={s.small}>Yahoo is coming next.</Text>}
    </CommishScreen>
  );
}

function SleeperPanel() {
  const q = useSleeperConnection();
  const [link, setLink] = useState('');
  const [panel, setPanel] = useState<Panel>('idle');
  const [error, setError] = useState<string | null>(null);
  const status = q.data;

  async function run(next: Panel, action: () => Promise<unknown>, fallback: string) {
    setPanel(next);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['sleeper-connection'] });
      await queryClient.invalidateQueries({ queryKey: ['commish'] });
    } catch (e) {
      setError(errorMessage(e, fallback));
    } finally {
      setPanel('idle');
    }
  }

  if (q.isPending) return <LoadingState />;
  if (!status) return <ErrorText>{errorMessage(q.error, "Couldn't load the Sleeper connection.")}</ErrorText>;
  if (status.connected) {
    return (
      <View style={s.gap}>
        <View style={{ gap: 4 }}>
          <Text style={s.bodySoft}>
            Connected to <Text style={s.medium}>{status.league_name ?? `Sleeper league ${status.sleeper_league_id}`}</Text>
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
            onPress={() => run('syncing', api.syncSleeper, 'Sync failed.')}
          />
          <OutlineButton
            label={panel === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
            disabled={panel !== 'idle'}
            onPress={() => run('disconnecting', api.disconnectSleeper, "Couldn't disconnect.")}
          />
        </View>
        {error && <ErrorText>{error}</ErrorText>}
      </View>
    );
  }
  return (
    <View style={s.gap}>
      <View style={s.gapSm}>
        <Text style={s.bodySoft}>Your league’s Sleeper link</Text>
        <Text style={s.small}>
          Open your league at sleeper.com and copy the address (sleeper.com/leagues/…), or paste just the league ID. Nothing else is
          needed: Sleeper leagues connect without a sign-in.
        </Text>
        <Input value={link} onChangeText={setLink} placeholder="https://sleeper.com/leagues/…" />
      </View>
      <View style={s.row}>
        <PrimaryButton
          label="Connect Sleeper league"
          busyLabel="Connecting…"
          busy={panel === 'connecting'}
          onPress={() => {
            if (!link.trim()) return setError('Paste your league’s Sleeper link.');
            void run('connecting', () => api.connectSleeper(link.trim()), "Couldn't connect that Sleeper league.");
          }}
        />
      </View>
      {error && <ErrorText>{error}</ErrorText>}
    </View>
  );
}

function EspnPanel() {
  const q = useEspnConnection();
  const [link, setLink] = useState('');
  const [s2, setS2] = useState('');
  const [swid, setSwid] = useState('');
  const [showPrivate, setShowPrivate] = useState(false);
  const [panel, setPanel] = useState<Panel>('idle');
  const [error, setError] = useState<string | null>(null);
  const status = q.data;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['espn-connection'] });
  }

  async function connect() {
    if (!link.trim()) return setError('Paste your league’s link from ESPN.');
    if (showPrivate && (!s2.trim() || !swid.trim())) return setError('Add both espn_s2 and SWID, or leave both empty.');
    setPanel('connecting');
    setError(null);
    try {
      await api.connectEspn(link.trim(), showPrivate ? s2.trim() : undefined, showPrivate ? swid.trim() : undefined);
      await refresh();
      setS2('');
      setSwid('');
    } catch (e) {
      const message = errorMessage(e, "Couldn't connect that ESPN league.");
      setError(message);
      if (message.includes('is private')) setShowPrivate(true);
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
    <View style={s.gap}>
      {q.isPending ? (
        <LoadingState />
      ) : !status ? (
        <ErrorText>{errorMessage(q.error, "Couldn't load ESPN connection status.")}</ErrorText>
      ) : status.connected ? (
        <View style={s.gap}>
          <View style={{ gap: 4 }}>
            <Text style={s.bodySoft}>
              Connected to ESPN league <Text style={s.medium}>{status.espn_league_id}</Text>
              {status.public ? ' (public)' : ''}
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
            <Text style={s.bodySoft}>1. Copy your league’s link</Text>
            <Text style={s.small}>
              Open your league at fantasy.espn.com and copy the address from the browser bar. It has leagueId= in it. Just the
              number works too.
            </Text>
            <Input value={link} onChangeText={setLink} placeholder="https://fantasy.espn.com/football/league?leagueId=…" />
          </View>
          <View style={s.gapSm}>
            <Text style={s.bodySoft}>2. Turn on “Viewable to Public”</Text>
            <Text style={s.small}>
              In ESPN as the league manager: League Manager → Settings → Basic Settings → “Make League Viewable to Public.” Your league
              stays private and your rules don’t change; this only lets The Weekend read your scores. You can turn it off anytime.
            </Text>
          </View>

          {showPrivate ? (
            <View style={s.gap}>
              <Text style={s.bodySoft}>Keeping it private?</Text>
              <Text style={s.small}>
                Then this needs two sign-in values from ESPN, which only show up on a computer: sign in at espn.com, open the browser’s
                developer tools → Application → Cookies → espn.com, and copy espn_s2 and SWID (with the curly braces).
              </Text>
              <Input value={s2} onChangeText={setS2} placeholder="espn_s2" secure />
              <Input value={swid} onChangeText={setSwid} placeholder="SWID {…}" />
            </View>
          ) : (
            <OutlineButton label="My league is private" onPress={() => setShowPrivate(true)} />
          )}

          <View style={s.row}>
            <PrimaryButton label="Connect ESPN league" busyLabel="Connecting…" busy={panel === 'connecting'} onPress={connect} />
          </View>
          {error && <ErrorText>{error}</ErrorText>}
        </View>
      )}
    </View>
  );
}
