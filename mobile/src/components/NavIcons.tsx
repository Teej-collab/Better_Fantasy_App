import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { GlowIcon } from '@/components/fx/Glow';

// The tab bar's own drawings (2026-10-21, from the tab bar mockups):
// "Neon line" outlines for the four tabs, which glow in the accent color
// when selected, and "Playbook" drawings for the six engines, each drawn
// from football. 24×24 strokes, like the SF Symbols they replace.

type IconProps = { color: string; size?: number };

function Line({ color, size = 24, width, children }: IconProps & { width: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

// ---- Neon line: the tabs ----

export type TabIconName = 'index' | 'team' | 'chat' | 'league';

const TAB_PATHS: Record<TabIconName, React.ReactNode> = {
  index: <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  team: (
    <>
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <Circle cx={17} cy={9} r={2.5} />
      <Path d="M16 14.2c3 .3 5.5 2.4 5.5 5.8" />
    </>
  ),
  chat: <Path d="M4 5h16v11H9l-5 4z" />,
  league: (
    <>
      <Path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <Path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 21h8" />
    </>
  ),
};

// The same drawings as SVG path strings, for the glow (circles as two arcs).
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const TAB_D: Record<TabIconName, string[]> = {
  index: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  team: [circle(9, 8, 3.5), 'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6', circle(17, 9, 2.5), 'M16 14.2c3 .3 5.5 2.4 5.5 5.8'],
  chat: ['M4 5h16v11H9l-5 4z'],
  league: ['M7 4h10v5a5 5 0 0 1-10 0z', 'M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 21h8'],
};

// The selected tab glows like a neon tube (GlowIcon: real light on
// build 10 on, an iOS shadow before).
export function TabIcon({ name, color, focused, size = 23 }: IconProps & { name: TabIconName; focused: boolean }) {
  const drawing = (
    <Line color={color} size={size} width={1.7}>
      {TAB_PATHS[name]}
    </Line>
  );
  if (!focused) return drawing;
  return <GlowIcon paths={TAB_D[name]} color={color} size={size} width={1.7} fallback={drawing} />;
}

// ---- Playbook: the engines ----

export type EngineIconName = 'matchup' | 'whatif' | 'lounge' | 'gamecast' | 'bets' | 'chug';

export function EngineIcon({ name, color, size = 28 }: IconProps & { name: EngineIconName }) {
  switch (name) {
    // X vs O.
    case 'matchup':
      return (
        <Line color={color} size={size} width={2}>
          <Path d="M3 8l6 6M9 8l-6 6" />
          <Circle cx={17.5} cy={11} r={3.5} />
        </Line>
      );
    // A play that branches: the route run, and the dashed option.
    case 'whatif':
      return (
        <Line color={color} size={size} width={2}>
          <Circle cx={5.5} cy={18.5} r={2.5} />
          <Path d="M7.5 16.5C10 11 13 8 19 6M16 4.5l3 1.5-1.5 3" />
          <Path d="M8 18.5c4 0 8-1 12-3" strokeDasharray="2 2.5" />
        </Line>
      );
    // The couch under the TV.
    case 'lounge':
      return (
        <Line color={color} size={size} width={2}>
          <Rect x={6} y={2.5} width={12} height={8} rx={1} />
          <Path d="M3 15a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4.5H3z" />
        </Line>
      );
    // The field and its yard lines.
    case 'gamecast':
      return (
        <Line color={color} size={size} width={2}>
          <Rect x={2} y={6} width={20} height={12} rx={1.5} />
          <Path d="M7 6v12M12 6v12M17 6v12" strokeDasharray="1.5 2" />
        </Line>
      );
    // A poker chip.
    case 'bets':
      return (
        <Line color={color} size={size} width={2}>
          <Circle cx={12} cy={12} r={9} />
          <Circle cx={12} cy={12} r={4.5} />
          <Path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21" />
        </Line>
      );
    // The can.
    case 'chug':
      return (
        <Line color={color} size={size} width={2}>
          <Path d="M7 6.5C7 5 8 4 9.5 4h5C16 4 17 5 17 6.5V19c0 1.1-.9 2-2 2H9c-1.1 0-2-.9-2-2z" />
          <Path d="M7 8h10M11 4V2.5h3M10 12v4M14 12v4" />
        </Line>
      );
  }
}
