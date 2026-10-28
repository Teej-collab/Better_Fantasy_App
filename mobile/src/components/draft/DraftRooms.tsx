import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';

import { CamControls, CamTile } from '@/components/draft/DraftCams';
import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { openSignedInWeb } from '@/lib/webHandoff';
import { positionColor } from '@/lib/positionColors';
import type { DraftPick } from '@/lib/types';

// The phone draft room's two looks (2026-10-28, the approved "Draft Room
// Reimagined" mockups A and B), picked the first time you open the
// room and switched with one tap after:
// - The Stage: whoever's on the clock big, with the countdown, and
//   everyone else in a honeycomb under them.
// - The Table: everyone around a table, the pick revealed in the middle,
//   and arrows around the rim (plus a banner) showing which way the
//   draft is going, which flips every round in a snake.
// The tabs below (Players, Queue, Board, Chat) are the same in both.

export type RoomStyle = 'stage' | 'table';
const STYLE_KEY = 'draft_room_style_v1';

export function useRoomStyle(): [RoomStyle | null, boolean, (s: RoomStyle) => void] {
  const [style, setStyle] = useState<RoomStyle | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync(STYLE_KEY)
      .then((v) => {
        if (v === 'stage' || v === 'table') setStyle(v);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  const choose = (s: RoomStyle) => {
    setStyle(s);
    void SecureStore.setItemAsync(STYLE_KEY, s).catch(() => {});
  };
  return [style, loaded, choose];
}

export type Seat = {
  ownerId: number;
  name: string;
  // Draft slot, 1-based.
  slot: number;
  online: boolean;
  clock: boolean;
  me: boolean;
  // 1, 2 or 3: picks after the one on the clock.
  upNext: number | null;
};

export type Direction = 'forward' | 'back' | 'none';

function ringFor(seat: Seat): string | null {
  if (seat.clock) return Colors.accent;
  if (seat.me) return '#4cc3ff';
  return null;
}

function pickLabel(p: DraftPick): string {
  return `${p.round}.${String(p.round_pick).padStart(2, '0')}`;
}

function LastPick({ pick, compact }: { pick: DraftPick | undefined; compact?: boolean }) {
  if (!pick || !pick.player_name) return null;
  const color = positionColor(pick.player_position);
  return (
    <View style={[styles.lastPick, compact && styles.lastPickCompact]}>
      <Text style={styles.lastNum}>{pickLabel(pick)}</Text>
      <View style={[styles.lastStripe, { backgroundColor: color }]} />
      <View style={styles.flex}>
        <Text style={styles.lastName} numberOfLines={1}>
          {pick.owner_name} took {pick.player_name}
        </Text>
        <Text style={styles.small} numberOfLines={1}>
          {pick.player_position === 'DEF' ? 'D/ST' : pick.player_position}
          {pick.adp != null ? ` · ADP ${Math.round(pick.adp)}` : ''}
        </Text>
      </View>
      {pick.adp_verdict && (
        <View style={[styles.verdict, { backgroundColor: pick.adp_verdict === 'steal' ? Colors.accent : '#fb923c' }]}>
          <Text style={styles.verdictText}>{pick.adp_verdict === 'steal' ? 'STEAL' : 'REACH'}</Text>
        </View>
      )}
    </View>
  );
}

function UpBadge({ n }: { n: number }) {
  return (
    <View style={styles.upBadge} accessibilityLabel={`Picks ${n === 1 ? 'next' : `${n} picks from now`}`}>
      <Text style={styles.upText} maxFontSizeMultiplier={1}>
        {n}
      </Text>
    </View>
  );
}

/** A: whoever's on the clock up top, everyone in a honeycomb under them. */
export function StageView({ seats, seconds, lastPick, statusLine }: { seats: Seat[]; seconds: number | null; lastPick: DraftPick | undefined; statusLine: string }) {
  const { width } = useWindowDimensions();
  const clock = seats.find((s) => s.clock);
  const cols = Math.min(6, Math.max(4, Math.ceil(seats.length / 2)));
  const tileW = Math.floor((width - 24 - (cols - 1) * 6) / cols);
  const tileH = Math.round(tileW * 0.86);
  return (
    <View style={styles.stage}>
      {clock ? (
        <View style={styles.hero}>
          <View>
            <CamTile ownerId={clock.ownerId} name={clock.name} width={176} height={128} ring={Colors.accent} index={clock.slot} />
            {seconds !== null && (
              <View style={[styles.timer, seconds <= 10 && styles.timerUrgent]}>
                <Text style={styles.timerText}>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</Text>
              </View>
            )}
          </View>
          <Text style={styles.eyebrow}>{clock.me ? "YOU'RE ON THE CLOCK" : 'ON THE CLOCK'}</Text>
          <Text style={styles.heroName} numberOfLines={1}>
            {clock.name}
          </Text>
          <Text style={styles.soft}>{statusLine}</Text>
        </View>
      ) : (
        <Text style={[styles.soft, styles.centerText]}>{statusLine}</Text>
      )}
      <View style={styles.grid}>
        {seats.map((s) => (
          <View key={s.ownerId} style={[styles.gridCell, { width: tileW }]}>
            <CamTile ownerId={s.ownerId} name={s.name} width={tileW} height={tileH} ring={ringFor(s)} dim={!s.online && !s.me} index={s.slot} small />
            {s.upNext && <UpBadge n={s.upNext} />}
            <Text style={[styles.seatName, s.clock && { color: Colors.accent }, s.me && !s.clock && { color: '#4cc3ff' }]} numberOfLines={1}>
              {s.me ? 'You' : s.name}
            </Text>
          </View>
        ))}
      </View>
      <LastPick pick={lastPick} />
    </View>
  );
}

/** B: everyone around a table, the pick in the middle, and which way it's going. */
export function TableView({
  seats,
  direction,
  round,
  lastPick,
  seconds,
}: {
  seats: Seat[];
  direction: Direction;
  round: number | null;
  lastPick: DraftPick | undefined;
  seconds: number | null;
}) {
  const { width } = useWindowDimensions();
  const n = Math.max(seats.length, 1);
  const tileW = n > 10 ? 50 : 56;
  const tileH = Math.round(tileW * 0.88);
  const height = 330;
  const cx = width / 2;
  const cy = height / 2;
  const rx = cx - tileW / 2 - 10;
  const ry = cy - tileH / 2 - 14;
  const angle = (i: number) => (-90 + (i * 360) / n) * (Math.PI / 180);
  const clockIndex = seats.findIndex((s) => s.clock);
  const nextIndex = clockIndex < 0 ? -1 : direction === 'back' ? (clockIndex - 1 + n) % n : (clockIndex + 1) % n;

  const banner =
    direction === 'none'
      ? 'Auction: whoever nominates next'
      : `Round ${round ?? 1} · ${direction === 'forward' ? 'clockwise ↻' : 'counter-clockwise ↺'} · ${direction === 'forward' ? `1 → ${n}` : `${n} → 1`}`;

  return (
    <View style={styles.tableWrap}>
      <View style={[styles.banner, direction === 'back' && styles.bannerBack]} accessibilityLiveRegion="polite">
        <Text style={styles.bannerText}>{banner}</Text>
        {direction !== 'none' && <Text style={styles.small}>{direction === 'forward' ? 'Snake turns at the end of the round' : 'Coming back around'}</Text>}
      </View>
      <View style={{ width, height }}>
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Ellipse cx={cx} cy={cy} rx={rx - 34} ry={ry - 30} fill="#13261a" stroke="rgba(57,255,20,0.3)" strokeWidth={1.5} />
        </Svg>
        {/* Direction arrows between seats, brightest from the clock to whoever's next. */}
        {direction !== 'none' &&
          seats.map((_, i) => {
            const a = (angle(i) + angle(i + 1)) / 2;
            const x = cx + (rx - 44) * Math.cos(a);
            const y = cy + (ry - 40) * Math.sin(a);
            const deg = (a * 180) / Math.PI + (direction === 'forward' ? 90 : -90);
            const hot = direction === 'forward' ? i === clockIndex : (i + 1) % n === clockIndex;
            return (
              <Text
                key={`arrow-${i}`}
                style={[styles.chevron, { left: x - 8, top: y - 12, transform: [{ rotate: `${deg}deg` }] }, hot && styles.chevronHot]}
                maxFontSizeMultiplier={1}
                accessibilityElementsHidden
                importantForAccessibility="no">
                ›
              </Text>
            );
          })}
        <View style={[styles.center, { left: cx - 80, top: cy - 52 }]}>
          {seconds !== null && clockIndex >= 0 && (
            <Text style={[styles.centerClock, seconds <= 10 && { color: Colors.loss }]}>
              {`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
            </Text>
          )}
          {lastPick?.player_name ? (
            <>
              <Text style={styles.eyebrow}>THE PICK IS IN · {pickLabel(lastPick)}</Text>
              <Text style={styles.centerPlayer} numberOfLines={2}>
                {lastPick.player_name}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {lastPick.owner_name}
                {lastPick.adp_verdict ? ` · ${lastPick.adp_verdict === 'steal' ? 'steal' : 'reach'}` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.soft}>First pick coming up</Text>
          )}
        </View>
        {seats.map((s, i) => {
          const a = angle(i);
          const x = cx + rx * Math.cos(a) - tileW / 2;
          const y = cy + ry * Math.sin(a) - tileH / 2;
          return (
            <View key={s.ownerId} style={[styles.seat, { left: x, top: y, width: tileW }]}>
              <CamTile ownerId={s.ownerId} name={s.name} width={tileW} height={tileH} ring={ringFor(s) ?? (i === nextIndex ? '#facc15' : null)} dim={!s.online && !s.me} index={s.slot} small />
              {s.upNext && <UpBadge n={s.upNext} />}
              <Text style={[styles.seatName, s.clock && { color: Colors.accent }, s.me && !s.clock && { color: '#4cc3ff' }]} numberOfLines={1}>
                {s.me ? 'You' : s.name}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The Stage / Table switch, the cameras' controls, and hide/show. */
export function RoomBar({ style, onStyle, collapsed, onCollapse }: { style: RoomStyle; onStyle: (s: RoomStyle) => void; collapsed: boolean; onCollapse: () => void }) {
  // The Board Wall is the website's (frontend BoardWall.tsx): on an iPad
  // it opens there, signed in, for the big-screen board.
  const wide = useWindowDimensions().width >= 700;
  return (
    <View style={styles.bar}>
      <View style={styles.switch} accessibilityRole="tablist">
        {(['stage', 'table'] as RoomStyle[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              haptics.select();
              onStyle(s);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: style === s }}
            style={[styles.switchOpt, style === s && styles.switchOn]}>
            <Text style={[styles.switchText, style === s && styles.switchTextOn]}>{s === 'stage' ? 'Stage' : 'Table'}</Text>
          </Pressable>
        ))}
      </View>
      <CamControls />
      {wide && (
        <Pressable onPress={() => void openSignedInWeb('/draft?wall=1')} accessibilityRole="button" style={styles.wallBtn}>
          <Text style={styles.switchText}>Board Wall</Text>
        </Pressable>
      )}
      <Pressable onPress={onCollapse} accessibilityRole="button" accessibilityLabel={collapsed ? 'Show the cameras' : 'Hide the cameras'} hitSlop={8} style={styles.collapse}>
        <Text style={styles.collapseText}>{collapsed ? '▾' : '▴'}</Text>
      </Pressable>
    </View>
  );
}

/** The first time in: pick a look. Either one is a tap away later. */
export function RoomPicker({ visible, onPick }: { visible: boolean; onPick: (s: RoomStyle) => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.pickerBackdrop}>
        <View style={styles.picker}>
          <Text style={styles.eyebrow}>DRAFT ROOM</Text>
          <Text style={styles.pickerTitle}>How do you want to watch it?</Text>
          <Text style={styles.soft}>You can switch any time with the Stage / Table toggle at the top.</Text>
          {(
            [
              ['stage', 'The Stage', 'Whoever’s on the clock, big, with the countdown. Everyone else in a honeycomb underneath.'],
              ['table', 'The Table', 'Everyone around one table, each pick revealed in the middle, arrows showing which way the snake is going.'],
            ] as const
          ).map(([key, title, body]) => (
            <Pressable
              key={key}
              onPress={() => {
                haptics.tap();
                onPick(key);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <View style={styles.optionArt}>{key === 'stage' ? <StageArt /> : <TableArt />}</View>
              <View style={styles.flex}>
                <Text style={styles.optionTitle}>{title}</Text>
                <Text style={styles.small}>{body}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function StageArt() {
  return (
    <View style={styles.art}>
      <View style={[styles.artHex, { width: 34, height: 26, borderColor: Colors.accent }]} />
      <View style={styles.artRow}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={[styles.artHex, { width: 9, height: 8 }]} />
        ))}
      </View>
      <View style={styles.artRow}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={[styles.artHex, { width: 9, height: 8 }]} />
        ))}
      </View>
    </View>
  );
}

function TableArt() {
  return (
    <View style={styles.art}>
      <Svg width={64} height={56}>
        <Ellipse cx={32} cy={28} rx={18} ry={14} fill="#13261a" stroke="rgba(57,255,20,0.5)" />
        {Array.from({ length: 10 }, (_, i) => {
          const a = (-90 + i * 36) * (Math.PI / 180);
          return <Ellipse key={i} cx={32 + 27 * Math.cos(a)} cy={28 + 23 * Math.sin(a)} rx={4} ry={3.5} fill={i === 0 ? Colors.accent : '#3a4252'} />;
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  soft: { color: '#aeb5c1', fontSize: 13 },
  centerText: { textAlign: 'center', paddingVertical: Spacing.sm },
  eyebrow: { color: Colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  stage: { paddingHorizontal: 12, paddingTop: 6, gap: 10 },
  hero: { alignItems: 'center', gap: 3 },
  heroName: { color: Colors.text, fontFamily: Fonts.displayBold, fontSize: 22, textTransform: 'uppercase' },
  timer: { position: 'absolute', alignSelf: 'center', bottom: -8, backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 1 },
  timerUrgent: { backgroundColor: Colors.loss },
  timerText: { color: '#0d1016', fontFamily: Fonts.displayBold, fontSize: 18, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gridCell: { alignItems: 'center', gap: 2 },
  seatName: { color: '#aeb5c1', fontSize: 11, fontWeight: '600', maxWidth: '100%' },
  upBadge: { position: 'absolute', top: -4, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#facc15', alignItems: 'center', justifyContent: 'center' },
  upText: { color: '#0d1016', fontSize: 11, fontWeight: '900' },
  lastPick: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  lastPickCompact: { paddingVertical: 6 },
  lastNum: { color: Colors.textSecondary, fontFamily: Fonts.display, fontSize: 14 },
  lastStripe: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  lastName: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  verdict: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  verdictText: { color: '#0d1016', fontSize: 11, fontWeight: '800' },
  tableWrap: { gap: 4 },
  banner: { marginHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.accent, backgroundColor: `${Colors.accent}14`, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  bannerBack: { borderColor: '#facc15', backgroundColor: 'rgba(250,204,21,0.08)' },
  bannerText: { color: Colors.text, fontSize: 14, fontWeight: '800' },
  chevron: { position: 'absolute', width: 16, textAlign: 'center', color: 'rgba(174,181,193,0.45)', fontSize: 20, fontWeight: '900' },
  chevronHot: { color: Colors.accent },
  center: { position: 'absolute', width: 160, alignItems: 'center', gap: 2 },
  centerClock: { color: Colors.accent, fontFamily: Fonts.displayBold, fontSize: 22, fontVariant: ['tabular-nums'] },
  centerPlayer: { color: Colors.text, fontFamily: Fonts.displayBold, fontSize: 18, textTransform: 'uppercase', textAlign: 'center' },
  seat: { position: 'absolute', alignItems: 'center', gap: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, flexWrap: 'wrap' },
  switch: { flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: Colors.border, padding: 2 },
  switchOpt: { minHeight: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.accent },
  switchText: { color: '#aeb5c1', fontSize: 12, fontWeight: '700' },
  switchTextOn: { color: '#0d1016' },
  wallBtn: { minHeight: 34, borderRadius: 999, borderWidth: 1, borderColor: Colors.accent, paddingHorizontal: 12, justifyContent: 'center' },
  collapse: { marginLeft: 'auto', width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  collapseText: { color: Colors.text, fontSize: 14 },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(4,6,9,0.8)', justifyContent: 'center', padding: Spacing.lg },
  picker: { borderRadius: 24, backgroundColor: Colors.surface, borderWidth: 1, borderColor: `${Colors.accent}55`, padding: Spacing.lg, gap: 10 },
  pickerTitle: { color: Colors.text, fontFamily: Fonts.displayBold, fontSize: 24, textTransform: 'uppercase' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg, padding: 12, minHeight: 88 },
  optionArt: { width: 68, alignItems: 'center' },
  optionTitle: { color: Colors.text, fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  art: { alignItems: 'center', gap: 3 },
  artRow: { flexDirection: 'row', gap: 2 },
  artHex: { borderRadius: 3, borderWidth: 1, borderColor: '#3a4252', backgroundColor: '#1d232c' },
});
