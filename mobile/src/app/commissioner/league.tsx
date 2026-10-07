import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

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
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts } from '@/constants/theme';
import { api } from '@/lib/api';
import {
  DRAFT_TYPES,
  isAvailable,
  LEAGUE_TYPES,
  MATCHUP_TYPES,
  ROSTER_PRESETS,
  TYPE_SETTINGS,
  type FormatOptions,
  type LeagueFormat,
} from '@/lib/leagueFormat';
import { queryClient, useActiveLeague, usePlayoffSettings } from '@/lib/queries';
import type { LeagueInfo, PlayoffSettings } from '@/lib/types';
import { InviteSheet } from '@/components/league/InviteSheet';

// Port of the web's LeagueSettingsSection: name, invite code, league
// format (2026-10), playoff format.
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
          <FormatForm key={league.data.id} league={league.data} />
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

// Type, roster and draft style lock once the draft is set up (the
// backend answers 409); head-to-head vs total points never locks.
function FormatForm({ league }: { league: LeagueInfo }) {
  const initial: LeagueFormat = {
    league_type: league.league_type ?? 'redraft',
    matchup_type: league.matchup_type ?? 'h2h',
    draft_type: league.draft_type ?? 'snake',
    roster_preset: league.roster_preset ?? 'standard',
    type_settings: league.type_settings ?? {},
  };
  const [draft, setDraft] = useState<LeagueFormat>(initial);
  const [formats, setFormats] = useState<FormatOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => {
    api.leagueFormats().then(setFormats).catch(() => {});
  }, []);

  function pick<K extends keyof LeagueFormat>(key: K, value: LeagueFormat[K]) {
    setDraft((d) => ({ ...d, [key]: value, ...(key === 'league_type' ? { type_settings: {} } : {}) }));
    setSaved(false);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateLeagueFormat(league.id, draft);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leagues-mine'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e, "Couldn't save the format."));
    } finally {
      setBusy(false);
    }
  }

  const allowed = (field: 'league_type' | 'roster_preset' | 'draft_type', key: string) =>
    isAvailable(formats, field, key) || initial[field] === key;

  return (
    <View style={[s.gapSm, s.separator]}>
      <Text style={s.medium}>League format</Text>
      <View style={s.row}>
        <Text style={s.label}>Type</Text>
        <Picker
          value={draft.league_type}
          placeholder="League type"
          options={LEAGUE_TYPES.filter((t) => allowed('league_type', t.key)).map((t) => ({ value: t.key, label: t.name }))}
          onChange={(v) => pick('league_type', v)}
        />
      </View>
      <View style={s.row}>
        <Text style={s.label}>Roster</Text>
        <Picker
          value={draft.roster_preset}
          placeholder="Roster"
          options={ROSTER_PRESETS.filter((r) => allowed('roster_preset', r.key)).map((r) => ({ value: r.key, label: r.label }))}
          onChange={(v) => pick('roster_preset', v)}
        />
      </View>
      {draft.league_type !== 'guillotine' && (
        <View style={s.row}>
          <Text style={s.label}>Matchups</Text>
          <Picker value={draft.matchup_type} placeholder="Matchups" options={MATCHUP_TYPES.map((m) => ({ value: m.key, label: m.label }))} onChange={(v) => pick('matchup_type', v)} />
        </View>
      )}
      <View style={s.row}>
        <Text style={s.label}>Draft</Text>
        <Picker
          value={draft.draft_type}
          placeholder="Draft style"
          options={DRAFT_TYPES.filter((d) => allowed('draft_type', d.key)).map((d) => ({ value: d.key, label: d.label }))}
          onChange={(v) => pick('draft_type', v)}
        />
      </View>
      {TYPE_SETTINGS[draft.league_type].map((t) => {
        const limits = formats?.type_settings[draft.league_type]?.[t.key];
        return (
          <View key={t.key} style={s.row}>
            <Text style={s.label}>{t.title}</Text>
            <Input
              value={String(draft.type_settings[t.key] ?? limits?.default ?? '')}
              onChangeText={(v) => pick('type_settings', { ...draft.type_settings, [t.key]: Number(v) || 0 })}
              numeric
              style={{ width: 80 }}
            />
          </View>
        );
      })}
      <View style={s.row}>
        <PrimaryButton label="Save format" busyLabel="Saving…" busy={busy} disabled={!dirty} onPress={save} />
        {saved && <Text style={{ color: Colors.win, fontSize: 12 }}>Saved.</Text>}
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Text style={s.small}>Type, roster and draft style can change until the draft is set up. Head-to-head or total points can change any time.</Text>
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
