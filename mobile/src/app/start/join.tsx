import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Field, GhostButton, Icon, Kicker, NeonButton, StartScreen, startStyles, Stat, Sub, Title } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { canScanQr, scanInvite } from '@/lib/qrJoin';
import { queryClient } from '@/lib/queries';
import type { LeaguePreview } from '@/lib/types';

// Join a league (port of the web's StartFlow join steps): scan the QR,
// or paste a link or code, see the league before joining — then claim
// your past team's history or start a new team. ?code= arrives filled
// in from an invite link.
export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const { signInWithToken } = useAuth();
  const [code, setCode] = useState(params.code ?? '');
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<'find' | 'team'>('find');
  const [unclaimed, setUnclaimed] = useState<{ owner_id: number; display_name: string }[]>([]);
  const [claimId, setClaimId] = useState<number | null>(null);
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Look the league up as soon as something code-shaped is typed.
  useEffect(() => {
    const text = code.trim();
    if (text.length < 4) return;
    let cancelled = false;
    const id = setTimeout(() => {
      api
        .previewLeague(text)
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setNotFound(false);
        })
        .catch(() => {
          if (cancelled) return;
          setPreview(null);
          setNotFound(true);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [code]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function done() {
    haptics.success();
    await queryClient.invalidateQueries();
    router.dismissAll();
    router.replace('/');
  }

  async function scan() {
    const result = await scanInvite((invite) => {
      if (invite.kind === 'league') setCode(invite.code);
    });
    if (result === 'denied') Alert.alert('Camera is off', 'Allow camera access for The Weekend in Settings to scan a league QR code.');
  }

  const join = () =>
    run(async () => {
      if (!preview) return;
      if (preview.already_member) {
        await api.selectLeague(preview.id);
        await done();
        return;
      }
      await api.joinLeague(preview.invite_code, true);
      const owners = await api.unclaimedOwners(preview.id).catch(() => []);
      setUnclaimed(owners);
      setClaimId(owners[0]?.owner_id ?? null);
      setStep('team');
    });

  const claim = () =>
    run(async () => {
      if (!preview || claimId === null) return;
      const { token } = await api.claimOwner(preview.id, claimId);
      await signInWithToken(token);
      await done();
    });

  const newTeam = () =>
    run(async () => {
      if (!preview) return;
      await api.createTeam(preview.id, teamName.trim());
      await done();
    });

  if (step === 'team' && preview) {
    return (
      <StartScreen
        footer={
          unclaimed.length > 0 ? (
            <NeonButton label="That's me — claim it" onPress={claim} disabled={claimId === null} busy={busy} />
          ) : (
            <NeonButton label="Start my team" onPress={newTeam} disabled={!teamName.trim()} busy={busy} />
          )
        }>
        <Stack.Screen options={{ title: 'Join a League' }} />
        <View style={styles.head}>
          <Kicker>{preview.name}</Kicker>
          <Title>Who are you here?</Title>
          <Sub>Played here before? Claim your team and your whole history comes with it.</Sub>
        </View>
        {unclaimed.length > 0 && (
          <View style={styles.list}>
            <Kicker>Claim your history</Kicker>
            {unclaimed.map((o) => {
              const on = claimId === o.owner_id;
              return (
                <Pressable
                  key={o.owner_id}
                  onPress={() => {
                    haptics.select();
                    setClaimId(o.owner_id);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[styles.claim, on && styles.claimOn]}>
                  <View style={styles.initials}>
                    <Text style={styles.initialsText}>{initials(o.display_name)}</Text>
                  </View>
                  <Text style={styles.claimName}>{o.display_name}</Text>
                  {on && <Icon name="check" color={Colors.accent} size={20} />}
                </Pressable>
              );
            })}
            <View style={startStyles.divider}>
              <View style={startStyles.dividerLine} />
              <Text style={startStyles.dividerText}>new to this league?</Text>
              <View style={startStyles.dividerLine} />
            </View>
          </View>
        )}
        <Field label="Your team name" value={teamName} onChangeText={setTeamName} maxLength={40} placeholder="Name your team" />
        {unclaimed.length > 0 && <GhostButton label="Start a new team" onPress={newTeam} disabled={!teamName.trim() || busy} />}
        {error && <Text style={startStyles.error}>{error}</Text>}
      </StartScreen>
    );
  }

  return (
    <StartScreen
      footer={
        <NeonButton
          label={preview ? (preview.already_member ? `Go to ${preview.name}` : `Join ${preview.name}`) : 'Join league'}
          onPress={join}
          disabled={!preview}
          busy={busy}
        />
      }>
      <Stack.Screen options={{ title: 'Join a League' }} />
      <View style={styles.head}>
        <Kicker>Join a league</Kicker>
        <Title>How&apos;d you get invited?</Title>
      </View>
      {canScanQr && <NeonButton label="Scan league QR code" onPress={() => void scan()} icon={<Icon name="camera" color={Colors.accent} size={22} />} />}
      {canScanQr && (
        <View style={startStyles.divider}>
          <View style={startStyles.dividerLine} />
          <Text style={startStyles.dividerText}>or paste a link or code</Text>
          <View style={startStyles.dividerLine} />
        </View>
      )}
      <Field
        label="Invite link or code"
        value={code}
        onChangeText={(t) => {
          setCode(t);
          if (t.trim().length < 4) {
            setPreview(null);
            setNotFound(false);
          }
        }}
        placeholder="e.g. K7M2QX"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {notFound && <Text style={startStyles.error}>No league found for that code — check it with your commissioner.</Text>}
      {preview && (
        <View style={[startStyles.card, startStyles.cardLit]}>
          <View style={startStyles.found}>
            <Icon name="check" color={Colors.accent} size={18} />
            <Text style={startStyles.foundText}>{preview.already_member ? "You're already in this league" : 'League found'}</Text>
          </View>
          <View>
            <Text style={startStyles.cardTitle}>{preview.name}</Text>
            <Text style={startStyles.muted}>
              {preview.season} season{preview.commissioner ? ` · Commissioner ${preview.commissioner}` : ''}
            </Text>
          </View>
          <View style={startStyles.stats}>
            <Stat value={preview.team_count ? `${preview.teams}/${preview.team_count}` : String(preview.teams)} label="Teams" />
            <Stat value={preview.scoring} label="Scoring" />
            <Stat value={preview.history_seasons > 1 ? `${preview.history_seasons} yrs` : 'New'} label="History" />
          </View>
        </View>
      )}
      {error && <Text style={startStyles.error}>{error}</Text>}
    </StartScreen>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  list: { gap: Spacing.sm },
  claim: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  claimOn: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.08)' },
  initials: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.tile, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: '#aab2bf', fontWeight: '700' },
  claimName: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '600' },
});
