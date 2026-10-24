import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { Field, GhostButton, Icon, Kicker, NeonButton, StartScreen, startStyles, Sub, Title } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { joinLinkFor } from '@/lib/qrJoin';
import { queryClient } from '@/lib/queries';
import type { ImportPreview, LeagueInfo } from '@/lib/types';

// Bring a league in from ESPN or Sleeper (2026-10-24, the approved
// "Connect & Share" mockups): paste the link → "Found your league" with
// its teams → the league is created here, connected and synced → pick
// which team is yours → send everyone the invite to claim theirs. No
// scoring or roster setup: that comes from ESPN or Sleeper. ?from=espn|sleeper.

type Platform = 'espn' | 'sleeper';
type Step = 'link' | 'found' | 'claim' | 'invite';

const COLORS = ['#38bdf8', '#f97316', '#a78bfa', '#facc15', '#4ade80', '#f87171'];

export default function ConnectLeagueScreen() {
  const params = useLocalSearchParams<{ from?: string }>();
  const platform: Platform = params.from === 'sleeper' ? 'sleeper' : 'espn';
  const name = platform === 'espn' ? 'ESPN' : 'Sleeper';
  const { signInWithToken } = useAuth();
  const [step, setStep] = useState<Step>('link');
  const [link, setLink] = useState('');
  const [showPrivate, setShowPrivate] = useState(false);
  const [s2, setS2] = useState('');
  const [swid, setSwid] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [owners, setOwners] = useState<{ owner_id: number; display_name: string; team_name?: string | null }[]>([]);
  const [mine, setMine] = useState<number | null>(null);
  const [unclaimedLeft, setUnclaimedLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sleeper by username (2026-10-24): no link to copy.
  const [username, setUsername] = useState('');
  const [sleeperLeagues, setSleeperLeagues] = useState<{ league_id: string; name: string; teams: number | null }[] | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      haptics.error();
      const message = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      setError(message);
      if (message.includes('is private')) setShowPrivate(true);
    } finally {
      setBusy(false);
    }
  }

  const lookUp = () =>
    run(async () => {
      if (!username.trim()) throw new Error('Type your Sleeper username.');
      const r = await api.sleeperLeagues(username.trim());
      setSleeperLeagues(r.leagues);
      if (r.leagues.length === 0) throw new Error(`No ${r.season} leagues on that account yet.`);
    });

  const pickSleeper = (leagueId: string) => {
    setLink(leagueId);
    void find(leagueId);
  };

  const find = (picked?: string) =>
    run(async () => {
      const target = (picked ?? link).trim();
      if (!target) throw new Error(`Paste your league's ${name} link.`);
      const found = await api.importPreview(platform, target, showPrivate ? s2.trim() : undefined, showPrivate ? swid.trim() : undefined);
      setPreview(found);
      haptics.success();
      setStep('found');
    });

  const bringIn = () =>
    run(async () => {
      if (!preview) return;
      // A retry after a failed connect reuses the league already made.
      const created = league ?? (await api.createLeague(preview.name, { teamCount: preview.team_count, makeActive: true }));
      setLeague(created);
      if (platform === 'espn') await api.connectEspn(link.trim(), showPrivate ? s2.trim() : undefined, showPrivate ? swid.trim() : undefined);
      else await api.connectSleeper(link.trim());
      if (platform === 'espn') await api.syncEspn().catch(() => {});
      setLeague(created);
      const list = await api.unclaimedOwners(created.id).catch(() => []);
      setOwners(list);
      setStep('claim');
    });

  const claim = () =>
    run(async () => {
      if (!league || mine === null) return;
      const { token } = await api.claimOwner(league.id, mine);
      await signInWithToken(token);
      const left = await api.unclaimedOwners(league.id).catch(() => []);
      setUnclaimedLeft(left.length);
      await queryClient.invalidateQueries();
      haptics.success();
      setStep('invite');
    });

  if (step === 'invite' && league && preview) {
    const joinLink = joinLinkFor(league.invite_code);
    const claimed = preview.team_count - (unclaimedLeft ?? preview.team_count - 1);
    const message = `Our league is on The Weekend now: write-ups before every matchup, live gamecasts and a real league chat. Still on ${name}, nothing changes there. Tap to claim your team: ${joinLink}`;
    return (
      <StartScreen
        footer={
          <>
            <NeonButton label="Send to the group chat" onPress={() => void Share.share({ message })} />
            <Pressable
              onPress={() => {
                router.dismissAll();
                router.replace('/');
              }}
              accessibilityRole="button"
              style={styles.textButton}>
              <Text style={startStyles.muted}>Go to my league</Text>
            </Pressable>
          </>
        }>
        <Stack.Screen options={{ title: 'Bring Everyone In', headerBackVisible: false }} />
        <View style={styles.head}>
          <Kicker>Your league is here</Kicker>
          <Title>Now bring everyone in</Title>
          <Sub>Send one message to your group chat. Each person taps the link, signs up and picks their team.</Sub>
        </View>
        <View style={startStyles.card}>
          <Kicker>The message</Kicker>
          <Text style={styles.message}>{message}</Text>
        </View>
        <View style={styles.progressTop}>
          <Text style={styles.sectionTitle}>Who&apos;s claimed</Text>
          <Text style={styles.count}>
            {claimed} of {preview.team_count}
          </Text>
        </View>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.max(4, (claimed / Math.max(1, preview.team_count)) * 100)}%` }]} />
        </View>
        <Text style={startStyles.muted}>It fills in as people join. Their scores and history are already here.</Text>
      </StartScreen>
    );
  }

  if (step === 'claim' && league) {
    return (
      <StartScreen footer={<NeonButton label="That's me" onPress={claim} disabled={mine === null} busy={busy} />}>
        <Stack.Screen options={{ title: 'Your Team', headerBackVisible: false }} />
        <View style={styles.head}>
          <Kicker>{league.name} is here</Kicker>
          <Title>Which team is yours?</Title>
          <Sub>These came from your league on {name}.</Sub>
        </View>
        {owners.length === 0 && <Text style={startStyles.muted}>Still bringing your teams in. Pull down on Home in a minute if they don&apos;t show.</Text>}
        {owners.map((o, i) => {
          const on = mine === o.owner_id;
          return (
            <Pressable
              key={o.owner_id}
              onPress={() => {
                haptics.select();
                setMine(o.owner_id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={[styles.team, on && styles.teamOn]}>
              <View style={[styles.avatar, { backgroundColor: COLORS[i % COLORS.length] }]}>
                <Text style={styles.avatarText}>{(o.team_name ?? o.display_name).slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.teamName}>{o.team_name ?? o.display_name}</Text>
                <Text style={startStyles.muted}>
                  {name} owner: {o.display_name}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {error && <Text style={startStyles.error}>{error}</Text>}
      </StartScreen>
    );
  }

  if (step === 'found' && preview) {
    return (
      <StartScreen
        footer={
          <>
            <NeonButton label="This is my league" onPress={bringIn} busy={busy} />
            <GhostButton label="Not it? Paste a different link" onPress={() => setStep('link')} />
          </>
        }>
        <Stack.Screen options={{ title: `From ${name}` }} />
        <View style={startStyles.card}>
          <View style={startStyles.found}>
            <Icon name="check" color={Colors.accent} size={18} />
            <Text style={startStyles.foundText}>Found {preview.name}</Text>
          </View>
          <Text style={startStyles.muted}>
            {preview.season} season · {preview.team_count} teams · Week {preview.current_week}
          </Text>
          <View style={styles.grid}>
            {preview.teams.slice(0, 6).map((t, i) => (
              <View key={`${t.team_name}-${i}`} style={styles.cell}>
                <View style={[styles.dot, { backgroundColor: COLORS[i % COLORS.length] }]} />
                <View style={styles.flex}>
                  <Text style={styles.cellName} numberOfLines={1}>
                    {t.team_name}
                  </Text>
                  {t.owner_name ? (
                    <Text style={styles.cellSub} numberOfLines={1}>
                      {t.owner_name}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
          {preview.teams.length > 6 && <Text style={startStyles.muted}>+ {preview.teams.length - 6} more teams</Text>}
        </View>
        <View style={styles.list}>
          <Text style={styles.check}>✓ Every week&apos;s matchups and scores so far</Text>
          <Text style={styles.check}>✓ Live scoring during games</Text>
          <Text style={styles.check}>✓ Write-ups, recaps, trade tools and chat on top</Text>
          <Text style={styles.check}>✓ Your league keeps running on {name}, nothing changes there</Text>
        </View>
        {error && <Text style={startStyles.error}>{error}</Text>}
      </StartScreen>
    );
  }

  return (
    <StartScreen
      footer={
        platform === 'espn' || link.trim() ? (
          <NeonButton label="Find my league" onPress={() => void find()} busy={busy} disabled={!link.trim()} />
        ) : undefined
      }>
      <Stack.Screen options={{ title: `From ${name}` }} />
      <View style={styles.head}>
        <Kicker>{name}</Kicker>
        <Title>{platform === 'espn' ? 'Paste your league link' : "What's your Sleeper username?"}</Title>
        <Sub>
          {platform === 'espn'
            ? 'In the ESPN Fantasy app, open your league → Invite friends (or Share) → Copy link, and paste it here. A link from fantasy.espn.com or just the league number works too.'
            : 'We’ll find your leagues. No sign-in or link needed.'}
        </Sub>
      </View>
      {platform === 'sleeper' && (
        <View style={styles.list}>
          <Field
            label="Sleeper username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="your username"
            onSubmitEditing={() => void lookUp()}
          />
          <GhostButton label={busy && !sleeperLeagues ? 'Looking…' : 'Find my leagues'} onPress={() => void lookUp()} disabled={!username.trim() || busy} />
          {sleeperLeagues?.map((lg) => (
            <Pressable
              key={lg.league_id}
              onPress={() => {
                haptics.select();
                pickSleeper(lg.league_id);
              }}
              accessibilityRole="button"
              style={styles.team}>
              <View style={styles.flex}>
                <Text style={styles.teamName}>{lg.name}</Text>
                {lg.teams ? <Text style={startStyles.muted}>{lg.teams} teams</Text> : null}
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
          <Text style={startStyles.muted}>Or paste a league link from sleeper.com instead:</Text>
        </View>
      )}
      <Field
        label={`${name} league link`}
        value={link}
        onChangeText={setLink}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={platform === 'espn' ? 'https://fantasy.espn.com/football/league?leagueId=…' : 'https://sleeper.com/leagues/…'}
      />
      {platform === 'espn' && (
        <View style={startStyles.card}>
          <Kicker>Before you tap Find</Kicker>
          <Text style={styles.cardTitle}>Turn on “Viewable to Public”</Text>
          <Text style={startStyles.muted}>
            On fantasy.espn.com as the league manager (your phone’s browser works; the ESPN app doesn’t have this setting): League Manager →
            Settings → Basic Settings → “Make League Viewable to Public.” Your league stays private and your rules don’t change; this only lets
            The Weekend read your scores. You can turn it off anytime.
          </Text>
        </View>
      )}
      {platform === 'espn' &&
        (showPrivate ? (
          <View style={styles.list}>
            <Text style={startStyles.muted}>
              Keeping it private? Sign in at espn.com on a computer, open the browser’s developer tools → Application → Cookies → espn.com, and
              copy espn_s2 and SWID (with the curly braces).
            </Text>
            <Field label="espn_s2" value={s2} onChangeText={setS2} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Field label="SWID" value={swid} onChangeText={setSwid} autoCapitalize="none" autoCorrect={false} />
          </View>
        ) : (
          <GhostButton label="My league is private" onPress={() => setShowPrivate(true)} />
        ))}
      {error && <Text style={startStyles.error}>{error}</Text>}
    </StartScreen>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6 },
  flex: { flex: 1, minWidth: 0 },
  list: { gap: 8 },
  check: { color: Colors.text, fontSize: 14 },
  cardTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '48%', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 8 },
  dot: { width: 22, height: 22, borderRadius: 11 },
  cellName: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  cellSub: { color: Colors.textSecondary, fontSize: 11 },
  team: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, minHeight: 60 },
  teamOn: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.08)' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#0d1016', fontSize: 12, fontWeight: '800' },
  teamName: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  message: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  count: { color: Colors.accent, fontSize: 14, fontWeight: '800' },
  bar: { height: 8, borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: Colors.accent },
  textButton: { alignItems: 'center', paddingVertical: Spacing.md },
  chevron: { color: Colors.textSecondary, fontSize: 22 },
});
