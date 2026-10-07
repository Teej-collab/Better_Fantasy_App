import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ShareableCard } from '@/components/ShareableCard';
import { PageTitle } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api, uploadCardPhoto } from '@/lib/api';
import { pickCardPhoto } from '@/lib/cardPhoto';
import { queryClient, useActiveLeague, useCareerProfile, useMe, useOwnerBadges, useOwners, useSeasonProfile } from '@/lib/queries';
import type { Owner, OwnerBadges, PeriodSummary } from '@/lib/types';

const CARD_HEIGHT = 460;
const GAP = 16;

// Port of the web's /players page (CardDeck + TeamProfileCard): every
// owner's trading card in a coverflow carousel. Tap the centered card
// to flip it for career stats, or pick a season on the back.
export default function PlayerCardsScreen() {
  const owners = useOwners();
  const { width } = useWindowDimensions();
  const cardWidth = Math.round(width * 0.82);
  const step = cardWidth + GAP;
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  if (owners.isPending) return <LoadingState />;
  const list = owners.data ?? [];
  if (list.length === 0) return <MessageState message="No owners yet." />;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Player Cards' }} />
      <View style={styles.header}>
        <PageTitle subtitle={`Every owner who's ever been in the league — ${list.length} total. Tap a card for stats, then pick a season.`}>
          Player Cards
        </PageTitle>
      </View>
      <Animated.FlatList
        data={list}
        keyExtractor={(o) => String(o.owner_id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: (width - cardWidth) / 2, gap: GAP }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => (
          <CoverflowItem index={index} step={step} scrollX={scrollX} width={cardWidth}>
            <TradingCard owner={item} />
            <ChangePhoto owner={item} />
          </CoverflowItem>
        )}
      />
    </View>
  );
}

// The web's coverflow: side cards turn away, shrink and fade.
function CoverflowItem(props: { index: number; step: number; scrollX: SharedValue<number>; width: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const d = Math.max(-1, Math.min(1, (props.scrollX.value - props.index * props.step) / props.step));
    return {
      opacity: interpolate(Math.abs(d), [0, 1], [1, 0.55]),
      transform: [{ perspective: 1600 }, { rotateY: `${d * 30}deg` }, { scale: interpolate(Math.abs(d), [0, 1], [1, 0.85]) }],
    };
  });
  return <Animated.View style={[{ width: props.width }, style]}>{props.children}</Animated.View>;
}

// Your own card, or every card if you're the commissioner: set the photo.
function ChangePhoto({ owner }: { owner: Owner }) {
  const me = useMe().data;
  const isCommissioner = useActiveLeague().data?.role === 'commissioner';
  const [busy, setBusy] = useState(false);
  if (!me || (me.owner_id !== owner.owner_id && !isCommissioner)) return null;

  async function pick() {
    const choices = owner.photo_url ? ['Choose a photo', 'Remove photo', 'Cancel'] : ['Choose a photo', 'Cancel'];
    const run = async (i: number) => {
      try {
        setBusy(true);
        if (i === 0) {
          const uri = await pickCardPhoto();
          if (!uri) return;
          await uploadCardPhoto(owner.owner_id, uri);
        } else if (i === 1 && owner.photo_url) {
          await api.deleteCardPhoto(owner.owner_id);
        } else {
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ['owners'] });
      } catch (e) {
        Alert.alert("Couldn't update the photo", e instanceof Error ? e.message : undefined);
      } finally {
        setBusy(false);
      }
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: choices, cancelButtonIndex: choices.length - 1, destructiveButtonIndex: owner.photo_url ? 1 : undefined },
        (i) => void run(i),
      );
    } else {
      void run(0);
    }
  }

  return (
    <Pressable onPress={() => void pick()} disabled={busy} hitSlop={8} style={styles.changePhoto} accessibilityRole="button">
      <Text style={styles.changePhotoText}>{busy ? 'Saving…' : me.owner_id === owner.owner_id ? 'Change my photo' : 'Change photo'}</Text>
    </Pressable>
  );
}

function TradingCard({ owner }: { owner: Owner }) {
  const badges = useOwnerBadges(owner.owner_id).data ?? { championship_years: [], award_summary: {} };
  const flip = useSharedValue(0);
  const [flipped, setFlipped] = useState(false);
  const front = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${flip.value * 180}deg` }],
    backfaceVisibility: 'hidden',
  }));
  const back = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${flip.value * 180 + 180}deg` }],
    backfaceVisibility: 'hidden',
  }));

  function toggle() {
    const next = !flipped;
    setFlipped(next);
    flip.value = withTiming(next ? 1 : 0, { duration: 500 });
  }

  return (
    <ShareableCard title={`${owner.display_name}'s card`}>
    <LinearGradient
      colors={['#38bdf8', '#a855f7', '#ec4899', '#f97316', '#facc15', '#38bdf8']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.frame}>
      <View style={styles.bg}>
        <Pressable onPress={toggle} style={styles.flipArea} accessibilityRole="button" accessibilityLabel={`${owner.display_name}'s card`} accessibilityHint="Flips the card over">
          <Animated.View style={[styles.face, front]}>
            <CardFront owner={owner} badges={badges} />
          </Animated.View>
          <Animated.View style={[styles.face, back]}>
            <CardBack owner={owner} badges={badges} />
          </Animated.View>
        </Pressable>
      </View>
    </LinearGradient>
    </ShareableCard>
  );
}

function OwnerPhoto({ owner, compact }: { owner: Owner; compact?: boolean }) {
  // The card photo comes from the private bucket as a short-lived signed
  // link (only for this league's members); cacheKey keeps it cached on the
  // phone across new links until the photo itself changes. Then the team
  // logo, then initials.
  if (owner.photo_url) {
    return (
      <Image
        source={{ uri: owner.photo_url, cacheKey: `card-photo-${owner.owner_id}-${owner.photo_version ?? 0}` }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="disk"
        transition={150}
      />
    );
  }
  if (owner.logo_url) return <Image source={{ uri: owner.logo_url }} style={StyleSheet.absoluteFill} contentFit="cover" />;
  const initials =
    owner.display_name
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return (
    <LinearGradient colors={['rgba(217,70,239,0.5)', 'rgba(251,146,60,0.4)', 'rgba(56,189,248,0.5)']} style={[StyleSheet.absoluteFill, styles.initialsFill]}>
      <Text style={compact ? styles.initialsSmall : styles.initialsBig}>{initials}</Text>
    </LinearGradient>
  );
}

function CardFront({ owner, badges }: { owner: Owner; badges: OwnerBadges }) {
  return (
    <View style={styles.frontInner}>
      <OwnerPhoto owner={owner} />
      {badges.championship_years.length > 0 && (
        <View style={styles.crownRow}>
          <View style={styles.crown}>
            <Text style={styles.crownText}>👑 {badges.championship_years.join(', ')}</Text>
          </View>
        </View>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.9)']} style={styles.frontFooter}>
        <Text style={styles.teamName}>{owner.latest_team_name}</Text>
        <Text style={styles.ownerName}>{owner.display_name}</Text>
        <Text style={styles.tapHint}>Tap for stats</Text>
      </LinearGradient>
    </View>
  );
}

function CardBack({ owner, badges }: { owner: Owner; badges: OwnerBadges }) {
  const [selected, setSelected] = useState<'career' | number>('career');
  const career = useCareerProfile(owner.owner_id).data;
  const seasonProfile = useSeasonProfile(owner.owner_id, typeof selected === 'number' ? selected : null);

  function pickSeason() {
    const options = ['Career', ...[...owner.seasons].reverse().map(String)];
    const apply = (i: number) => setSelected(i === 0 ? 'career' : Number(options[i]));
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: [...options, 'Cancel'], cancelButtonIndex: options.length }, (i) => {
        if (i < options.length) apply(i);
      });
    } else {
      Alert.alert('Season', undefined, options.map((o, i) => ({ text: o, onPress: () => apply(i) })));
    }
  }

  return (
    <View style={styles.backInner}>
      <View style={styles.backHead}>
        <View style={styles.backLeft}>
          <View style={styles.avatar}>
            <OwnerPhoto owner={owner} compact />
          </View>
          {badges.championship_years.length > 0 && (
            <View style={styles.crownSmall}>
              <Text style={styles.crownSmallText}>👑 {badges.championship_years.join(', ')}</Text>
            </View>
          )}
        </View>
        <Pressable onPress={pickSeason} style={styles.select} hitSlop={6}>
          <Text style={styles.selectText}>{selected === 'career' ? 'Career' : selected} ▾</Text>
        </Pressable>
      </View>

      {selected === 'career' ? (
        career ? (
          <View style={styles.gap}>
            <Text style={styles.seasonsLine}>Seasons played: {career.seasons.join(', ')}</Text>
            <View style={styles.pair}>
              <RecordBox title="Regular season" summary={career.regular} />
              <RecordBox title="Playoffs" summary={career.playoff} emptyText="Never made the playoffs (yet)" />
            </View>
            <View style={styles.pair}>
              <DarkBox>
                <Label>Best week ever</Label>
                <Value>{career.best_week ? `${career.best_week.season} Wk ${career.best_week.week} — ${career.best_week.score}` : '—'}</Value>
                <Label>Best season</Label>
                <Value>{career.best_season ? `${career.best_season.season} (${career.best_season.record})` : '—'}</Value>
              </DarkBox>
              <DarkBox>
                <Label>Worst week ever</Label>
                <Value>{career.worst_week ? `${career.worst_week.season} Wk ${career.worst_week.week} — ${career.worst_week.score}` : '—'}</Value>
                <Label>Worst season</Label>
                <Value>{career.worst_season ? `${career.worst_season.season} (${career.worst_season.record})` : '—'}</Value>
              </DarkBox>
            </View>
            <CareerAwards summary={badges.award_summary} />
          </View>
        ) : (
          <Text style={styles.loading}>Loading…</Text>
        )
      ) : seasonProfile.isPending ? (
        <Text style={styles.loading}>Loading {selected}…</Text>
      ) : seasonProfile.data ? (
        <View style={styles.gap}>
          <Text style={styles.seasonsLine}>{selected} season</Text>
          <View style={styles.pair}>
            <RecordBox title="Regular season" summary={seasonProfile.data.regular} />
            <RecordBox title="Playoffs" summary={seasonProfile.data.playoff} emptyText="Didn't make the playoffs this season" />
          </View>
          <View style={styles.pair}>
            <DarkBox>
              <Label>Best week</Label>
              <Value>{seasonProfile.data.best_week ? `Wk ${seasonProfile.data.best_week.week} — ${seasonProfile.data.best_week.score}` : '—'}</Value>
            </DarkBox>
            <DarkBox>
              <Label>Worst week</Label>
              <Value>{seasonProfile.data.worst_week ? `Wk ${seasonProfile.data.worst_week.week} — ${seasonProfile.data.worst_week.score}` : '—'}</Value>
            </DarkBox>
          </View>
          <View style={styles.pair}>
            <DarkBox>
              <Label>Avg luck</Label>
              <Value>{seasonProfile.data.avg_luck ?? '—'}</Value>
            </DarkBox>
            <DarkBox>
              <Label>Power rank</Label>
              <Value>{seasonProfile.data.current_power_rank ? `#${seasonProfile.data.current_power_rank}` : '—'}</Value>
            </DarkBox>
          </View>
          {seasonProfile.data.season_awards.length > 0 && (
            <DarkBox>
              <Text style={styles.awardsTitle}>Season Awards</Text>
              {seasonProfile.data.season_awards.map((a, i) => (
                <Text key={i} style={styles.award}>
                  <Text style={styles.star}>★ </Text>
                  {a.award_type}
                  {a.detail && <Text style={styles.awardDetail}> — {a.detail}</Text>}
                </Text>
              ))}
            </DarkBox>
          )}
        </View>
      ) : (
        <Text style={styles.loading}>No data for {selected}.</Text>
      )}
    </View>
  );
}

function DarkBox({ children }: { children: ReactNode }) {
  return <View style={styles.darkBox}>{children}</View>;
}

function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

function Value({ children }: { children: ReactNode }) {
  return <Text style={styles.value}>{children}</Text>;
}

function RecordBox({ title, summary, emptyText = 'No games' }: { title: string; summary: PeriodSummary | null; emptyText?: string }) {
  return (
    <DarkBox>
      <Text style={styles.recordTitle}>{title}</Text>
      {summary ? (
        <View style={styles.miniRow}>
          <MiniStat label="Record" value={summary.record} />
          <MiniStat label="PF" value={Math.round(summary.pf)} color="#7dd3fc" />
          <MiniStat label="PA" value={Math.round(summary.pa)} color="#fdba74" />
        </View>
      ) : (
        <Text style={styles.empty}>{emptyText}</Text>
      )}
    </DarkBox>
  );
}

function MiniStat({ label, value, color = '#fff' }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={[styles.miniValue, { color }]}>{value}</Text>
    </View>
  );
}

function CareerAwards({ summary }: { summary: Record<string, number[]> }) {
  const entries = Object.entries(summary)
    .flatMap(([type, years]) => years.map((year) => ({ type, year })))
    .sort((a, b) => b.year - a.year || a.type.localeCompare(b.type));
  if (entries.length === 0) return null;
  return (
    <DarkBox>
      <Text style={styles.awardsTitle}>Career Awards</Text>
      {entries.map((e, i) => (
        <Text key={i} style={styles.award}>
          <Text style={styles.star}>★ </Text>
          {e.type} ({e.year})
        </Text>
      ))}
    </DarkBox>
  );
}

const styles = StyleSheet.create({
  changePhoto: { alignSelf: 'center', marginTop: Spacing.sm, paddingVertical: 6 },
  changePhotoText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  screen: { flex: 1 },
  header: { padding: Spacing.lg },
  frame: {
    borderRadius: 16,
    padding: 3,
    shadowColor: '#ec4899',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  bg: { borderRadius: 13, backgroundColor: '#05030f', padding: Spacing.lg },
  flipArea: { height: CARD_HEIGHT },
  face: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  frontInner: { flex: 1, borderRadius: 10, overflow: 'hidden' },
  initialsFill: { alignItems: 'center', justifyContent: 'center' },
  initialsBig: { color: '#fff', fontSize: 60, fontWeight: '700' },
  initialsSmall: { color: '#fff', fontSize: 12, fontWeight: '700' },
  crownRow: { position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' },
  crown: { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  crownText: { color: '#fcd34d', fontSize: 12, fontWeight: '600' },
  frontFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 40, paddingBottom: 12, paddingHorizontal: 12, gap: 2 },
  teamName: {
    color: '#fcd34d',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(252,211,77,0.45)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
  ownerName: { color: '#bae6fd', fontSize: 14 },
  tapHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '500', marginTop: 4 },
  backInner: { flex: 1, gap: Spacing.md },
  backHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  crownSmall: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  crownSmallText: { color: '#fcd34d', fontSize: 11, fontWeight: '600' },
  select: { borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 4 },
  selectText: { color: '#fff', fontSize: 14 },
  gap: { gap: Spacing.sm },
  seasonsLine: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center' },
  pair: { flexDirection: 'row', gap: Spacing.sm },
  darkBox: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.4)', padding: 10 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  value: { color: '#fff', fontSize: 13, fontWeight: '500', marginBottom: 6, fontVariant: ['tabular-nums'] },
  recordTitle: { color: '#f9a8d4', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  miniRow: { flexDirection: 'row', gap: 4 },
  mini: { flex: 1 },
  miniLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  miniValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  awardsTitle: { color: '#fcd34d', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  award: { color: '#fef3c7', fontSize: 13 },
  star: { color: '#fbbf24' },
  awardDetail: { color: 'rgba(253,230,138,0.7)' },
  loading: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' },
});
