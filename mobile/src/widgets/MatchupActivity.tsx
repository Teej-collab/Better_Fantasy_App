import { HStack, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

// Your matchup on the Lock Screen and in the Dynamic Island on game day
// (2026-10). The backend keeps it current with pushes while the phone is
// locked (backend/app/domain/live_activity.py builds these same props —
// change the two together). Only import this file through
// lib/liveActivity.ts: it needs the ExpoWidgets native module.
export type MatchupActivityProps = {
  state: 'pre' | 'live' | 'between' | 'final';
  week: number | null;
  myName: string;
  oppName: string;
  myScore: number;
  oppScore: number;
  myProjected: number;
  oppProjected: number;
  myLeft: number;
  oppLeft: number;
  // 0–100, or null before there's an estimate.
  winProbability: number | null;
  matchupId: number;
  updatedAt: number;
};

const MatchupActivity = (props: MatchupActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  // Everything has to be declared inside this function: the bundler only
  // keeps its body.
  const text = '#eceef1';
  const muted = '#8790a0';
  const accent = environment.isLuminanceReduced ? '#b8ffa8' : '#39ff14';
  const live = '#ef4444';
  const url = `weekendleague://matchup/${props.matchupId}`;

  const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  const pre = props.state === 'pre';
  const myValue = pre ? props.myProjected : props.myScore;
  const oppValue = pre ? props.oppProjected : props.oppScore;
  const myWinning = myValue >= oppValue;
  const diff = Math.round((myValue - oppValue) * 10) / 10;
  const diffText = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);

  const label =
    props.state === 'live'
      ? '● LIVE'
      : props.state === 'final'
        ? 'FINAL'
        : pre
          ? 'KICKOFF SOON'
          : 'BETWEEN GAMES';
  const labelColor = props.state === 'live' ? live : accent;
  const odds = props.winProbability !== null ? `${props.winProbability}% to win` : '';
  const left = props.state === 'final' ? '' : `${props.myLeft} left · ${props.oppLeft} left`;
  const footer = environment.isStale ? 'Updating…' : [odds, left].filter((s) => s.length > 0).join('  ·  ');

  const teamRow = (name: string, value: number, leading: boolean, size: number) => (
    <HStack spacing={8}>
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(text), lineLimit(1), minimumScaleFactor(0.7)]}>
        {name}
      </Text>
      <Spacer />
      <Text
        modifiers={[
          font({ size, weight: 'heavy', design: 'rounded' }),
          monospacedDigit(),
          foregroundStyle(leading && !pre ? accent : text),
        ]}>
        {fmt(value)}
      </Text>
    </HStack>
  );

  const oddsBar =
    props.winProbability !== null && props.state !== 'final' ? (
      <ProgressView value={props.winProbability / 100} modifiers={[tint(accent)]} />
    ) : null;

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 16 }), activityBackgroundTint('#0d1016'), widgetURL(url)]}>
        <HStack>
          <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(labelColor)]}>{label}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(muted)]}>
            {props.week ? `WEEK ${props.week} · THE WEEKEND` : 'THE WEEKEND'}
          </Text>
        </HStack>
        {teamRow(props.myName, myValue, myWinning, 26)}
        {teamRow(props.oppName, oppValue, !myWinning, 26)}
        {oddsBar}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{pre ? 'Projected' : footer}</Text>
      </VStack>
    ),
    compactLeading: (
      <Text modifiers={[font({ size: 14, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(myWinning ? accent : text)]}>
        {fmt(myValue)}
      </Text>
    ),
    compactTrailing: (
      <Text modifiers={[font({ size: 14, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(myWinning ? text : live)]}>
        {fmt(oppValue)}
      </Text>
    ),
    minimal: (
      <Text modifiers={[font({ size: 12, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(diff >= 0 ? accent : live)]}>
        {diffText}
      </Text>
    ),
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 4 })]}>
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(muted), lineLimit(1)]}>{props.myName}</Text>
        <Text modifiers={[font({ size: 28, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(myWinning ? accent : text)]}>
          {fmt(myValue)}
        </Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 4 })]}>
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(muted), lineLimit(1)]}>{props.oppName}</Text>
        <Text modifiers={[font({ size: 28, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(myWinning ? text : live)]}>
          {fmt(oppValue)}
        </Text>
      </VStack>
    ),
    expandedCenter: (
      <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(labelColor)]}>{label}</Text>
    ),
    expandedBottom: (
      <VStack spacing={6} modifiers={[padding({ horizontal: 4 }), widgetURL(url)]}>
        {oddsBar}
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>{pre ? 'Projected' : footer}</Text>
      </VStack>
    ),
  };
};

export default createLiveActivity<MatchupActivityProps>('MatchupActivity', MatchupActivity);
