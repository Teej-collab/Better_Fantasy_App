import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  Line,
  LinearGradient,
  Marker,
  Path,
  Polygon,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { VIEW_H, VIEW_W, bandPoints, endLineAngle, pathD, playPath, pointsAttr, project, type PlayPath } from '@/lib/fieldGeometry';
import { lastSnap, ordinal } from '@/lib/gamecast';
import { nflTeamColor, nflTeamName, teamLogoUrl } from '@/lib/nflTeams';
import type { LiveGame } from '@/lib/types';

// The broadcast-style field, same as the web's FieldVisualization: drawn
// in perspective (lib/fieldGeometry.ts), team-colored end zones with
// their names, goalposts, the line of scrimmage, the yellow first-down
// line, and a pin with the offense's logo on the ball. Each new snap is
// replayed on it — passes and kicks arc through the air with a shadow on
// the turf, runs slide along the ground — then stays as an arrow with a
// dashed line on to the first-down mark. The offense always drives
// left → right. Reduced motion shows the finished play without the flight.
const YARD_LABELS: [number, string][] = [
  [20, '20'],
  [50, '50'],
  [80, '20'],
];
const PLAY_MS: Record<PlayPath['kind'], number> = { pass: 1100, run: 900, kick: 1900, field_goal: 1500 };

export function GamecastField({ game }: { game: LiveGame }) {
  const offense = game.possession_team_abbr;
  const defense =
    offense === game.home_team.abbr ? game.away_team.abbr : offense === game.away_team.abbr ? game.home_team.abbr : null;
  const hasBall = game.status === 'in_progress' && game.yards_to_goal !== null && offense !== null;
  const ytg = game.yards_to_goal ?? 50;
  const ballU = 100 - ytg;
  const offenseColor = nflTeamColor(offense) ?? Colors.accent;
  const defenseColor = nflTeamColor(defense) ?? '#4b5563';
  const goalToGo = game.distance !== null && game.distance >= ytg;
  const firstU = hasBall && game.distance !== null && !goalToGo ? 100 - Math.max(0, ytg - game.distance) : null;

  const snap = lastSnap(game);
  const path = useMemo(() => (hasBall && snap ? playPath(snap, offense) : null), [hasBall, snap, offense]);
  const progress = usePlayProgress(snap?.play_id ?? null, path);

  const downText = game.down ? `${ordinal(game.down)} & ${goalToGo ? 'Goal' : (game.distance ?? '?')}` : null;
  const a11y = hasBall
    ? `${offense} ball${game.field_position_label ? ` at ${game.field_position_label}` : ''}${downText ? `, ${downText}` : ''}${game.is_redzone ? ', in the red zone' : ''}.`
    : game.status === 'final'
      ? 'Game complete.'
      : 'No ball in play.';
  const leftName = hasBall ? (nflTeamName(offense)?.split(' ').pop() ?? offense) : null;
  const rightName = hasBall && defense ? (nflTeamName(defense)?.split(' ').pop() ?? defense) : null;

  return (
    <View style={styles.card} accessible accessibilityRole="image" accessibilityLabel={a11y}>
      <View style={styles.top}>
        <Text style={styles.title}>Field position</Text>
        {game.is_redzone && hasBall && (
          <View style={styles.redzonePill}>
            <Text style={styles.redzoneText}>Red zone</Text>
          </View>
        )}
      </View>

      {hasBall && (
        <View style={styles.situationRow}>
          <View style={styles.situationCell}>
            <Text style={styles.situationLabel}>Down</Text>
            <Text style={styles.situationValue}>{downText ?? '—'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.situationCell}>
            <Text style={styles.situationLabel}>Ball on</Text>
            <Text style={styles.situationValue}>{game.field_position_label ?? '—'}</Text>
          </View>
        </View>
      )}

      <View>
        <Svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" style={{ aspectRatio: VIEW_W / VIEW_H }}>
          <Defs>
            <LinearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#26282d" />
              <Stop offset="1" stopColor="#1d1f23" />
            </LinearGradient>
            <Marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <Path d="M0,0 L10,5 L0,10 z" fill="#fff" />
            </Marker>
          </Defs>

          <Polygon points={pointsAttr(bandPoints(-10, 110))} fill="url(#turf)" />
          {Array.from({ length: 10 }, (_, i) =>
            i % 2 === 1 ? <Polygon key={`b${i}`} points={pointsAttr(bandPoints(i * 10, i * 10 + 10))} fill="#ffffff" fillOpacity={0.035} /> : null,
          )}
          {hasBall && game.is_redzone && <Polygon points={pointsAttr(bandPoints(80, 100))} fill="#ef4444" fillOpacity={0.12} />}

          <EndZone u0={-10} u1={0} color={hasBall ? offenseColor : '#2b2d31'} name={leftName} />
          <EndZone u0={100} u1={110} color={hasBall ? defenseColor : '#2b2d31'} name={rightName} />

          {Array.from({ length: 11 }, (_, i) => {
            const a = project(i * 10, 0);
            const b = project(i * 10, 1);
            return (
              <Line
                key={`l${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#fff"
                strokeOpacity={i === 5 ? 0.35 : 0.16}
                strokeWidth={i === 0 || i === 10 ? 3 : 2}
              />
            );
          })}

          <Goalpost u={-10} />
          <Goalpost u={110} />

          {hasBall && (
            <>
              <GroundLine u={ballU} color="#60a5fa" width={3} />
              {firstU !== null && <GroundLine u={firstU} color="#facc15" width={5} />}
              <PlayTrail path={path} progress={progress} ballU={ballU} firstU={firstU} />
              {progress >= 1 && <BallPin u={ballU} team={offense} color={offenseColor} />}
              <YardLabel u={0} text={offense ?? ''} />
              <YardLabel u={100} text={defense ?? ''} />
            </>
          )}
          {YARD_LABELS.map(([u, text]) => (
            <YardLabel key={u} u={u} text={text} />
          ))}
        </Svg>

        {!hasBall && (
          <View style={styles.overlay}>
            <Text style={styles.overlayText}>
              {game.status === 'final'
                ? 'Game complete'
                : game.status === 'halftime'
                  ? 'Halftime'
                  : game.status === 'scheduled'
                    ? `Kickoff ${new Date(game.scheduled_start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                    : '—'}
            </Text>
          </View>
        )}
        {path?.label && progress >= 1 && (
          <View style={styles.playLabel} pointerEvents="none">
            <Text style={styles.playLabelText}>{path.label}</Text>
          </View>
        )}
      </View>

      {hasBall && (
        <Text style={styles.situation}>
          <Text style={[styles.situationTeam, { color: lighten(offenseColor) }]}>{offense}</Text> ball
          {game.field_position_label ? ` · ${game.field_position_label}` : ''}
        </Text>
      )}
      {hasBall && game.current_drive && (
        <Text style={styles.drive}>
          This drive: {game.current_drive.play_count} plays · {game.current_drive.yards} yds · {game.current_drive.duration}
        </Text>
      )}
    </View>
  );
}

/** 0 → 1 over a new play's flight; restarts whenever the snap changes. */
function usePlayProgress(playId: string | null, path: PlayPath | null): number {
  const systemReduced = useReducedMotion();
  const appReduced = useAppearance().reducedMotion;
  const reduced = systemReduced || appReduced;
  const [state, setState] = useState<{ id: string | null; p: number }>({ id: null, p: 1 });
  useEffect(() => {
    if (!path || playId === null || reduced) return;
    const duration = PLAY_MS[path.kind];
    const start = Date.now();
    let raf = requestAnimationFrame(function tick() {
      const p = Math.min(1, (Date.now() - start) / duration);
      setState({ id: playId, p });
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playId, path, reduced]);
  return state.id === playId ? state.p : 1;
}

function EndZone({ u0, u1, color, name }: { u0: number; u1: number; color: string; name: string | null }) {
  const mid = project((u0 + u1) / 2, 0.5);
  const angle = endLineAngle((u0 + u1) / 2);
  // Left reads bottom → top, right top → bottom, like a broadcast.
  const rotate = u0 < 50 ? angle : angle + 180;
  return (
    <>
      <Polygon points={pointsAttr(bandPoints(u0, u1))} fill={color} fillOpacity={0.92} />
      {name && (
        <SvgText
          x={mid.x}
          y={mid.y + 12}
          rotation={rotate}
          origin={`${mid.x}, ${mid.y}`}
          textAnchor="middle"
          fill="#fff"
          fontSize={34}
          fontWeight="900"
          letterSpacing={2}>
          {name.toUpperCase()}
        </SvgText>
      )}
    </>
  );
}

function Goalpost({ u }: { u: number }) {
  // Seen from the stands the crossbar runs across the field, so it
  // reads as an upright "U": a post, a short crossbar, two uprights.
  const base = project(u, 0.5);
  const bar = project(u, 0.5, 3.3);
  const l = project(u, 0.4, 3.3);
  const r = project(u, 0.6, 3.3);
  const lt = project(u, 0.4, 11);
  const rt = project(u, 0.6, 11);
  return (
    <G strokeWidth={4} strokeLinecap="round" fill="none">
      <Line x1={base.x} y1={base.y} x2={bar.x} y2={bar.y} stroke="#9ca3af" />
      <Path d={`M${lt.x},${lt.y} L${l.x},${l.y} L${r.x},${r.y} L${rt.x},${rt.y}`} stroke="#facc15" />
    </G>
  );
}

function GroundLine({ u, color, width }: { u: number; color: string; width: number }) {
  const a = project(u, 0);
  const b = project(u, 1);
  return <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} />;
}

function YardLabel({ u, text }: { u: number; text: string }) {
  const p = project(u, 1);
  return (
    <SvgText x={p.x} y={p.y + 40} textAnchor="middle" fill="#ffffff" fillOpacity={0.5} fontSize={28} fontWeight="600">
      {text}
    </SvgText>
  );
}

function PlayTrail({ path, progress, ballU, firstU }: { path: PlayPath | null; progress: number; ballU: number; firstU: number | null }) {
  if (!path) return null;
  const count = path.samples.length;
  const upto = Math.max(1, Math.round(progress * (count - 1)));
  const shown = path.samples.slice(0, upto + 1);
  const air = shown.map((s) => project(s.u, s.v, s.h));
  const shadow = shown.map((s) => project(s.u, s.v));
  const head = shown[shown.length - 1];
  const done = progress >= 1;
  const airborne = path.kind !== 'run';
  const ballAt = project(head.u, head.v, head.h);
  const shadowAt = project(head.u, head.v);
  const dashFrom = project(ballU, 0.5);
  const dashTo = firstU !== null ? project(firstU, 0.5) : null;
  return (
    <G>
      {airborne && <Path d={pathD(shadow)} stroke="#000" strokeOpacity={0.45} strokeWidth={3} fill="none" strokeDasharray="2 6" />}
      <Path
        d={pathD(air)}
        stroke="#fff"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={path.incomplete && done ? 0.45 : 0.95}
        markerEnd={done && !path.incomplete ? 'url(#arrow)' : undefined}
      />
      {done && dashTo && Math.abs((firstU ?? 0) - ballU) > 0.5 && (
        <Line x1={dashFrom.x} y1={dashFrom.y} x2={dashTo.x} y2={dashTo.y} stroke="#fff" strokeWidth={4} strokeDasharray="8 8" opacity={0.85} />
      )}
      {!done && (
        <>
          {airborne && <Ellipse cx={shadowAt.x} cy={shadowAt.y} rx={9} ry={3.5} fill="#000" fillOpacity={0.5} />}
          <G x={ballAt.x} y={ballAt.y} rotation={path.kind === 'run' ? 0 : -20}>
            <Ellipse rx={11} ry={7} fill="#8b4513" stroke="#3b1d07" strokeWidth={1.5} />
            <Line x1={-4} y1={0} x2={4} y2={0} stroke="#fff" strokeWidth={1.5} />
          </G>
        </>
      )}
    </G>
  );
}

function BallPin({ u, team, color }: { u: number; team: string | null; color: string }) {
  const at = project(u, 0.5);
  const logo = teamLogoUrl(team);
  // A map pin standing on the ball's spot, the offense's logo inside.
  return (
    <G x={at.x} y={at.y}>
      <Ellipse cx={0} cy={0} rx={10} ry={4} fill="#000" fillOpacity={0.45} />
      <Path d="M0,0 C-10,-22 -32,-38 -32,-62 A32,32 0 1 1 32,-62 C32,-38 10,-22 0,0 Z" fill="#2b2d31" stroke="#fff" strokeWidth={3} />
      <Circle cx={0} cy={-62} r={24} fill={color} />
      {logo ? (
        <SvgImage href={{ uri: logo }} x={-22} y={-84} width={44} height={44} preserveAspectRatio="xMidYMid meet" />
      ) : (
        <SvgText x={0} y={-56} textAnchor="middle" fill="#fff" fontSize={18} fontWeight="800">
          {team}
        </SvgText>
      )}
    </G>
  );
}

// Team colors are often deep navies; lift them so the abbreviation reads
// on the dark card.
export function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  redzonePill: { backgroundColor: 'rgba(239,68,68,0.18)', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  redzoneText: { color: Colors.live, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  situationRow: { flexDirection: 'row', alignItems: 'center' },
  situationCell: { flex: 1, alignItems: 'center' },
  situationLabel: { color: Colors.textSecondary, fontSize: 12 },
  situationValue: { color: Colors.text, fontSize: 18, fontFamily: Fonts.monoBold },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.2)' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  overlayText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  playLabel: {
    position: 'absolute',
    top: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  playLabelText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  situation: { color: Colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  situationTeam: { fontWeight: '800' },
  drive: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
});
