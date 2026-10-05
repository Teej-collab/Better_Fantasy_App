import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

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
import { Fonts } from '@/constants/theme';
import { api } from '@/lib/api';
import { queryClient, useActiveLeague, usePlayoffSettings } from '@/lib/queries';
import type { LeagueInfo, PlayoffSettings } from '@/lib/types';
import { InviteSheet } from '@/components/league/InviteSheet';

// Port of the web's LeagueSettingsSection: name, invite code, playoff format.
export default function LeagueSettingsScreen() {
  const league = useActiveLeague();
  const playoff = usePlayoffSettings();
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'League Settings' }} />
      <SectionHead title="League Settings" />
      {league.isPending ? (
        <LoadingState />
      ) : !league.data ? (
        <ErrorText>{errorMessage(league.error, "Couldn't load your league.")}</ErrorText>
      ) : (
        <View style={s.gap}>
          <NameRow league={league.data} />
          <InviteRow league={league.data} />
          {playoff.data && <PlayoffForm key={playoff.data.season} settings={playoff.data} />}
        </View>
      )}
    </CommishScreen>
  );
}

function NameRow({ league }: { league: LeagueInfo }) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api.renameLeague(league.id, value.trim());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leagues-mine'] }),
        queryClient.invalidateQueries({ queryKey: ['my-leagues'] }),
      ]);
      setRenaming(false);
    } catch (e) {
      setError(errorMessage(e, "Couldn't rename the league."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.gapSm}>
      <View style={s.row}>
        <Text style={s.label}>Name</Text>
        {renaming ? (
          <>
            <Input value={value} onChangeText={setValue} maxLength={40} style={{ minWidth: 160 }} />
            <PrimaryButton label="Save" busyLabel="Saving…" busy={busy} disabled={!value.trim()} onPress={save} />
            <Pressable onPress={() => setRenaming(false)}>
              <Text style={s.small}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.medium}>{league.name}</Text>
            <Pressable
              onPress={() => {
                setValue(league.name);
                setRenaming(true);
              }}>
              <Text style={s.small}>Rename</Text>
            </Pressable>
          </>
        )}
      </View>
      {error && <ErrorText>{error}</ErrorText>}
    </View>
  );
}

function InviteRow({ league }: { league: LeagueInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.row}>
      <Text style={s.label}>Invite code</Text>
      <View style={[s.box, { paddingVertical: 4, paddingHorizontal: 8 }]}>
        <Text style={[s.body, { fontFamily: Fonts.mono }]}>{league.invite_code}</Text>
      </View>
      {/* The full invite — link, QR, and share — not just the code. */}
      <OutlineButton label="Invite" onPress={() => setOpen(true)} />
      <InviteSheet league={open ? league : null} onClose={() => setOpen(false)} />
    </View>
  );
}

function PlayoffForm({ settings }: { settings: PlayoffSettings }) {
  const [teamCount, setTeamCount] = useState(settings.playoff_team_count === null ? '' : String(settings.playoff_team_count));
  const [weeksPerMatchup, setWeeksPerMatchup] = useState(String(settings.weeks_per_matchup));
  const [startWeek, setStartWeek] = useState(settings.start_week === null ? '' : String(settings.start_week));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(setter: (v: string) => void) {
    return (v: string) => {
      setter(v);
      setSaved(false);
    };
  }

  async function save() {
    if (!teamCount) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.updatePlayoffSettings(settings.season, Number(teamCount), weeksPerMatchup ? Number(weeksPerMatchup) : 1, startWeek ? Number(startWeek) : null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['playoffs'] });
    } catch (e) {
      setError(errorMessage(e, "Couldn't save the playoff format."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.gapSm, s.separator]}>
      <View style={s.row}>
        <Text style={s.label}>Playoff teams ({settings.season})</Text>
        <Input value={teamCount} onChangeText={edit(setTeamCount)} placeholder="Not set" numeric style={{ width: 80 }} />
      </View>
      <View style={s.row}>
        <Text style={s.label}>Weeks per matchup</Text>
        <Input value={weeksPerMatchup} onChangeText={edit(setWeeksPerMatchup)} numeric style={{ width: 64 }} />
      </View>
      <View style={s.row}>
        <Text style={s.label}>Start week</Text>
        <Input value={startWeek} onChangeText={edit(setStartWeek)} placeholder="Auto" numeric style={{ width: 80 }} />
      </View>
      <View style={s.row}>
        <PrimaryButton label="Save" busyLabel="Saving…" busy={busy} disabled={!teamCount} onPress={save} />
        {saved && <Text style={{ color: '#34d399', fontSize: 12 }}>Saved.</Text>}
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Text style={s.small}>
        Drives the in-app playoff bracket generator (real matchups, no ESPN dependency) and the playoff-picture line on the
        standings page. Leave start week blank to infer it automatically from this season&apos;s own regular-season schedule
        once it&apos;s complete.
      </Text>
    </View>
  );
}
