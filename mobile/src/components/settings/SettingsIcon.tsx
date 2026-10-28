import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Settings and account-menu icons (2026-10-28): a white line drawing on
// a colored rounded square, the way iPhone Settings does it, instead of
// a letter.

export type SettingsIconName =
  | 'profile'
  | 'notifications'
  | 'look'
  | 'sound'
  | 'chat'
  | 'features'
  | 'account'
  | 'help'
  | 'settings'
  | 'commissioner'
  | 'kitty'
  | 'admin'
  | 'league'
  | 'friends';

// iOS system colors, so the rows read like the phone's own Settings.
export const SETTINGS_ICON_COLORS: Record<SettingsIconName, string> = {
  profile: '#5e5ce6',
  notifications: '#ff3b30',
  look: '#0a84ff',
  sound: '#ff2d55',
  chat: '#30b456',
  features: '#ff9f0a',
  account: '#8e8e93',
  help: '#32ade6',
  settings: '#8e8e93',
  commissioner: '#ff9f0a',
  kitty: '#30b456',
  admin: '#bf5af2',
  league: '#0a84ff',
  friends: '#ff9500',
};

function Glyph({ name }: { name: SettingsIconName }) {
  const p = { stroke: '#ffffff', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (name) {
    case 'profile':
      return (
        <>
          <Circle cx={12} cy={8} r={4} {...p} />
          <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" {...p} />
        </>
      );
    case 'notifications':
      return (
        <>
          <Path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9z" {...p} />
          <Path d="M10 20.5a2.2 2.2 0 0 0 4 0" {...p} />
        </>
      );
    case 'look':
      return (
        <>
          <Path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.3-.9-.3-1.4 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 7.3 17 3 12 3z" {...p} />
          <Circle cx={7.5} cy={11.5} r={1.3} fill="#ffffff" />
          <Circle cx={10.5} cy={7.5} r={1.3} fill="#ffffff" />
          <Circle cx={15} cy={8} r={1.3} fill="#ffffff" />
        </>
      );
    case 'sound':
      return (
        <>
          <Path d="M11 5 6 9H3v6h3l5 4z" {...p} />
          <Path d="M15.5 8.5a5 5 0 0 1 0 7" {...p} />
          <Path d="M18.5 5.5a9 9 0 0 1 0 13" {...p} />
        </>
      );
    case 'chat':
      return <Path d="M20.5 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.4-4.4a8.5 8.5 0 1 1 15.6-4.6z" {...p} />;
    case 'features':
      return (
        <>
          <Rect x={2.5} y={7} width={19} height={10} rx={5} {...p} />
          <Circle cx={16.5} cy={12} r={2.6} fill="#ffffff" />
        </>
      );
    case 'account':
      return (
        <>
          <Rect x={5} y={11} width={14} height={10} rx={2} {...p} />
          <Path d="M8 11V7.5a4 4 0 0 1 8 0V11" {...p} />
        </>
      );
    case 'help':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M9.5 9.2a2.6 2.6 0 1 1 3.7 2.4c-.7.3-1.2 1-1.2 1.8v.3" {...p} />
          <Circle cx={12} cy={17.2} r={1.1} fill="#ffffff" />
        </>
      );
    case 'settings':
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path d="M12 2.5v2.8M12 18.7v2.8M4.6 4.6l2 2M17.4 17.4l2 2M2.5 12h2.8M18.7 12h2.8M4.6 19.4l2-2M17.4 6.6l2-2" {...p} />
        </>
      );
    case 'commissioner':
      return (
        <>
          <Rect x={5.5} y={4.5} width={13} height={16.5} rx={2} {...p} />
          <Path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h3.5" {...p} />
        </>
      );
    case 'kitty':
      return <Path d="M12 3v18M16.3 7.4C15.7 5.9 14.1 5 12 5c-2.5 0-4.3 1.3-4.3 3.1 0 4.3 8.6 2.4 8.6 6.6 0 1.9-1.8 3.2-4.3 3.2-2.3 0-4-1-4.5-2.6" {...p} />;
    case 'admin':
      return <Path d="M4 20v-8M10 20V5M16 20v-6M21.5 20H2.5" {...p} />;
    case 'friends':
      return (
        <>
          <Circle cx={9} cy={8} r={3.5} {...p} />
          <Path d="M2.5 20c.8-3.3 3.4-5.5 6.5-5.5s5.7 2.2 6.5 5.5" {...p} />
          <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c1.8.7 3 2.6 3.5 5.3" {...p} />
        </>
      );
    case 'league':
      return (
        <>
          <Path d="M8 4h8v5a4 4 0 0 1-8 0z" {...p} />
          <Path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z" {...p} />
        </>
      );
  }
}

export function SettingsIcon({ name, size = 30 }: { name: SettingsIconName; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.24, backgroundColor: SETTINGS_ICON_COLORS[name], alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
        <Glyph name={name} />
      </Svg>
    </View>
  );
}
