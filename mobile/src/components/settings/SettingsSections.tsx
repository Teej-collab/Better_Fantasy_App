import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router, useFocusEffect, type Href } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ColorPicker, Host } from '@expo/ui/swift-ui';
import { requireOptionalNativeModule } from 'expo';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ImageViewer } from '@/components/ImageViewer';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, DefaultAccent, HoneycombColor, Radius, SectionColors, Spacing, type ThemeName } from '@/constants/theme';
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
import { applyAccent, applyTheme, flushAccentReload, useAppearance } from '@/lib/appearance';
import { COLOR_PRESETS, isHexColor, isMulti, MULTI, MULTI_COLORS } from '@/lib/colorChoice';
import { canChangeAppIcon, seasonalIconEnabled, setSeasonalIconEnabled } from '@/lib/seasonal';
import { useAuth } from '@/lib/auth';
import { tour } from '@/lib/tour';
import { pickChatPhoto } from '@/lib/chatImage';
import { getIntroSoundMode, setIntroSoundMode, type IntroSoundMode } from '@/lib/introSound';
import { canUseLiveActivities, liveActivityEnabled, setLiveActivityEnabled } from '@/lib/liveActivity';
import { registerForPush } from '@/lib/pushRegistration';
import { queryClient, useFeedbackList, useHouseRules, useMe, useMySettings, useMyUsername, usePreferences } from '@/lib/queries';
import type { MySettings, OwnerPreferences, SundayMode } from '@/lib/types';

// Ports of the web's components/settings/*Section.tsx.


// The league's admin inbox (2026-10).
const SUPPORT_EMAIL = 'theweekend.admin@gmail.com';

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

// Every color choice (2026-10): Default · Multi · a few curated colors ·
// Custom (the system color picker) · Off where a setting has it. Picker
// changes arrive continuously while you drag, so they're saved once you
// pause rather than on every one.
const CUSTOM_SAVE_DELAY_MS = 600;
// iOS's own color picker (@expo/ui).
const canPickColor = Platform.OS === 'ios' && requireOptionalNativeModule('ExpoUI') !== null;

function Swatches(props: {
  value: string | null;
  onChange: (value: string | null) => void;
  defaultSwatch: { color: string; label?: string };
  // Presets to leave out (e.g. the one Default already is).
  without?: string[];
  offOption?: boolean;
}) {
  const current = props.value?.toLowerCase() ?? null;
  const presets = COLOR_PRESETS.filter((p) => !props.without?.includes(p.hex));
  const isPreset = presets.some((p) => p.hex === current);
  const [custom, setCustom] = useState<string | null>(null);
  const customShown = custom ?? (isHexColor(current) && !isPreset ? current : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function pick(value: string | null) {
    if (timer.current) clearTimeout(timer.current);
    setCustom(null);
    props.onChange(value);
  }

  // iOS's picker reports the color it was handed when it first appears,
  // as if it had been picked — that saved white for every row on first
  // view (2026-10). Only a color different from what it was handed counts.
  const pickerSelection = customShown ?? '#ffffff';

  function pickCustom(hex: string) {
    const value = hex.slice(0, 7).toLowerCase();
    if (!isHexColor(value) || value === pickerSelection) return;
    setCustom(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => props.onChange(value), CUSTOM_SAVE_DELAY_MS);
  }

  return (
    <View style={styles.swatches}>
      <Swatch color={props.defaultSwatch.color} label={props.defaultSwatch.label ?? 'Default'} on={current === null && !custom} onPress={() => pick(null)} />
      <Swatch color="transparent" label="Multi" on={isMulti(current) && !custom} onPress={() => pick(MULTI)} multi />
      {presets.map((p) => (
        <Swatch key={p.hex} color={p.hex} label={p.name} on={current === p.hex && !custom} onPress={() => pick(p.hex)} />
      ))}
      {canPickColor && (
        <View style={[styles.swatch, customShown && styles.swatchOn]} accessibilityLabel="Custom color" accessibilityRole="button">
          {/* Drawn like every other dot (your color, or + before you pick
              one); iOS's picker button sits on top, nearly invisible, so a
              tap opens it without its own rainbow well changing the size. */}
          <View style={styles.swatchDot}>
            <View style={[styles.swatchDot, customShown ? { backgroundColor: customShown } : styles.swatchCustomEmpty]}>
              {!customShown && <Text style={styles.offX}>+</Text>}
            </View>
            <View style={styles.pickerHitArea}>
              <Host matchContents>
                <ColorPicker selection={pickerSelection} supportsOpacity={false} onSelectionChange={pickCustom} />
              </Host>
            </View>
          </View>
          <Text style={styles.swatchLabel} numberOfLines={1}>
            Custom
          </Text>
        </View>
      )}
      {props.offOption && <Swatch color="transparent" label="Off" on={current === 'off'} onPress={() => pick('off')} off />}
    </View>
  );
}

function Swatch({ color, label, on, onPress, off, multi }: { color: string; label: string; on: boolean; onPress: () => void; off?: boolean; multi?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} style={[styles.swatch, on && styles.swatchOn]}>
      <View style={[styles.swatchDot, { backgroundColor: color }, off && styles.swatchOff, multi && styles.swatchMulti]}>
        {off && <Text style={styles.offX}>✕</Text>}
        {multi && MULTI_COLORS.slice(0, 4).map((c) => <View key={c} style={[styles.multiQuarter, { backgroundColor: c }]} />)}
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

      <UsernamePanel />

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

    </View>
  );
}

// Your @username: how people outside your leagues find you as a friend.
// Picked and changed on the Friends screen, which also finds and adds people.
function UsernamePanel() {
  const accent = useAppearance().accent;
  const username = useMyUsername();
  if (username.isLoading) return null;
  return (
    <Panel title="Username" description="How people outside your leagues find you to add you as a friend.">
      <View style={styles.inputRow}>
        <Text style={[styles.bodyMedium, styles.flex]}>{username.data ? `@${username.data}` : 'Not picked yet'}</Text>
        <Pressable onPress={() => router.push('/friends' as Href)} accessibilityRole="button" style={[styles.secondary, { borderColor: accent }]}>
          <Text style={styles.body}>{username.data ? 'Change' : 'Pick one'}</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => router.push('/friends' as Href)} accessibilityRole="link" hitSlop={6}>
        <Text style={[styles.linkSmall, { color: accent }]}>Find and add friends →</Text>
      </Pressable>
    </Panel>
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

export const SUNDAY_MODES: { key: SundayMode; emoji: string; label: string; description: string }[] = [
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
  { key: 'notify_watch_parties', label: 'Watch Parties', description: 'Someone in your league starts a watch party, or invites you to a private room.' },
];

// "22:00:00" ⇄ "22:00"; anything that isn't HH:MM is ignored.
function normalizeTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:00`;
}

// The list rows (2026-10-28, the approved Settings mockup): a label, a
// line on what it is, what it's set to, and a chevron to its own page.
function ListCard({ children }: { children: ReactNode }) {
  return <View style={styles.listCard}>{children}</View>;
}

function ListRow({ label, sub, value, onPress, first }: { label: string; sub?: string; value?: string; onPress: () => void; first?: boolean }) {
  const accent = useAppearance().accent;
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}${value ? `, ${value}` : ''}`}
      accessibilityHint={sub}
      style={({ pressed }) => [styles.listRow, !first && styles.listLine, pressed && styles.listPressed]}>
      <View style={styles.flex}>
        <Text style={styles.listLabel}>{label}</Text>
        {sub ? <Text style={styles.small}>{sub}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.listValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Text style={[styles.listChevron, { color: accent }]}>›</Text>
    </Pressable>
  );
}

function openTune(section: string, tune: string) {
  router.push({ pathname: '/settings', params: { section, tune } });
}

// "22:00:00" → "10 PM".
function clockLabel(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export const NOTIFICATION_TUNES: Record<string, string> = {
  game: 'Game day alerts',
  messages: 'Messages',
  push: 'Push notifications',
  quiet: 'Quiet hours',
  lock: 'Live score on Lock Screen',
  reminders: 'Phone reminders',
};

export function NotificationSettings({ tune }: { tune?: string }) {
  const prefs = usePreferences().data;
  const accent = useAppearance().accent;
  const { patch, saved, error } = usePatchPreferences();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [lockOn, setLockOn] = useState<boolean | null>(null);
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);

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
  // The two saved on this phone, for the rows' values.
  useEffect(() => {
    if (tune) return;
    liveActivityEnabled().then(setLockOn).catch(() => setLockOn(true));
    getReminderSettings().then(setReminders).catch(() => setReminders(DEFAULT_REMINDER_SETTINGS));
  }, [tune]);

  if (!prefs) return <LoadingState />;

  if (tune === 'game') {
    return (
      <View style={styles.gap}>
        <Header title="Game day alerts" subtitle="Which push notifications you get on game day." saved={saved} />
        {error && <Text style={styles.error}>{error}</Text>}
        <Panel description={prefs.push_enabled ? undefined : 'Turn on push notifications first to get these.'}>
          {FANTASY_TOGGLES.map((t, i) => (
            <ToggleRow key={t.key} divided={i > 0} label={t.label} description={t.description} value={Boolean(prefs[t.key])} disabled={!prefs.push_enabled} onChange={(v) => patch({ [t.key]: v })} />
          ))}
        </Panel>
      </View>
    );
  }
  if (tune === 'messages') {
    return (
      <View style={styles.gap}>
        <Header title="Messages" subtitle="Chat notifications: DMs, league chat, mentions and replies." saved={saved} />
        {error && <Text style={styles.error}>{error}</Text>}
        <Panel>
          {MESSAGE_TOGGLES.map((t, i) => (
            <ToggleRow key={t.key} divided={i > 0} label={t.label} description={t.description} value={Boolean(prefs[t.key])} onChange={(v) => patch({ [t.key]: v })} />
          ))}
        </Panel>
      </View>
    );
  }
  if (tune === 'push') return <PushPanel on={prefs.push_enabled} />;
  if (tune === 'lock') return <LiveActivityPanel />;
  if (tune === 'reminders') return <PhoneReminders />;
  if (tune === 'quiet') {
    return (
      <View style={styles.gap}>
        <Header title="Quiet hours" subtitle="Nothing buzzes overnight." saved={saved} />
        {error && <Text style={styles.error}>{error}</Text>}
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
                  accessibilityLabel="Quiet hours start"
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
                  accessibilityLabel="Quiet hours end"
                  style={[styles.input, styles.timeInput]}
                />
              </View>
            </View>
          )}
        </Panel>
      </View>
    );
  }

  const gameOn = FANTASY_TOGGLES.filter((t) => prefs[t.key]).length;
  const messagesOn = MESSAGE_TOGGLES.filter((t) => prefs[t.key]).length;
  const remindersOn = reminders ? REMINDER_TOGGLES.filter((t) => reminders[t.key]).length : null;

  return (
    <View style={styles.gap}>
      <Header title="Notifications" subtitle="What The Weekend lets you know about, and when." saved={saved} />
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={[styles.sundayCard, { borderColor: accent }]}>
        <Text style={[styles.sectionKicker, { color: accent }]}>SUNDAY MODE · THE EASY WAY</Text>
        {SUNDAY_MODES.map((m) => {
          const on = prefs.sunday_mode === m.key;
          return (
            <Pressable
              key={m.key}
              onPress={() => patch({ sunday_mode: m.key }, () => api.applySundayMode(m.key))}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={[styles.sundayOption, on && { borderColor: accent, backgroundColor: `${accent}14` }]}>
              <View style={[styles.radio, { borderColor: on ? accent : Colors.border }]}>{on && <View style={[styles.radioDot, { backgroundColor: accent }]} />}</View>
              <View style={styles.flex}>
                <Text style={styles.listLabel}>{m.label}</Text>
                <Text style={styles.small}>{m.description}</Text>
              </View>
            </Pressable>
          );
        })}
        {!prefs.sunday_mode && <Text style={styles.small}>Customized below, so no preset is on.</Text>}
      </View>

      <Text style={styles.fineTune}>CUSTOMIZE</Text>
      <ListCard>
        <ListRow first label="Game day alerts" sub="Touchdowns, red zone, injuries, your matchup" value={`${gameOn} on`} onPress={() => openTune('notifications', 'game')} />
        <ListRow label="Messages" sub="DMs, league chat, mentions, replies" value={`${messagesOn} on`} onPress={() => openTune('notifications', 'messages')} />
        <ListRow label="Push notifications" sub="Alerts on this phone when the app's closed" value={prefs.push_enabled ? 'On' : 'Off'} onPress={() => openTune('notifications', 'push')} />
        <ListRow
          label="Quiet hours"
          sub="Nothing buzzes overnight"
          value={prefs.quiet_hours_enabled ? `${clockLabel(prefs.quiet_hours_start)} – ${clockLabel(prefs.quiet_hours_end)}` : 'Off'}
          onPress={() => openTune('notifications', 'quiet')}
        />
        {canUseLiveActivities && (
          <ListRow label="Live score on Lock Screen" sub="Your matchup on game day" value={lockOn === null ? undefined : lockOn ? 'On' : 'Off'} onPress={() => openTune('notifications', 'lock')} />
        )}
        <ListRow label="Phone reminders" sub="Lineups, the draft, the chug deadline" value={remindersOn === null ? undefined : `${remindersOn} on`} onPress={() => openTune('notifications', 'reminders')} />
      </ListCard>
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

// Your chat bubble color (moved here from Profile, 2026-10-28): it's
// how your messages look in League Chat.
function ChatBubbleColor() {
  const settings = useMySettings().data;
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;
  const multiBubble = isMulti(settings.chat_color);
  const preview = isHexColor(settings.chat_color) ? settings.chat_color : DEFAULT_BUBBLE_COLOR;
  async function run(_key: string, action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  }
  return (
    <>
      {error && <Text style={styles.error}>{error}</Text>}
      <Panel title="Chat Bubble Color" description="Everyone in League Chat sees your messages in this color.">
        <Swatches
          value={settings.chat_color}
          onChange={(hex) => run('color', () => api.updateChatColor(hex))}
          defaultSwatch={{ color: DEFAULT_BUBBLE_COLOR }}
        />
        <Text style={styles.small}>Preview</Text>
        <View style={styles.previewRow}>
          <View style={[styles.bubble, { backgroundColor: preview }, multiBubble && styles.bubbleClip]}>
            {multiBubble && (
              <LinearGradient colors={[MULTI_COLORS[0], MULTI_COLORS[1], MULTI_COLORS[3]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            )}
            <Text style={{ color: multiBubble ? '#ffffff' : readableTextColor(preview), fontSize: 14 }}>This is how your messages will appear in League Chat.</Text>
          </View>
        </View>
      </Panel>
    </>
  );
}

export function ChatSettings() {
  const prefs = usePreferences().data;
  const { patch, saved, error } = usePatchPreferences();
  if (!prefs) return <LoadingState />;
  return (
    <View style={styles.gap}>
      <Header title="Chat" subtitle="How League Chat looks and behaves for you." saved={saved} />
      {error && <Text style={styles.error}>{error}</Text>}
      <ChatBubbleColor />
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

// ---- Look & feel ----

// The looks (2026-10-28, the approved "The Weekend Themes" mockup): each
// is the whole app's background, panels and accent. Fine-tune below
// changes any one piece on top of it. The logo and the opening intro
// stay the brand's own colors whatever you pick.
export const LOOKS: { key: ThemeName; name: string; blurb: string; bg: string; surface: string; accent: string }[] = [
  { key: 'calm', name: 'Calm', blurb: 'The classic: neon green on dark', bg: '#0d1016', surface: '#12161c', accent: '#39ff14' },
  { key: 'cosmic', name: 'Cosmic', blurb: 'Deep purple, each section its own color', bg: '#0a0716', surface: '#171129', accent: '#39ffb0' },
  { key: 'midnight', name: 'Midnight', blurb: 'Navy panels, ice-blue accent', bg: '#060a13', surface: '#0e1526', accent: '#5cc8ff' },
  { key: 'graphite', name: 'Graphite', blurb: 'True black and silver', bg: '#000000', surface: '#121214', accent: '#f2f2f7' },
  { key: 'ember', name: 'Ember', blurb: 'Warm charcoal, orange accent', bg: '#110a07', surface: '#1a110c', accent: '#ff7a2f' },
  { key: 'gridiron', name: 'Gridiron', blurb: 'Field green, lime accent', bg: '#06100a', surface: '#0c1a12', accent: '#b4f03a' },
];

export function lookName(theme: string | undefined): string {
  return LOOKS.find((l) => l.key === theme)?.name ?? 'Calm';
}

const LOOK_PAGE = '/settings?section=look';

export const LOOK_TUNES: Record<string, string> = {
  accent: 'Accent color',
  glow: 'Neon glow',
  background: 'Background lights',
  yourweek: 'Your Week card',
  border: 'Border animation',
  motion: 'Motion',
};

function colorLabel(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value === 'off') return 'Off';
  if (isMulti(value)) return 'Multi';
  return COLOR_PRESETS.find((p) => p.hex.toLowerCase() === value.toLowerCase())?.name ?? 'Custom';
}

export function AppearanceSettings({ tune }: { tune?: string }) {
  const prefs = usePreferences().data;
  const { patch, saved, error } = usePatchPreferences();
  // A new Accent Color reloads the app so everything changes together —
  // once you're done here, not while you're still picking.
  useFocusEffect(useCallback(() => () => flushAccentReload(tune ? LOOK_PAGE : '/settings'), [tune]));
  if (!prefs) return <LoadingState />;

  if (tune === 'glow') {
    return (
      <View style={styles.gap}>
        <Header title="Neon glow" subtitle="How strong the decorative glow reads. Never affects text or contrast." saved={saved} />
        <Panel>
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
      </View>
    );
  }
  if (tune === 'accent') {
    return (
      <View style={styles.gap}>
        <Header title="Accent color" subtitle="The current tab, buttons and glows. Default is your look's own accent; it applies everywhere when you leave this page." saved={saved} />
        {error && <Text style={styles.error}>{error}</Text>}
        <Panel>
          <Swatches
            value={prefs.accent_color}
            onChange={(accent_color) => void patch({ accent_color }).then((ok) => ok && applyAccent(accent_color))}
            without={[DefaultAccent]}
            defaultSwatch={{ color: DefaultAccent }}
          />
        </Panel>
      </View>
    );
  }
  if (tune === 'background') {
    return (
      <View style={styles.gap}>
        <Header title="Background lights" subtitle="The faint breathing honeycomb behind every page. Multi: lights in several colors." saved={saved} />
        <Panel>
          <Swatches value={prefs.honeycomb_color} onChange={(honeycomb_color) => patch({ honeycomb_color })} defaultSwatch={{ color: HoneycombColor }} offOption />
        </Panel>
      </View>
    );
  }
  if (tune === 'yourweek') {
    return (
      <View style={styles.gap}>
        <Header title="Your Week card" subtitle="Just your own Your Week card on Home. Default follows your accent." saved={saved} />
        <Panel>
          <Swatches value={prefs.your_week_color} onChange={(your_week_color) => patch({ your_week_color })} defaultSwatch={{ color: 'rgba(255,255,255,0.15)' }} />
        </Panel>
      </View>
    );
  }
  if (tune === 'border') {
    return (
      <View style={styles.gap}>
        <Header title="Border animation" subtitle="The moving neon ring on every card and countdown. Default follows your accent." saved={saved} />
        <Panel>
          <Swatches value={prefs.border_glow_color} onChange={(border_glow_color) => patch({ border_glow_color })} defaultSwatch={{ color: 'rgba(255,255,255,0.15)' }} />
        </Panel>
      </View>
    );
  }
  if (tune === 'motion') {
    return (
      <View style={styles.gap}>
        <Header title="Motion" subtitle="Your phone's own Reduce Motion setting is always respected." saved={saved} />
        <Panel>
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

  return (
    <View style={styles.gap}>
      <Header title="Look & feel" subtitle="Pick a look, then fine-tune it your way." saved={saved} />
      {error && <Text style={styles.error}>{error}</Text>}

      <LookPicker prefs={prefs} patch={patch} />

      <Text style={styles.fineTune}>FINE-TUNE</Text>
      <ListCard>
        <ListRow first label="Accent color" value={colorLabel(prefs.accent_color, `${lookName(prefs.theme)} default`)} onPress={() => openTune('look', 'accent')} />
        <ListRow label="Neon glow" value={{ subtle: 'Subtle', standard: 'Standard', high: 'High' }[prefs.neon_intensity]} onPress={() => openTune('look', 'glow')} />
        <ListRow label="Background lights" value={colorLabel(prefs.honeycomb_color, `${lookName(prefs.theme)} default`)} onPress={() => openTune('look', 'background')} />
        <ListRow label="Your Week card" value={colorLabel(prefs.your_week_color, 'Match accent')} onPress={() => openTune('look', 'yourweek')} />
        <ListRow label="Border animation" value={colorLabel(prefs.border_glow_color, 'Match accent')} onPress={() => openTune('look', 'border')} />
        <ListRow label="Motion" value={prefs.reduced_motion ? 'Reduced' : 'Full'} onPress={() => openTune('look', 'motion')} />
      </ListCard>
    </View>
  );
}

function LookPicker({ prefs, patch }: { prefs: OwnerPreferences; patch: ReturnType<typeof usePatchPreferences>['patch'] }) {
  const current = LOOKS.find((l) => l.key === prefs.theme) ?? LOOKS[0];
  const [shown, setShown] = useState(current);

  function pick(l: (typeof LOOKS)[number]) {
    setShown(l);
    if (l.key === prefs.theme) return;
    // Every look rebuilds every color, so the app restarts; say so first,
    // and say it comes back here.
    Alert.alert(
      `Switch to ${l.name}?`,
      `${l.blurb}. The app restarts to apply it, then brings you right back here. Your accent and color picks go back to ${l.name}'s own; fine-tune them after.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setShown(current) },
        {
          text: 'Switch',
          onPress: () =>
            void patch({ theme: l.key, accent_color: null, honeycomb_color: null, your_week_color: null, border_glow_color: null }).then((ok) => {
              if (!ok) return;
              applyAccent(null);
              applyTheme(l.key, LOOK_PAGE);
            }),
        },
      ],
    );
  }

  return (
    <View style={styles.gap}>
      <View style={[styles.themePreview, { backgroundColor: shown.surface, borderColor: shown.accent }]} accessible accessibilityLabel={`Preview of ${shown.name}`}>
        <Text style={[styles.themeKicker, { color: shown.accent }]}>PREVIEW · {shown.name.toUpperCase()}</Text>
        <View style={styles.themeScore}>
          <Text style={styles.themeBig}>You 104.2</Text>
          <Text style={[styles.themeBig, { color: Colors.textSecondary }]}>97.5</Text>
        </View>
        <View style={styles.themeTrack}>
          <View style={[styles.themeFill, { backgroundColor: shown.accent }]} />
        </View>
        <Text style={styles.small}>68% to win · 3 players left</Text>
      </View>
      <Text style={styles.fineTune}>LOOKS</Text>
      <View style={styles.themeGrid}>
        {LOOKS.map((l) => {
          const on = prefs.theme === l.key;
          return (
            <Pressable
              key={l.key}
              onPress={() => pick(l)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${l.name}: ${l.blurb}`}
              style={[styles.themeTile, { backgroundColor: l.bg, borderColor: on ? l.accent : Colors.border }]}>
              <View style={styles.themeDots}>
                <View style={[styles.themeDot, { backgroundColor: l.accent }]} />
                <View style={[styles.themeDot, { backgroundColor: l.surface, borderWidth: 1, borderColor: '#343b47' }]} />
              </View>
              <View>
                <Text style={styles.bodyMedium}>{l.name}</Text>
                {on && <Text style={[styles.lookTag, { color: l.accent }]}>Current</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.small}>You&apos;re on {current.name}. A new look restarts the app and brings you back here. The logo and the opening intro stay the same for everyone.</Text>
    </View>
  );
}

// ---- Sound & app icon ----

export function SoundSettings() {
  return (
    <View style={styles.gap}>
      <Header title="Sound & app icon" subtitle="The intro sound, and the icon on your home screen." />
      <IntroSoundSetting />
      {canChangeAppIcon && <SeasonalIconSetting />}
    </View>
  );
}

// ---- Help ----

export function HelpSettings() {
  const accent = useAppearance().accent;
  const links: { label: string; sub: string; onPress: () => void }[] = [
    { label: 'Glossary', sub: 'Every term in The Weekend, and where to find it', onPress: () => router.push('/glossary' as Href) },
    { label: 'Replay the New Here tour', sub: 'The welcome slides, any time', onPress: () => tour.open(0) },
    { label: "What's New", sub: 'The latest changes', onPress: () => router.push('/whats-new' as Href) },
  ];
  return (
    <View style={styles.gap}>
      <Header title="Help & feedback" subtitle="How things work, what's new, and how to reach us." />
      <Panel>
        {links.map((l, i) => (
          <Pressable key={l.label} onPress={l.onPress} accessibilityRole="button" style={[styles.helpRow, i > 0 && styles.divided]}>
            <View style={styles.flex}>
              <Text style={styles.bodyMedium}>{l.label}</Text>
              <Text style={styles.small}>{l.sub}</Text>
            </View>
            <Text style={[styles.helpChevron, { color: accent }]}>›</Text>
          </Pressable>
        ))}
      </Panel>
      <FeedbackSettings />
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
      <Header title="Features" subtitle="Optional extras you can turn on or off." saved={saved} />
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

// Saved on this phone (lib/introSound.ts), so it changes right away.
function IntroSoundSetting() {
  const [mode, setMode] = useState<IntroSoundMode>(getIntroSoundMode);
  return (
    <Panel
      title="Intro Sound"
      description="The full intro when you open the app: the lights clicking on, then a can cracking open and the pour. Plays only when your ringer is on. Every other open gets the quick version.">
      <Segment
        options={[
          { key: 'daily', label: 'Once a Day' },
          { key: 'always', label: 'Every Time' },
          { key: 'off', label: 'Off' },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setIntroSoundMode(next);
        }}
      />
    </Panel>
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
  const [viewing, setViewing] = useState<string | null>(null);

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
      <ImageViewer uri={viewing} onClose={() => setViewing(null)} />
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
            <Pressable onPress={() => setViewing(image.local)} accessibilityRole="imagebutton" accessibilityLabel="Open screenshot">
              <Image source={{ uri: image.local }} style={[styles.attachmentImage, image.status === 'uploading' && styles.dim]} contentFit="cover" />
            </Pressable>
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
      {/* The league's admin inbox — also on the website's Privacy Policy
          and Terms, and where these feedback notes are emailed. */}
      <Panel title="Email Us" description="Prefer email? Questions, account or privacy requests, anything else.">
        <Pressable
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('The Weekend')}`)}
          accessibilityRole="link"
          style={[styles.secondary, { borderColor: accent }]}>
          <Text style={styles.body}>{SUPPORT_EMAIL}</Text>
        </Pressable>
      </Panel>
      {isCommissioner && <RecentFeedback />}
    </View>
  );
}

function RecentFeedback() {
  const q = useFeedbackList(true);
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <Panel title="Recent Feedback">
      <ImageViewer uri={viewing} onClose={() => setViewing(null)} />
      {q.isPending ? (
        <ActivityIndicator />
      ) : (q.data ?? []).length === 0 ? (
        <Text style={styles.small}>Nothing submitted yet.</Text>
      ) : (
        (q.data ?? []).map((item, i) => (
          <View key={item.id} style={[styles.feedbackItem, i > 0 && styles.divided]}>
            <Text style={styles.body}>{item.message}</Text>
            {item.image_url && (
              <Pressable onPress={() => setViewing(item.image_url)} accessibilityRole="imagebutton" accessibilityLabel="Open screenshot">
                <Image source={{ uri: item.image_url }} style={styles.feedbackImage} contentFit="contain" />
              </Pressable>
            )}
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
  listCard: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8 },
  listLine: { borderTopWidth: 1, borderTopColor: Colors.border },
  listPressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  listLabel: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  listValue: { maxWidth: 150, color: Colors.textSecondary, fontSize: 13, textAlign: 'right' },
  listChevron: { fontSize: 22, fontWeight: '300' },
  sundayCard: { borderRadius: 18, borderWidth: 1, backgroundColor: Colors.surface, padding: 14, gap: 10 },
  sectionKicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  sundayOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bg, paddingHorizontal: 12, paddingVertical: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  fineTune: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, marginTop: Spacing.sm },
  themePreview: { borderRadius: 18, borderWidth: 1.5, padding: 14, gap: 8 },
  themeKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  themeScore: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  themeBig: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  themeTrack: { height: 8, borderRadius: 4, backgroundColor: '#232933', overflow: 'hidden' },
  themeFill: { width: '64%', height: '100%' },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  themeTile: { flexBasis: '30%', flexGrow: 1, minHeight: 80, borderRadius: 14, borderWidth: 2, padding: 10, justifyContent: 'space-between' },
  themeDots: { flexDirection: 'row', gap: 4 },
  themeDot: { width: 16, height: 16, borderRadius: 8 },
  lookTag: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6 },
  helpChevron: { fontSize: 22 },
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
  bubbleClip: { overflow: 'hidden' },
  swatchCustomEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' },
  // Over the dot, scaled to cover it; 0.02 rather than 0 so iOS still delivers the tap.
  pickerHitArea: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: 0.02, transform: [{ scale: 1.4 }] },
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
