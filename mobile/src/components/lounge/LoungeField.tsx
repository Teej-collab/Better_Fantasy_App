import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Ellipse, Line, Path, Polygon } from 'react-native-svg';

import { playPath } from '@/lib/fieldGeometry';
import { lastSnap } from '@/lib/gamecast';
import { nflTeamColor } from '@/lib/nflTeams';
import type { LiveGame } from '@/lib/types';

// The thin field strip under the TV (mockup 1): the offense drives right,
// end zones in team colors, the line of scrimmage, the yellow first-down
// line, and the last play's path ending on the ball — all at the room's
// delay, same as the TV.
const W = 370;
const H = 46;
const TOP = 6;
const BOTTOM = 40;

function x(u: number, v: number) {
  const left = 22 + (2 - 22) * v;
  const right = 348 + (368 - 348) * v;
  return left + ((u + 10) / 120) * (right - left);
}
function y(v: number, h = 0) {
  return TOP + (BOTTOM - TOP) * v - h * 0.6;
}

export function LoungeField({ game }: { game: LiveGame | null }) {
  const offense = game?.possession_team_abbr ?? null;
  const defense = offense === game?.home_team.abbr ? game?.away_team.abbr : offense === game?.away_team.abbr ? game?.home_team.abbr : null;
  const hasBall = !!game && game.status === 'in_progress' && game.yards_to_goal !== null && !!offense;
  const ballU = hasBall ? 100 - (game!.yards_to_goal ?? 50) : null;
  const goal = hasBall && game!.distance !== null && game!.distance >= (game!.yards_to_goal ?? 0);
  const firstU = hasBall && game!.distance !== null && !goal ? 100 - Math.max(0, (game!.yards_to_goal ?? 0) - game!.distance) : null;

  const trail = useMemo(() => {
    if (!hasBall || !game) return null;
    const snap = lastSnap(game);
    const path = snap ? playPath(snap, offense) : null;
    if (!path) return null;
    return path.samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.u, s.v).toFixed(1)},${y(s.v, s.h).toFixed(1)}`).join('');
  }, [game, hasBall, offense]);

  const band = (u0: number, u1: number) => `${x(u0, 0)},${TOP} ${x(u1, 0)},${TOP} ${x(u1, 1)},${BOTTOM} ${x(u0, 1)},${BOTTOM}`;
  const label = hasBall ? `Field: ${offense} ball${game!.field_position_label ? ` at ${game!.field_position_label}` : ''}` : 'Field';

  return (
    <View style={{ marginHorizontal: 10, marginTop: 8, height: H }} accessible accessibilityLabel={label}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Polygon points={band(-10, 110)} fill="#23262c" />
        <Polygon points={band(-10, 0)} fill={hasBall ? (nflTeamColor(offense) ?? '#333') : '#2b2d31'} />
        <Polygon points={band(100, 110)} fill={hasBall ? (nflTeamColor(defense ?? null) ?? '#3a3d42') : '#2b2d31'} />
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((u) => (
          <Line key={u} x1={x(u, 0)} y1={TOP} x2={x(u, 1)} y2={BOTTOM} stroke="#fff" strokeOpacity={u === 50 ? 0.28 : 0.14} strokeWidth={1} />
        ))}
        {firstU !== null && <Line x1={x(firstU, 0)} y1={TOP} x2={x(firstU, 1)} y2={BOTTOM} stroke="#facc15" strokeWidth={2.5} />}
        {ballU !== null && <Line x1={x(ballU, 0)} y1={TOP} x2={x(ballU, 1)} y2={BOTTOM} stroke="#60a5fa" strokeWidth={2} />}
        {trail && <Path d={trail} stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" />}
        {ballU !== null && <Ellipse cx={x(ballU, 0.5)} cy={y(0.5)} rx={5} ry={3.4} fill="#8b4513" stroke="#fff" strokeWidth={1} />}
      </Svg>
    </View>
  );
}
