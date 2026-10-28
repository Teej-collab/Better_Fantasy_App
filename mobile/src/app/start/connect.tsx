import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { EspnSignIn, espnSignInAvailable, type EspnSession } from '@/components/start/EspnSignIn';
import { confirmClaim, NotMyTeamLink, SharedLoginPicker } from '@/components/start/TeamMatch';
import { Field, GhostButton, Icon, Kicker, NeonButton, StartScreen, startStyles, Sub, Title, useRequiredField } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { IOS_APP_URL } from '@/lib/appLinks';
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
  // Sign in with ESPN (2026-10-27): fills espn_s2/SWID, and the league
  // too when they tap it on ESPN Fantasy (components/start/EspnSignIn.tsx).
  const [espnSheet, setEspnSheet] = useState(false);
  const [espnSignedIn, setEspnSignedIn] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [owners, setOwners] = useState<{ owner_id: number; display_name: string; team_name?: string | null }[]>([]);
  const [mine, setMine] = useState<number | null>(null);
  // Your team when your account already had it (a manager already on The
  // Weekend), and who else in the league is (2026-10-28).
  const [yours, setYours] = useState<{ owner_id: number; team_name: string } | null>(null);
  const [alreadyHere, setAlreadyHere] = useState<{ display_name: string; team_name: string; member: boolean }[]>([]);
  // One login runs several teams here: you pick yours first.
  const [sharedLogin, setSharedLogin] = useState<{ team_id: number; team_name: string }[]>([]);
  const [unclaimedLeft, setUnclaimedLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinAsked, setJoinAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sleeper by username (2026-10-24): no link to copy.
  const [username, setUsername] = useState('');
  const linkField = useRequiredField(link, 'Paste your league link first.');
  const usernameField = useRequiredField(username, 'Type your Sleeper username first.');
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

  const find = (picked?: string, creds?: { s2: string; swid: string }) =>
    run(async () => {
      const target = (picked ?? link).trim();
      if (!target) throw new Error(`Paste your league's ${name} link.`);
      const useCreds = creds ?? (showPrivate ? { s2: s2.trim(), swid: swid.trim() } : null);
      const found = await api.importPreview(platform, target, useCreds?.s2 || undefined, useCreds?.swid || undefined);
      setPreview(found);
      haptics.success();
      setStep('found');
    });

  const onEspnSignedIn = (session: EspnSession) => {
    setEspnSheet(false);
    setS2(session.espnS2);
    setSwid(session.swid);
    setShowPrivate(true);
    setEspnSignedIn(true);
    if (session.leagueId) {
      const url = `https://fantasy.espn.com/football/league?leagueId=${session.leagueId}`;
      setLink(url);
      void find(url, { s2: session.espnS2, swid: session.swid });
    }
  };

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
      const claims = await api.leagueClaims(created.id).catch(() => null);
      setOwners(claims?.owners ?? []);
      setYours(claims?.yours ?? null);
      setAlreadyHere(claims?.already_here ?? []);
      setSharedLogin(claims?.shared_login ?? []);
      setStep('claim');
    });

  const claim = () =>
    run(async () => {
      if (!league || mine === null) return;
      const picked = owners.find((o) => o.owner_id === mine);
      if (!(await confirmClaim(picked?.team_name ?? picked?.display_name ?? 'this'))) return;
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
    const message = `Our league is on The Weekend now: write-ups before every matchup, live gamecasts and a real league chat. Still on ${name}, nothing changes there. Get the iPhone app: ${IOS_APP_URL} then tap to claim your team: ${joinLink}`;
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

  const continueAsYours = () =>
    run(async () => {
      setUnclaimedLeft(owners.length);
      await queryClient.invalidateQueries();
      haptics.success();
      setStep('invite');
    });

  if (step === 'claim' && league && sharedLogin.length > 0) {
    return (
      <StartScreen>
        <Stack.Screen options={{ title: 'Your Team', headerBackVisible: false }} />
        <View style={styles.head}>
          <Kicker>{league.name} is here</Kicker>
          <Title>Which team is yours?</Title>
        </View>
        <SharedLoginPicker
          leagueId={league.id}
          teams={sharedLogin}
          platform={name}
          onPicked={(team) => {
            setSharedLogin([]);
            setYours({ owner_id: 0, team_name: team.team_name });
            void api.leagueClaims(league.id).then((c) => setOwners(c.owners)).catch(() => {});
          }}
        />
      </StartScreen>
    );
  }

  if (step === 'claim' && league && yours) {
    return (
      <StartScreen footer={<NeonButton label="Continue" onPress={continueAsYours} busy={busy} />}>
        <Stack.Screen options={{ title: 'Your Team', headerBackVisible: false }} />
        <View style={styles.head}>
          <Kicker>{league.name} is here</Kicker>
          <Title>You&apos;re {yours.team_name}</Title>
          <Sub>Your {name} team was already linked to your account, so there&apos;s nothing to pick.</Sub>
        </View>
        <NotMyTeamLink leagueId={league.id} />
        <AlreadyHere people={alreadyHere} />
        {error && <Text style={startStyles.error}>{error}</Text>}
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
        <AlreadyHere people={alreadyHere} />
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

  // Already on The Weekend (2026-10-28): one copy per ESPN or Sleeper
  // league, so a second person joins that one instead of splitting it.
  if (step === 'found' && preview?.existing) {
    const existing = preview.existing;
    return (
      <StartScreen
        footer={
          existing.you_are_in_it ? (
            <NeonButton label="Open my leagues" onPress={() => router.replace('/start')} />
          ) : (
            <>
              <NeonButton
                label={joinAsked ? 'Asked ✓' : `Ask ${existing.commissioner} to let me in`}
                busy={busy}
                onPress={() =>
                  run(async () => {
                    await api.requestJoin(preview.platform, preview.external_id);
                    haptics.success();
                    setJoinAsked(true);
                  })
                }
              />
              <GhostButton label="I have an invite code" onPress={() => router.replace('/start/join')} />
              <GhostButton label="Not it? Paste a different link" onPress={() => setStep('link')} />
            </>
          )
        }>
        <Stack.Screen options={{ title: `From ${name}` }} />
        <Kicker>ALREADY ON THE WEEKEND</Kicker>
        <Title>{existing.you_are_in_it ? `You're already in ${existing.name}` : `${existing.name} is already here`}</Title>
        <Sub>
          {existing.you_are_in_it
            ? 'No need to bring it in again. Open it from your leagues.'
            : `${existing.commissioner} brought it in already. Join theirs so everyone's in one league, with one chat and one set of standings.`}
        </Sub>
        {joinAsked && !existing.you_are_in_it && (
          <View style={startStyles.card}>
            <Text style={startStyles.muted}>
              Sent. {existing.commissioner} got a notification to send you the invite. You can also ask them in your group text.
            </Text>
          </View>
        )}
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

  // Sign in with ESPN is the whole ESPN step (2026-10-28): the link box,
  // "Viewable to Public" and the cookie paste are gone. The link box comes
  // back only if someone signed in without tapping a team, and the old
  // screen stays for builds without the in-app browser (before iOS build 7).
  const espnSignInOnly = platform === 'espn' && espnSignInAvailable;
  const showLinkBox = !espnSignInOnly || (espnSignedIn && !link.trim()) || Boolean(link.trim());

  return (
    <StartScreen
      footer={
        (platform === 'espn' && showLinkBox) || link.trim() ? (
          <NeonButton label="Find my league" onPress={() => linkField.check() && void find()} busy={busy} incomplete={linkField.empty} />
        ) : undefined
      }>
      <Stack.Screen options={{ title: `From ${name}` }} />
      <View style={styles.head}>
        <Kicker>{name}</Kicker>
        <Title>
          {espnSignInOnly ? 'Sign in with ESPN' : platform === 'espn' ? 'Paste your league link' : "What's your Sleeper username?"}
        </Title>
        <Sub>
          {espnSignInOnly
            ? 'Sign in on ESPN’s own page, then tap your team. Works for private leagues, nothing to change in ESPN, and we never see your password.'
            : platform === 'espn'
              ? 'In the ESPN Fantasy app, open your league → Invite friends (or Share) → Copy link, and paste it here. A link from fantasy.espn.com or just the league number works too.'
              : 'We’ll find your leagues. No sign-in or link needed.'}
        </Sub>
      </View>
      {platform === 'sleeper' && (
        <View style={styles.list}>
          <Field
            {...usernameField.field}
            label="Sleeper username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="your username"
            onSubmitEditing={() => void lookUp()}
          />
          <GhostButton label={busy && !sleeperLeagues ? 'Looking…' : 'Find my leagues'} onPress={() => usernameField.check() && void lookUp()} incomplete={usernameField.empty} disabled={busy} />
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
      {espnSignInOnly && (
        <View style={startStyles.card}>
          {espnSignedIn && (
            <>
              <Kicker>Signed in to ESPN</Kicker>
              <Text style={styles.cardTitle}>You’re signed in ✓</Text>
              <Text style={startStyles.muted}>Sign in again and tap your team on ESPN, or paste your league link below.</Text>
            </>
          )}
          <NeonButton label={espnSignedIn ? 'Sign in again' : 'Sign in with ESPN'} onPress={() => setEspnSheet(true)} />
        </View>
      )}
      {platform === 'espn' && <EspnSignIn visible={espnSheet} onDone={onEspnSignedIn} onClose={() => setEspnSheet(false)} />}
      {showLinkBox && (
        <Field
          {...linkField.field}
          label={`${name} league link`}
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={platform === 'espn' ? 'https://fantasy.espn.com/football/league?leagueId=…' : 'https://sleeper.com/leagues/…'}
        />
      )}
      {platform === 'espn' && !espnSignInOnly && (
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
        !espnSignInOnly &&
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

// Managers in this league who are already on The Weekend: they aren't in
// the picker, so say who they are instead of leaving them out.
function AlreadyHere({ people }: { people: { display_name: string; team_name: string; member: boolean }[] }) {
  if (people.length === 0) return null;
  return (
    <View style={startStyles.card}>
      <Kicker>Already on The Weekend</Kicker>
      {people.map((p) => (
        <Text key={`${p.display_name}-${p.team_name}`} style={styles.check}>
          {p.display_name} · {p.team_name}
          {p.member ? ' ✓' : ''}
        </Text>
      ))}
      <Text style={startStyles.muted}>Their teams are already theirs. They just open your invite link to see this league.</Text>
    </View>
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
