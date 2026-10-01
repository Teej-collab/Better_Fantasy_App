import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

// Home-screen widget with this week's matchup. The widget can't fetch
// anything itself (the 'widget' function runs in an isolated runtime
// inside the extension), so the app hands it a fresh snapshot whenever
// it loads /me/week — see lib/homeWidget.ts. Only import this file
// through there: it needs the ExpoWidgets native module, which builds
// from before the widget existed don't have.
export type MatchupWidgetProps = {
  // 'none' = no matchup this week (bye, offseason, signed out); 'pre' =
  // nobody has played, so show projections; 'between' = started, but no
  // game on right now.
  state: 'none' | 'pre' | 'live' | 'between' | 'final';
  week: number | null;
  myName: string;
  oppName: string;
  myScore: number;
  oppScore: number;
  myProjected: number;
  oppProjected: number;
  myLeft: number;
  oppLeft: number;
  winProbability: number | null;
  url: string;
  updatedAt: number;
};

const MatchupWidget = (props: MatchupWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  // Everything has to be declared inside this function: the bundler only
  // keeps its body.
  const bg = '#0d1016';
  const text = '#eceef1';
  const muted = '#8790a0';
  const accent = '#39ff14';
  const live = '#ef4444';
  const small = environment.widgetFamily === 'systemSmall';
  const fullColor = environment.widgetRenderingMode === 'fullColor';

  const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  const updated = new Date(props.updatedAt);
  const hours = updated.getHours();
  const time = `${hours % 12 === 0 ? 12 : hours % 12}:${String(updated.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;

  const header =
    props.state === 'live' ? '● LIVE' : props.state === 'final' ? 'FINAL' : props.week ? `WEEK ${props.week}` : 'WEEKEND LEAGUE';
  const headerColor = props.state === 'live' && fullColor ? live : accent;

  if (props.state === 'none') {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
        <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(accent)]}>WEEKEND LEAGUE</Text>
        <Spacer />
        <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(text)]}>No matchup this week</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>Open the app to refresh</Text>
      </VStack>
    );
  }

  const showScores = props.state !== 'pre';
  const myValue = showScores ? props.myScore : props.myProjected;
  const oppValue = showScores ? props.oppScore : props.oppProjected;
  const myWinning = myValue >= oppValue;

  const row = (name: string, value: number, leading: boolean, left: number) => (
    <HStack spacing={6}>
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[font({ size: small ? 13 : 15, weight: 'semibold' }), foregroundStyle(text), lineLimit(1), minimumScaleFactor(0.7)]}>
          {name}
        </Text>
        {!small && props.state === 'live' ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{`${left} left to play`}</Text>
        ) : null}
      </VStack>
      <Spacer />
      <Text
        modifiers={[
          font({ size: small ? 20 : 24, weight: 'heavy', design: 'rounded' }),
          monospacedDigit(),
          foregroundStyle(leading ? accent : text),
        ]}>
        {fmt(value)}
      </Text>
    </HStack>
  );

  const footer =
    props.state === 'pre'
      ? 'Projected'
      : props.winProbability !== null && !small
        ? `${Math.round(props.winProbability)}% to win · ${time}`
        : `Updated ${time}`;

  return (
    <VStack alignment="leading" spacing={small ? 6 : 8} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
      <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(headerColor)]}>{header}</Text>
      <Spacer />
      {row(props.myName, myValue, showScores && myWinning, props.myLeft)}
      {row(props.oppName, oppValue, showScores && !myWinning, props.oppLeft)}
      <Spacer />
      <Text modifiers={[font({ size: 10 }), foregroundStyle(muted), lineLimit(1)]}>{footer}</Text>
    </VStack>
  );
};

export default createWidget<MatchupWidgetProps>('MatchupWidget', MatchupWidget);
