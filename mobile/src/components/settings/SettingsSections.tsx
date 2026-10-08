import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, DefaultAccent, HoneycombColor, Radius, SectionColors, Spacing } from '@/constants/theme';
import { api, uploadChatImage } from '@/lib/api';
import {
  canScheduleReminders,
  DEFAULT_REMINDER_SETTINGS,
  getReminderSettings,
  invalidateReminders,
  saveReminderSettings,
  sendTestReminder,
  type ReminderSettings,
} from '@/lib/localNotifications';
import type { ReminderCategory } from '@/lib/reminders';
import { applyAccent, applyTheme, HONEYCOMB_MULTI, useAppearance } from '@/lib/appearance';
import { canChangeAppIcon, seasonalIconEnabled, setSeasonalIconEnabled } from '@/lib/seasonal';
import { useAuth } from '@/lib/auth';
import { pickChatPhoto } from '@/lib/chatImage';
import { canUseLiveActivities, liveActivityEnabled, setLiveActivityEnabled } from '@/lib/liveActivity';
import { registerForPush } from '@/lib/pushRegistration';
import { queryClient, useFeedbackList, useHouseRules, useMe, useMySettings, usePreferences } from '@/lib/queries';
import type { MySettings, OwnerPreferences, SundayMode } from '@/lib/types';

// Ports of the web's components/settings/*Section.tsx.

// Same palette as the web's lib/neonPalette.ts.
const NEON_PALETTE = [
  { name: 'Neon Green', hex: '#39ff14' },
  { name: 'Neon Blue', hex: '#0ea5e9' },
  { name: 'Neon Pink', hex: '#ec4899' },
  { name: 'Neon Yellow', hex: '#facc15' },
  { name: 'Neon Orange', hex: '#f97316' },
  { name: 'Neon Lightning Blue', hex: '#22d3ee' },
  { name: 'Neon Purple', hex: '#a855f7' },
  { name: 'Neon Red', hex: '#ff1744' },
];

// ---- shared pieces ----

function Header({ title, subtitle, saved }: { title: string; subtitle: string; saved?: boolean }) {
  return (
    <View style={styles.header}>
      <View style={styles.flex}>
        <Display style={styles.title} accessibilityRole="header">
          {title}
        </Display>
        <Text style={styles.muted}>{subtitle}</Text>
      </View>
      {saved && <Text style={styles.saved}>✓ Saved</Text>}
    </View>
  );
}

function Panel({ title, description, children, color, danger }: { title?: string; description?: string; children: ReactNode; color?: string; danger?: boolean }) {
  return (
    <NeonPanel color={color} contentStyle={styles.panel}>
      {title && <Text style={[styles.panelTitle, danger && styles.danger]}>{title}</Text>}
      {description && <Text style={styles.small}>{description}</Text>}
      {children}
    </NeonPanel>
  );
}

// Game-day reminders scheduled on this phone (lib/localNotifications.ts) —
// separate from push, and saved on this phone only.
const REMINDER_TOGGLES: { key: ReminderCategory; label: string; description: string }[] = [
  { key: 'lineup', label: 'Lineup check', description: 'An hour before kickoff, if a starter is Out, on bye, or a slot is empty.' },
  { key: 'draft', label: 'Draft and keepers', description: 'Before the draft starts, and before keeper picks are due if you haven’t made them.' },
  { key: 'chug', label: 'Chug Rule', description: 'Two hours before the chug deadline.' },
];

function PhoneReminders() {
  const houseRules = useHouseRules().data;
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  useEffect(() => {
    getReminderSettings().then(setSettings).catch(() => setSettings(DEFAULT_REMINDER_SETTINGS));
  }, []);

  function toggle(key: ReminderCategory, value: boolean) {
    if (!settings) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    void saveReminderSettings(next).then(invalidateReminders);
  }

  return (
    <Panel title="Reminders on this phone" description="Scheduled right on your phone from what the app last loaded — no push notifications needed.">
      {!canScheduleReminders ? (
        <Text style={styles.small}>These arrive with the next app install.</Text>
      ) : (
        <>
          {REMINDER_TOGGLES.filter((t) => t.key !== 'chug' || houseRules?.chugEnabled).map((t, i) => (
            <ToggleRow
              key={t.key}
              divided={i > 0}
              label={t.key === 'chug' && houseRules ? houseRules.chugRuleName : t.label}
              description={t.description}
              value={settings?.[t.key] ?? true}
              disabled={!settings}
              onChange={(v) => toggle(t.key, v)}
            />
          ))}
          <Pressable
            onPress={async () => {
              const ok = await sendTestReminder();
              setTestNote(ok ? 'Sent — it arrives in 5 seconds. Lock your phone to see it.' : 'Turn on notifications for The Weekend in iPhone Settings first.');
            }}
            style={styles.secondary}>
            <Text style={styles.body}>Send a test reminder</Text>
          </Pressable>
          {testNote && <Text style={styles.small}>{testNote}</Text>}
        </>
      )}
    </Panel>
  );
}

// Real push on this phone (lib/pushRegistration.ts). The app asks once
// you're in a league; this is the way back if you said no then.
function PushPanel({ on }: { on: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function turnOn() {
    setBusy(true);
    try {
      const ok = await registerForPush();
      if (ok) {
        await queryClient.invalidateQueries({ queryKey: ['preferences'] });
        setNote('Push is on for this phone.');
      } else {
        setNote('Turn on notifications for The Weekend in iPhone Settings → Notifications, then try again.');
      }
    } catch {
      setNote("Couldn't turn on push right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Push Notifications" description="Trade offers, waiver results, chat and injury alerts on this phone, even when The Weekend isn't open.">
      {on ? (
        <Text style={styles.small}>✓ Push is on for your account.</Text>
      ) : (
        <Pressable onPress={() => void turnOn()} disabled={busy} style={styles.secondary}>
          <Text style={styles.body}>{busy ? 'Turning on…' : 'Turn on push notifications'}</Text>
        </Pressable>
      )}
      {note && <Text style={styles.small}>{note}</Text>}
    </Panel>
  );
}

// The Lock Screen / Dynamic Island live score (lib/liveActivity.ts).
// Saved on this phone.
function LiveActivityPanel() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    liveActivityEnabled().then(setOn).catch(() => setOn(true));
  }, []);
  if (!canUseLiveActivities) return null;
  return (
    <Panel title="Live score on Lock Screen" description="On game day, your matchup's live score sits on your Lock Screen and in the Dynamic Island, and starts on its own at kickoff.">
      <ToggleRow
        label="Show my live matchup"
        value={on ?? true}
        disabled={on === null}
        onChange={(v) => {
          setOn(v);
          void setLiveActivityEnabled(v);
        }}
      />
    </Panel>
  );
}

function ToggleRow(props: { label: string; description?: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void; divided?: boolean }) {
  const accent = useAppearance().accent;
  return (
    <View style={[styles.toggleRow, props.divided && styles.divided]}>
      <View style={styles.flex}>
        <Text style={[styles.body, props.disabled && styles.dim]}>{props.label}</Text>
        {props.description && <Text style={styles.small}>{props.description}</Text>}
      </View>
      <Switch
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onChange}
        accessibilityLabel={props.label}
        accessibilityHint={props.description}
        trackColor={{ true: accent, false: 'rgba(255,255,255,0.25)' }}
      />
    </View>
  );
}

function Segment<T extends string>(props: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean }) {
  const accent = useAppearance().accent;
  return (
    <View style={styles.segments}>
      {props.options.map((o) => {
        const on = o.key === props.value;
        return (
          <Pressable
            key={o.key}
            disabled={props.disabled}
            onPress={() => props.onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: props.disabled }}
            style={[styles.segment, on && { borderColor: accent }, props.disabled && styles.dim]}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// A row of color swatches with an optional Default (null) and Off.
function Swatches(props: {
  value: string | null;
  onChange: (hex: string | null) => void;
  palette: { name: string; hex: string }[];
  defaultSwatch?: { color: string; label?: string };
  offOption?: boolean;
  multiOption?: boolean;
}) {
  const current = props.value?.toLowerCase() ?? null;
  return (
    <View style={styles.swatches}>
      {props.defaultSwatch && (
        <Swatch color={props.defaultSwatch.color} label={props.defaultSwatch.label ?? 'Default'} on={current === null} onPress={() => props.onChange(null)} />
      )}
      {props.offOption && <Swatch color="transparent" label="Off" on={current === 'off'} onPress={() => props.onChange('off')} off />}
      {props.multiOption && <Swatch color="transparent" label="Multi" on={current === 'multi'} onPress={() => props.onChange('multi')} multi />}
      {props.palette.map((p) => (
        <Swatch key={p.hex} color={p.hex} label={p.name.replace('Neon ', '')} on={current === p.hex.toLowerCase()} onPress={() => props.onChange(p.hex)} />
      ))}
    </View>
  );
}

function Swatch({ color, label, on, onPress, off, multi }: { color: string; label: string; on: boolean; onPress: () => void; off?: boolean; multi?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} style={[styles.swatch, on && styles.swatchOn]}>
      <View style={[styles.swatchDot, { backgroundColor: color }, off && styles.swatchOff, multi && styles.swatchMulti]}>
        {off && <Text style={styles.offX}>✕</Text>}
        {multi && HONEYCOMB_MULTI.slice(0, 4).map((c) => <View key={c} style={[styles.multiQuarter, { backgroundColor: c }]} />)}
      </View>
      <Text style={styles.swatchLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// Optimistic preference writes: the cached preferences change at once
// (so lib/appearance.ts repaints every screen immediately), then the
// server's copy replaces them; a failure puts the old values back.
function usePatchPreferences() {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function patch(fields: Partial<OwnerPreferences>, run: () => Promise<OwnerPreferences> = () => api.updatePreferences(fields)) {
    const previous = queryClient.getQueryData<OwnerPreferences>(['preferences']);
    if (previous) queryClient.setQueryData(['preferences'], { ...previous, ...fields });
    setError(null);
    try {
      const updated = await run();
      queryClient.setQueryData(['preferences'], updated);
      void Haptics.selectionAsync();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return true;
    } catch {
      if (previous) queryClient.setQueryData(['preferences'], previous);
      setError("Couldn't save that change — try again.");
      return false;
    }
  }
  return { patch, saved, error };
}

// ---- Profile ----

const CHAT_COLOR_PRESETS = [
  { name: 'Neon Green', hex: '#39ff14' },
  { name: 'Electric Blue', hex: '#0ea5e9' },
  { name: 'Hot Pink', hex: '#ec4899' },
  { name: 'Golden Yellow', hex: '#fbbf24' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'White/Neutral', hex: '#f5f4ec' },
];
const DEFAULT_BUBBLE_COLOR = '#1f890b';

// Dark text on light bubbles, white on dark (the web's readableTextColor).
function readableTextColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
}

export function ProfileSettings() {
  const q = useMySettings();
  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load your profile." />;
  return <ProfileForm key={`${q.data.display_name}|${q.data.team_name}`} settings={q.data} />;
}

function ProfileForm({ settings }: { settings: MySettings }) {
  const accent = useAppearance().accent;
  const [name, setName] = useState(settings.display_name);
  const [teamName, setTeamName] = useState(settings.team_name ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Names and logos show everywhere.
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(null);
    }
  }

  async function changeLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    await run('logo', async () => {
      // Same resize/compress + Blob upload as chat photos.
      const local = await pickedToJpeg(result.assets[0].uri);
      await api.updateLogo(await uploadChatImage(local));
    });
  }

  const preview = settings.chat_color ?? DEFAULT_BUBBLE_COLOR;
  return (
    <View style={styles.gap}>
      <Header title="Profile" subtitle="How you appear throughout The Weekend." />
      {error && <Text style={styles.error}>{error}</Text>}

      <Panel
        title="Display Name"
        description={`Shown across the league — standings, chat, chug leaderboard, everywhere.${settings.display_name_is_custom ? '' : ' Currently your real ESPN name.'}`}>
        <View style={styles.inputRow}>
          <TextInput value={name} onChangeText={setName} maxLength={40} style={[styles.input, styles.flex]} placeholderTextColor="rgba(255,255,255,0.3)" />
          <Pressable
            disabled={busy !== null}
            onPress={() => (name.trim() ? run('name', () => api.updateDisplayName(name.trim())) : setError("Display name can't be empty."))}
            style={styles.saveButton}>
            <Text style={styles.saveText}>{busy === 'name' ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
        {settings.display_name_is_custom && (
          <Pressable onPress={() => run('name', api.resetDisplayName)}>
            <Text style={styles.linkSmall}>Reset to ESPN name</Text>
          </Pressable>
        )}
      </Panel>

      <Panel title="Team Logo" description="Shown next to your name in League Chat.">
        <View style={styles.logoRow}>
          <TeamAvatar name={settings.display_name ?? settings.team_name ?? '?'} logoUrl={settings.logo_url} size={64} />
          <View style={styles.gapSm}>
            <Pressable disabled={busy !== null} onPress={changeLogo} style={[styles.secondary, { borderColor: accent }]}>
              {busy === 'logo' ? <ActivityIndicator color={accent} /> : <Text style={styles.body}>{settings.logo_url ? 'Change logo' : 'Upload logo'}</Text>}
            </Pressable>
            {settings.logo_url && (
              <Pressable disabled={busy !== null} onPress={() => run('logo', () => api.updateLogo(null))}>
                <Text style={styles.linkSmall}>Remove logo</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Panel>

      {settings.team_name !== null && (
        <Panel
          title="Team Name"
          description={`Shown across the app — standings, league, rosters, everywhere.${settings.team_name_is_custom ? '' : ' Currently your real ESPN team name.'} Does not update your team name on ESPN itself.`}>
          <View style={styles.inputRow}>
            <TextInput value={teamName} onChangeText={setTeamName} maxLength={40} accessibilityLabel="Team name" style={[styles.input, styles.flex]} />
            <Pressable
              disabled={busy !== null}
              onPress={() => (teamName.trim() ? run('team', () => api.updateTeamName(teamName.trim())) : setError("Team name can't be empty."))}
              style={styles.saveButton}>
              <Text style={styles.saveText}>{busy === 'team' ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
          {settings.team_name_is_custom && (
            <Pressable onPress={() => run('team', api.resetTeamName)}>
              <Text style={styles.linkSmall}>Reset to ESPN name</Text>
            </Pressable>
          )}
        </Panel>
      )}

      <Panel title="Chat Bubble Color" description="Everyone in League Chat sees your messages in this color.">
        <Swatches
          value={settings.chat_color}
          onChange={(hex) => run('color', () => api.updateChatColor(hex))}
          palette={CHAT_COLOR_PRESETS}
          defaultSwatch={{ color: 'rgba(255,255,255,0.15)' }}
        />
        <Text style={styles.small}>Preview</Text>
        <View style={styles.previewRow}>
          <View style={[styles.bubble, { backgroundColor: preview }]}>
            <Text style={{ color: readableTextColor(preview), fontSize: 14 }}>This is how your messages will appear in League Chat.</Text>
          </View>
        </View>
      </Panel>
    </View>
  );
}

// The picked image is already cropped square; shrink and compress it
// like a chat photo.
async function pickedToJpeg(uri: string): Promise<string> {
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 512 }).renderAsync();
  return (await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })).uri;
}

// ---- Notifications ----

const SUNDAY_MODES: { key: SundayMode; emoji: string; label: string; description: string }[] = [
  { key: 'full_send', emoji: '🔥', label: 'Full Send', description: 'Everything — every message notification on.' },
  { key: 'game_day', emoji: '🏈', label: 'Game Day', description: 'Direct messages and @mentions only.' },
  { key: 'leave_me_alone', emoji: '😎', label: 'Leave Me Alone', description: 'Only direct messages and @mentions.' },
];

const MESSAGE_TOGGLES: { key: keyof OwnerPreferences; label: string; description: string }[] = [
  { key: 'notify_direct_messages', label: 'Direct messages', description: 'Someone starts or sends you a DM.' },
  { key: 'notify_league_chat', label: 'League chat', description: 'New activity in the shared league room.' },
  { key: 'notify_mentions', label: '@Mentions', description: 'Someone @mentions you anywhere in chat.' },
  { key: 'notify_replies', label: 'Replies to my messages', description: 'Someone replies directly to something you sent.' },
];

const FANTASY_TOGGLES: { key: keyof OwnerPreferences; label: string; description: string }[] = [
  { key: 'notify_my_players', label: 'Touchdowns', description: 'One of your players scores — starters and bench, with the points it was worth.' },
  { key: 'notify_red_zone', label: 'Red Zone', description: 'An NFL team with one of your starters gets inside the 20.' },
  {
    key: 'notify_injuries',
    label: 'Injuries',
    description: 'One of your players is added to the injury report, upgraded, downgraded, cleared, or gets hurt in a game — and a heads-up before kickoff when a starter is Out or inactive.',
  },
  {
    key: 'notify_player_news',
    label: 'Player News',
    description: "Any other news about one of your players, like practice reports. Can get chatty — turn it off if it does.",
  },
  {
    key: 'notify_fantasy_team',
    label: 'My Matchup & Waivers',
    description: 'Lead changes, a close game coming down to the wire, your final result, and what you won (or missed) on waivers.',
  },
  { key: 'notify_league', label: 'League Activity', description: 'Someone in your league posts a graded chug.' },
];

// "22:00:00" ⇄ "22:00"; anything that isn't HH:MM is ignored.
function normalizeTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:00`;
}

export function NotificationSettings() {
  const prefs = usePreferences().data;
  const accent = useAppearance().accent;
  const { patch, saved, error } = usePatchPreferences();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  // Quiet hours run on the account's time zone; keep it matched to
  // this device, same as the web's Notifications section.
  const savedZone = prefs?.timezone;
  useEffect(() => {
    if (savedZone === undefined) return;
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (deviceZone && savedZone !== deviceZone) {
      api.updatePreferences({ timezone: deviceZone }).then((p) => queryClient.setQueryData(['preferences'], p), () => {});
    }
  }, [savedZone]);

  if (!prefs) return <LoadingState />;

  return (
    <View style={styles.gap}>
      <Header title="Notifications" subtitle="What The Weekend lets you know about, and when." saved={saved} />
      {error && <Text style={styles.error}>{error}</Text>}

      <Panel title="Sunday Mode" description="A quick preset instead of tuning every toggle by hand — pick one, or keep customizing below.">
        {SUNDAY_MODES.map((m) => (
          <Pressable
            key={m.key}
            onPress={() => patch({ sunday_mode: m.key }, () => api.applySundayMode(m.key))}
            style={[styles.option, prefs.sunday_mode === m.key && { borderColor: accent, backgroundColor: `${accent}1a` }]}>
            <Text style={styles.bodyMedium}>
              {m.emoji} {m.label}
            </Text>
            <Text style={styles.small}>{m.description}</Text>
          </Pressable>
        ))}
        <Text style={styles.small}>
          {prefs.sunday_mode ? `Active: ${SUNDAY_MODES.find((m) => m.key === prefs.sunday_mode)?.label}` : "Customized — doesn't match a preset."}
        </Text>
      </Panel>

      <Panel title="Messages">
        {MESSAGE_TOGGLES.map((t, i) => (
          <ToggleRow key={t.key} divided={i > 0} label={t.label} description={t.description} value={Boolean(prefs[t.key])} onChange={(v) => patch({ [t.key]: v })} />
        ))}
      </Panel>

      <PushPanel on={prefs.push_enabled} />

      <LiveActivityPanel />

      <PhoneReminders />

      <Panel title="Fantasy Activity" description={prefs.push_enabled ? 'What push notifications you get, by category.' : 'Turn on push notifications above to receive these.'}>
        {FANTASY_TOGGLES.map((t, i) => (
          <ToggleRow
            key={t.key}
            divided={i > 0}
            label={t.label}
            description={t.description}
            value={Boolean(prefs[t.key])}
            disabled={!prefs.push_enabled}
            onChange={(v) => patch({ [t.key]: v })}
          />
        ))}
      </Panel>

      <Panel>
        <ToggleRow
          label="Quiet Hours"
          description="Silences notifications overnight. Injury alerts and player news wait until quiet hours end; draft alerts still come through."
          value={prefs.quiet_hours_enabled}
          onChange={(v) => patch({ quiet_hours_enabled: v })}
        />
        {prefs.quiet_hours_enabled && (
          <View style={styles.quietRow}>
            <View style={styles.gapSm}>
              <Text style={styles.small}>From</Text>
              <TextInput
                value={from ?? prefs.quiet_hours_start.slice(0, 5)}
                onChangeText={setFrom}
                onEndEditing={() => {
                  const t = from !== null ? normalizeTime(from) : null;
                  if (t) void patch({ quiet_hours_start: t });
                  setFrom(null);
                }}
                placeholder="22:00"
                style={[styles.input, styles.timeInput]}
              />
            </View>
            <Text style={styles.arrow} accessibilityElementsHidden importantForAccessibility="no">→</Text>
            <View style={styles.gapSm}>
              <Text style={styles.small}>To</Text>
              <TextInput
                value={to ?? prefs.quiet_hours_end.slice(0, 5)}
                onChangeText={setTo}
                onEndEditing={() => {
                  const t = to !== null ? normalizeTime(to) : null;
                  if (t) void patch({ quiet_hours_end: t });
                  setTo(null);
                }}
                placeholder="08:00"
                style={[styles.input, styles.timeInput]}
              />
            </View>
          </View>
        )}
      </Panel>
    </View>
  );
}

// ---- Chat ----

const CHAT_TOGGLES: { key: keyof OwnerPreferences; label: string; description: string }[] = [
  { key: 'read_receipts_enabled', label: 'Read Receipts', description: "Let others see when you've read their messages." },
  { key: 'typing_indicators_enabled', label: 'Typing Indicators', description: "Let others see when you're typing a reply." },
  { key: 'message_previews_enabled', label: 'Message Previews', description: 'Show the actual message text in your conversation list, not just "New message."' },
  { key: 'mention_highlighting_enabled', label: 'Mention Notifications', description: 'Highlight messages in chat that @mention you.' },
];

export function ChatSettings() {
  const prefs = usePreferences().data;
  const { patch, saved, error } = usePatchPreferences();
  if (!prefs) return <LoadingState />;
  return (
    <View style={styles.gap}>
      <Header title="Chat" subtitle="How League Chat behaves for you." saved={saved} />
      {error && <Text style={styles.error}>{error}</Text>}
      <Panel color={SectionColors.chat}>
        {CHAT_TOGGLES.map((t, i) => (
          <ToggleRow key={t.key} divided={i > 0} label={t.label} description={t.description} value={Boolean(prefs[t.key])} onChange={(v) => patch({ [t.key]: v })} />
        ))}
      </Panel>
      {/* The web's "AI Learning From Chat" placeholder isn't shown here:
          App Review rejects settings for features that don't exist yet. */}
      <BlockedPeople />
    </View>
  );
}

// Everyone you've blocked from chat (long-press a message → Block).
function BlockedPeople() {
  const blocked = useQuery({ queryKey: ['chat-blocks'], queryFn: api.blockedOwners }).data?.blocked;
  const [busy, setBusy] = useState<number | null>(null);
  async function unblock(ownerId: number) {
    setBusy(ownerId);
    try {
      await api.unblockOwner(ownerId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chat-blocks'] }),
        queryClient.invalidateQueries({ queryKey: ['chat-messages'] }),
      ]);
    } catch (e) {
      Alert.alert("Couldn't unblock them", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel color={SectionColors.chat} title="Blocked people" description="You don't see their messages, they can't DM you, and you get no notifications from them.">
      {blocked === undefined ? null : blocked.length === 0 ? (
        <Text style={styles.small}>Nobody. To block someone, long-press one of their messages.</Text>
      ) : (
        blocked.map((b, i) => (
          <View key={b.owner_id} style={[styles.toggleRow, i > 0 && styles.divided]}>
            <Text style={[styles.body, styles.flex]}>{b.display_name}</Text>
            <Pressable onPress={() => void unblock(b.owner_id)} disabled={busy === b.owner_id} hitSlop={8}>
              <Text style={styles.body}>{busy === b.owner_id ? 'Unblocking…' : 'Unblock'}</Text>
            </Pressable>
          </View>
        ))
      )}
    </Panel>
  );
}

// ---- Appearance ----

export function AppearanceSettings() {
  const prefs = usePreferences().data;
  const { patch, saved, error } = usePatchPreferences();
  if (!prefs) return <LoadingState />;
  const direction = prefs.design_direction !== 'default';

  return (
    <View style={styles.gap}>
      <Header title="Appearance" subtitle="The Weekend's look, tuned to your taste." saved={saved} />
      {error && <Text style={styles.error}>{error}</Text>}

      <Panel
        title="Look"
        description={
          direction
            ? 'Controlled by your Design Direction in Labs right now — a Direction sets its own palette. Switch back to Default there to choose Calm or Cosmic again.'
            : "Calm is The Weekend's current look. Cosmic swaps in deep-purple panels, a brighter accent, and each section's own color on its card — everything else (layout, pages, features) stays exactly the same either way. The app restarts to switch."
        }>
        <Segment
          options={[
            { key: 'calm', label: 'Calm' },
            { key: 'cosmic', label: 'Cosmic' },
          ]}
          value={prefs.theme}
          disabled={direction}
          onChange={(theme) => {
            // The app reloads into the new palette once it's saved.
            void patch({ theme }).then((ok) => ok && applyTheme(theme));
          }}
        />
      </Panel>

      <Panel title="Theme" description="The Weekend's signature look is dark — Light mode isn't ready yet.">
        <Segment options={[{ key: 'dark', label: 'Dark' }]} value="dark" onChange={() => {}} />
      </Panel>

      <Panel title="Neon Intensity" description="How strong The Weekend's decorative glow reads — never affects text or contrast.">
        <Segment
          options={[
            { key: 'subtle', label: 'Subtle' },
            { key: 'standard', label: 'Standard' },
            { key: 'high', label: 'High' },
          ]}
          value={prefs.neon_intensity}
          onChange={(neon_intensity) => patch({ neon_intensity })}
        />
      </Panel>

      <Panel
        title="Accent Color"
        description="Colors the nav bar's current tab everywhere in the app, plus the glow on boxes that aren't already tied to a league section (Standings, Rivalries, and so on keep their own color regardless of this choice).">
        <Swatches
          value={prefs.accent_color}
          onChange={(accent_color) => void patch({ accent_color }).then((ok) => ok && applyAccent(accent_color))}
          palette={NEON_PALETTE.filter((p) => p.name !== 'Neon Green')}
          defaultSwatch={{ color: DefaultAccent }}
        />
      </Panel>

      <Panel title="Background" description="The color of the faint breathing honeycomb behind every page. Multi gives the lights behind it different colors, so the lines between the hexagons glow in several.">
        <Swatches
          value={prefs.honeycomb_color}
          onChange={(honeycomb_color) => patch({ honeycomb_color })}
          palette={NEON_PALETTE}
          defaultSwatch={{ color: HoneycombColor }}
          offOption
          multiOption
        />
      </Panel>

      <Panel title="Your Week Card Color" description="Just your own Your Week card on Home — independent of Accent Color. Default follows your Accent Color.">
        <Swatches value={prefs.your_week_color} onChange={(your_week_color) => patch({ your_week_color })} palette={NEON_PALETTE} defaultSwatch={{ color: 'rgba(255,255,255,0.15)' }} />
      </Panel>

      <Panel
        title="Border Animation Color"
        description="The moving neon ring on every card and countdown tile — independent of Accent Color and Your Week Card Color. Default follows your Accent Color.">
        <Swatches value={prefs.border_glow_color} onChange={(border_glow_color) => patch({ border_glow_color })} palette={NEON_PALETTE} defaultSwatch={{ color: 'rgba(255,255,255,0.15)' }} />
      </Panel>

      {canChangeAppIcon && <SeasonalIconSetting />}

      <Panel title="Animations" description="Your device's own reduced-motion setting is always respected regardless of this choice.">
        <Segment
          options={[
            { key: 'full', label: 'Full' },
            { key: 'reduced', label: 'Reduced' },
          ]}
          value={prefs.reduced_motion ? 'reduced' : 'full'}
          onChange={(v) => patch({ reduced_motion: v === 'reduced' })}
        />
      </Panel>
    </View>
  );
}

// ---- Bets ----

// The switch for bet tracking (My Bets and the Gamecast's Your Bets
// card). Off hides them; saved bets stay put for when it's back on.
export function BetSettings() {
  const accent = useAppearance().accent;
  const prefs = usePreferences().data;
  const { patch, saved, error } = usePatchPreferences();
  if (!prefs) return <LoadingState />;
  return (
    <View style={styles.gap}>
      <Header title="Bets" subtitle="Track your bets live. Tracking only — nothing is ever placed." saved={saved} />
      {error && <Text style={styles.error}>{error}</Text>}
      <Panel>
        <ToggleRow
          label="Bet Tracking"
          description="Show My Bets and a Your Bets card on the Gamecast for games you have a leg in. Your bets are private — nobody else sees one unless you share it to league chat."
          value={prefs.bet_tracking_enabled ?? true}
          onChange={(bet_tracking_enabled) => void patch({ bet_tracking_enabled })}
        />
      </Panel>
      {(prefs.bet_tracking_enabled ?? true) && (
        <Pressable onPress={() => router.push('/bets')} accessibilityRole="link" hitSlop={6}>
          <Text style={[styles.body, { color: accent, fontWeight: '700' }]}>Go to My Bets →</Text>
        </Pressable>
      )}
      <Text style={styles.small}>21+. If gambling stops being fun, call or text 1-800-GAMBLER.</Text>
    </View>
  );
}

// The home-screen icon's seasonal looks (lib/seasonal.ts) — on by
// default; kept on this phone only, since the icon is this phone's.
function SeasonalIconSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void seasonalIconEnabled().then((v) => !cancelled && setEnabled(v));
    return () => {
      cancelled = true;
    };
  }, []);
  if (enabled === null) return null;
  return (
    <Panel>
      <ToggleRow
        label="Seasonal app icon"
        description="Dress up the home-screen icon for the season — spider webs in October, snow in winter. Your phone confirms each change."
        value={enabled}
        onChange={(v) => {
          setEnabled(v);
          void setSeasonalIconEnabled(v);
        }}
      />
    </Panel>
  );
}

// ---- Navigation & Labs ----

// The web's bottom-nav reorder and Labs (beta layout, design
// directions) restyle the website itself; the app's tab bar and look
// are fixed, so these only explain where to change them.
export function WebOnlySettings({ title }: { title: 'Navigation' | 'Labs' }) {
  return (
    <View style={styles.gap}>
      <Header
        title={title}
        subtitle={title === 'Navigation' ? 'The order of the bottom navigation bar.' : 'Early looks at redesigns before they ship.'}
      />
      <Panel>
        <Text style={styles.body}>
          {title === 'Navigation'
            ? "The app's tab bar is fixed: Home, Team, Players, Chat, and League. Reordering the bottom bar is for the website, in Settings → Navigation there."
            : 'Labs experiments (the new layout and Design Directions) restyle the website. Try them in Settings → Labs on the web; the app keeps its own look.'}
        </Text>
      </Panel>
    </View>
  );
}

// ---- Account & Security ----

export function AccountSettings() {
  const q = useMySettings();
  const { signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isPending) return <LoadingState />;
  const s = q.data;
  const connections: string[] = [];
  if (s?.has_discord) connections.push(s.discord_username ? `Discord (@${s.discord_username})` : 'Discord');
  if (s?.has_google) connections.push('Google');
  if (s?.has_password) connections.push(s.email ? `Email (${s.email})` : 'Email');

  function confirmDelete() {
    Alert.alert('Delete your account?', "Are you sure? This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, delete my account',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setError(null);
          try {
            await api.deleteAccount();
            await signOut();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong deleting your account.');
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.gap}>
      <Header title="Account & Security" subtitle="How you sign in, and how to leave." />
      <Panel title="Connected Accounts" description={`${connections.length > 0 ? `Signed in with ${connections.join(' and ')}.` : 'Signed in.'} Only you can see or change these settings.`}>
        <Pressable onPress={signOut} style={styles.secondary}>
          <Text style={styles.body}>Log Out</Text>
        </Pressable>
      </Panel>
      <Panel
        danger
        title="Danger Zone"
        description="Deletes your login for good — the email/Discord/Google connections above, your password, your own feedback. This league's shared history (rosters, chug records, chat, rivalries, awards) belongs to everyone in it and stays exactly as it is, just no longer linked to a login you can sign into.">
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={deleting} onPress={confirmDelete} style={[styles.secondary, styles.dangerButton]}>
          <Text style={styles.dangerText}>{deleting ? 'Deleting…' : 'Delete Account'}</Text>
        </Pressable>
      </Panel>
    </View>
  );
}

// ---- Feedback ----

export function FeedbackSettings() {
  const accent = useAppearance().accent;
  const isCommissioner = useMe().data?.is_commissioner ?? false;
  const [message, setMessage] = useState('');
  const [image, setImage] = useState<{ status: 'uploading' | 'done' | 'error'; local: string; url?: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function attach() {
    const local = await pickChatPhoto('library').catch(() => null);
    if (!local) return;
    setImage({ status: 'uploading', local });
    try {
      const url = await uploadChatImage(local);
      setImage({ status: 'done', local, url });
    } catch {
      setImage({ status: 'error', local });
    }
  }

  async function send() {
    const trimmed = message.trim();
    const imageUrl = image?.status === 'done' ? image.url! : null;
    if (!trimmed && !imageUrl) return;
    setStatus('saving');
    setError(null);
    try {
      await api.submitFeedback(trimmed, imageUrl);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage('');
      setImage(null);
      setStatus('sent');
      void queryClient.invalidateQueries({ queryKey: ['feedback'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send — try again.');
      setStatus('error');
    }
  }

  const canSend = status !== 'saving' && image?.status !== 'uploading' && (!!message.trim() || image?.status === 'done');
  return (
    <View style={styles.gap}>
      <Header title="Feedback" subtitle="Found a bug, or have an idea for the league? Send it straight through — attach a screenshot if it helps." />
      <Panel>
        <TextInput
          value={message}
          onChangeText={(t) => {
            setMessage(t);
            if (status !== 'idle') setStatus('idle');
          }}
          multiline
          maxLength={2000}
          placeholder="What's on your mind?"
          placeholderTextColor="rgba(255,255,255,0.3)"
          style={[styles.input, styles.textarea]}
        />
        {image && image.status !== 'error' && (
          <View style={styles.attachment}>
            <Image source={{ uri: image.local }} style={[styles.attachmentImage, image.status === 'uploading' && styles.dim]} contentFit="cover" />
            <Pressable onPress={() => setImage(null)} style={styles.removeImage} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove screenshot">
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        )}
        {image?.status === 'error' && <Text style={styles.error}>Couldn&apos;t upload that image — remove it and try again.</Text>}
        <View style={styles.inputRow}>
          <Pressable disabled={!canSend} onPress={send} style={[styles.primary, { backgroundColor: accent }, !canSend && styles.dim]}>
            <Text style={styles.primaryText}>{status === 'saving' ? 'Sending…' : 'Send feedback'}</Text>
          </Pressable>
          <Pressable onPress={attach} style={styles.secondary}>
            <Text style={styles.body}>📎 Screenshot</Text>
          </Pressable>
        </View>
        {status === 'sent' && <Text style={styles.saved}>Sent — thanks!</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </Panel>
      {isCommissioner && <RecentFeedback />}
    </View>
  );
}

function RecentFeedback() {
  const q = useFeedbackList(true);
  return (
    <Panel title="Recent Feedback">
      {q.isPending ? (
        <ActivityIndicator />
      ) : (q.data ?? []).length === 0 ? (
        <Text style={styles.small}>Nothing submitted yet.</Text>
      ) : (
        (q.data ?? []).map((item, i) => (
          <View key={item.id} style={[styles.feedbackItem, i > 0 && styles.divided]}>
            <Text style={styles.body}>{item.message}</Text>
            {item.image_url && <Image source={{ uri: item.image_url }} style={styles.feedbackImage} contentFit="contain" />}
            <Text style={styles.small}>
              {item.submitted_by} · {new Date(item.created_at).toLocaleString()}
              {item.page_url ? ` · ${item.page_url}` : ''}
            </Text>
          </View>
        ))
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.lg },
  gapSm: { gap: 6 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  title: { fontSize: 22, textTransform: 'none', letterSpacing: 0 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 20 },
  saved: { color: '#34d399', fontSize: 13, fontWeight: '600' },
  panel: { gap: Spacing.md, padding: Spacing.xl },
  panelTitle: { color: Colors.text, fontSize: 14, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  danger: { color: '#ef4444' },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17 },
  body: { color: Colors.text, fontSize: 14 },
  bodyMedium: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  dim: { opacity: 0.4 },
  error: { color: Colors.loss, fontSize: 13 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  segment: { borderRadius: Radius.md, borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  segmentText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500' },
  segmentTextOn: { color: Colors.text },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  swatch: { width: 64, alignItems: 'center', gap: 4, padding: 6, borderRadius: Radius.md, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: Colors.text },
  swatchDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  swatchMulti: { flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
  multiQuarter: { width: '50%', height: '50%' },
  swatchOff: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  offX: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  swatchLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.2)',
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  timeInput: { width: 90, textAlign: 'center' },
  saveButton: { borderRadius: Radius.pill, backgroundColor: '#fff', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  saveText: { color: '#000', fontSize: 14, fontWeight: '500' },
  linkSmall: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textDecorationLine: 'underline' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  secondary: { backgroundColor: Colors.surface, alignSelf: 'flex-start', borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  previewRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  option: { backgroundColor: Colors.surface, gap: 2, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: Spacing.md },
  quietRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingLeft: 4 },
  arrow: { color: 'rgba(255,255,255,0.3)', marginTop: 16 },
  dangerButton: { borderColor: 'rgba(239,68,68,0.5)' },
  dangerText: { color: '#ef4444', fontSize: 14, fontWeight: '500' },
  attachment: { alignSelf: 'flex-start' },
  attachmentImage: { width: 160, height: 160, borderRadius: Radius.md },
  removeImage: { position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 12 },
  primary: { borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  primaryText: { color: '#000', fontSize: 14, fontWeight: '600' },
  feedbackItem: { gap: 4, paddingVertical: Spacing.sm },
  feedbackImage: { width: '100%', height: 200, borderRadius: Radius.md },
});
