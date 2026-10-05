import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Door, GhostButton, Icon, Kicker, StartScreen, startStyles, Sub, Title } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, useMe } from '@/lib/queries';
import { seasonalEmblem } from '@/lib/seasonal';
import type { LeagueInfo } from '@/lib/types';

// The front door for joining or creating a league (port of the web's
// /start, components/start/StartFlow.tsx): two doors for someone with no
// league yet, or "Welcome back" with their leagues for someone who has
// one. Join and Create are their own screens (start/join, start/create).
//
// Shared by the /start screen and the picker a cold open's intro
// reveals (components/LaunchPicker.tsx). onOpened runs once a league is
// chosen; onLeave just before Join or Create opens.
export function LeaguePicker({ onOpened, onLeave }: { onOpened: () => void; onLeave?: () => void }) {
  const me = useMe().data;
  const q = useQuery({ queryKey: ['leagues-mine'], queryFn: api.leaguesMine });
  if (q.isPending) return <LoadingState />;
  const leagues = q.data?.leagues ?? [];
  const activeId = q.data?.active_league_id ?? null;

  async function open(leagueId: number) {
    haptics.tap();
    if (leagueId !== activeId) {
      await api.selectLeague(leagueId).catch(() => {});
      await queryClient.invalidateQueries();
    }
    onOpened();
  }

  function go(href: '/start/join' | '/start/create' | '/leagues', params?: { from: string }) {
    onLeave?.();
    router.push(params ? { pathname: href, params } : href);
  }

  if (leagues.length > 0) {
    return (
      <StartScreen
        footer={
          <View style={styles.footerCol}>
            <View style={styles.row}>
              <GhostButton label="Join another" onPress={() => go('/start/join')} flex />
              <GhostButton label="Create new" onPress={() => go('/start/create')} flex />
            </View>
            <Pressable onPress={() => go('/leagues')} accessibilityRole="button" style={styles.manageLink}>
              <Text style={styles.manageText}>Manage leagues &amp; invites →</Text>
            </Pressable>
          </View>
        }>
        <View style={styles.welcomeRow}>
          <Image source={seasonalEmblem()} style={styles.smallEmblem} contentFit="contain" accessible={false} />
          <View>
            <Kicker>Welcome back</Kicker>
            <Text style={styles.name}>{me?.display_name ?? 'Commish'}</Text>
          </View>
        </View>
        <View style={styles.list}>
          <Kicker>Your leagues</Kicker>
          {leagues.map((l) => (
            <Pressable
              key={l.id}
              onPress={() => void open(l.id)}
              accessibilityRole="button"
              accessibilityLabel={`${l.name}${l.id === activeId ? ', active' : ''}`}
              style={({ pressed }) => [startStyles.card, l.id === activeId && startStyles.cardLit, pressed && styles.pressed]}>
              <View style={styles.cardTop}>
                <Text style={startStyles.cardTitle}>{l.name}</Text>
                {l.id === activeId && (
                  <View style={styles.activePill}>
                    <Text style={styles.activeText}>Active</Text>
                  </View>
                )}
              </View>
              <Text style={startStyles.muted}>{cardLine(l)}</Text>
              {statusChip(l) && (
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>{statusChip(l)}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </StartScreen>
    );
  }

  return (
    <StartScreen>
      <View style={styles.hero}>
        <Image source={seasonalEmblem()} style={styles.emblem} contentFit="contain" accessibilityLabel="The Weekend" />
        <Kicker>Welcome to The Weekend</Kicker>
        <Title>Let&apos;s get you into a league</Title>
        <Sub>Every league here keeps its history, chat, chugs and trash talk in one place.</Sub>
      </View>
      <View style={styles.list}>
        <Door title="Join a league" text="Got an invite link, code or QR from your commissioner?" accent="#39ff14" icon="users" onPress={() => go('/start/join')} />
        <Door title="Create a league" text="Start your own and run it as commissioner." accent="#2fd0ff" icon="plus" onPress={() => go('/start/create')} />
      </View>
      <Pressable
        onPress={() => go('/start/create', { from: 'espn' })}
        accessibilityRole="button"
        style={({ pressed }) => [styles.espn, pressed && styles.pressed]}>
        <Icon name="download" color="#fbbf24" size={20} />
        <Text style={[startStyles.muted, styles.flex]}>
          <Text style={styles.strong}>Moving from ESPN?</Text> Bring your league over with every past season, record and rivalry.
        </Text>
      </Pressable>
    </StartScreen>
  );
}

// "Bucky'd Up · 2–1 · Week 4 · Commissioner", like the mockup.
function cardLine(l: LeagueInfo): string {
  const s = l.summary;
  const role = l.role === 'commissioner' ? 'Commissioner' : 'Member';
  if (!s?.team_name) return s && s.team_count ? `${s.teams} of ${s.team_count} teams in · ${role}` : role;
  const bits = [s.team_name];
  if (s.record && s.draft_status === 'complete') bits.push(s.record.replace('-', '–'));
  if (s.week && s.draft_status === 'complete') bits.push(`Week ${s.week}`);
  bits.push(role);
  return bits.join(' · ');
}

// What's next for the league, when there's something: the draft, or
// open spots before it.
function statusChip(l: LeagueInfo): string | null {
  const s = l.summary;
  if (!s || s.draft_status === 'complete') return null;
  if (s.draft_at && new Date(s.draft_at).getTime() > Date.now()) {
    const d = new Date(s.draft_at);
    return `Draft ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (s.draft_status === 'in_progress' || s.draft_status === 'paused') return 'Drafting now';
  if (s.team_count && s.teams < s.team_count) return `${s.team_count - s.teams} spots open`;
  return null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  footerCol: { gap: Spacing.sm },
  manageLink: { alignItems: 'center', paddingVertical: 6 },
  manageText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.8 },
  hero: { alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.md },
  emblem: { width: 120, height: 120 },
  list: { gap: Spacing.md },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  smallEmblem: { width: 56, height: 56 },
  name: { fontFamily: Fonts.displayBold, fontSize: 30, letterSpacing: 1, color: Colors.accent, textShadowColor: 'rgba(57,255,20,0.55)', textShadowRadius: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  activePill: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(57,255,20,0.14)' },
  activeText: { color: Colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  espn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2a303a' },
  strong: { color: Colors.text, fontWeight: '700' },
  statusPill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(251,191,36,0.14)' },
  statusText: { color: '#fbbf24', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
});
