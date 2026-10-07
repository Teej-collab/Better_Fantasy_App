import { Gauge, HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  aspectRatio,
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  resizable,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

// Your matchup on the Lock Screen and in the Dynamic Island on game day
// (2026-10), with both teams' logos like ESPN's. The backend keeps it
// current with pushes while the phone is locked
// (backend/app/domain/live_activity.py builds these same props — change
// the two together). A touchdown by one of your starters arrives as
// moment 'td' with an alert, which pops the Dynamic Island open on the
// TOUCHDOWN view for a few seconds. Only import this file through
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
  // Logos: saved on the phone as <logoDir>logo-<team id> (lib/widgetAssets.ts).
  myTeamId?: number | null;
  oppTeamId?: number | null;
  myInitials?: string;
  oppInitials?: string;
  logoDir?: string | null;
  // "Puka Nacua TD +8.8" — your latest touchdown, for a couple of hours.
  lastPlay?: string | null;
  // 'td' for ~45 seconds after it, while the alert shows.
  moment?: 'td' | null;
};

const MatchupActivity = (props: MatchupActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  // Everything has to be declared inside this function: the bundler only
  // keeps its body.
  const text = '#eceef1';
  const muted = '#8790a0';
  const accent = environment.isLuminanceReduced ? '#b8ffa8' : '#39ff14';
  const live = '#ef4444';
  const loss = '#f87171';
  const url = `weekendleague://matchup/${props.matchupId}`;

  const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  const pre = props.state === 'pre';
  const final = props.state === 'final';
  const myValue = pre ? props.myProjected : props.myScore;
  const oppValue = pre ? props.oppProjected : props.oppScore;
  const myWinning = myValue >= oppValue;
  const margin = Math.round((myValue - oppValue) * 10) / 10;
  const marginText = `${margin >= 0 ? '+' : ''}${margin.toFixed(1)}`;
  const td = props.moment === 'td';

  const label = props.state === 'live' ? '● LIVE' : final ? 'FINAL' : pre ? 'KICKOFF SOON' : 'BETWEEN GAMES';
  const labelColor = props.state === 'live' ? live : accent;
  const odds = props.winProbability !== null ? `${props.winProbability}% to win` : '';
  const left = final ? '' : `${props.myLeft} left · ${props.oppLeft} left`;
  const footer = environment.isStale ? 'Updating…' : [odds, left].filter((s) => s.length > 0).join('  ·  ');

  // A team's logo, or its initials until the logo is saved on the phone.
  const logo = (teamId: number | null | undefined, initials: string | undefined, size: number, ring: string) => (
    <ZStack modifiers={[frame({ width: size, height: size })]}>
      <Text
        modifiers={[
          font({ size: Math.round(size * 0.38), weight: 'heavy' }),
          foregroundStyle(text),
          frame({ width: size, height: size }),
          background(ring),
          clipShape('circle'),
        ]}>
        {initials ?? '?'}
      </Text>
      {props.logoDir && teamId ? (
        <Image
          uiImage={`${props.logoDir}logo-${teamId}`}
          modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ width: size, height: size }), clipShape('circle')]}
        />
      ) : null}
    </ZStack>
  );
  const myLogo = (size: number) => logo(props.myTeamId, props.myInitials, size, '#13301a');
  const oppLogo = (size: number) => logo(props.oppTeamId, props.oppInitials, size, '#2a1a12');
  const score = (value: number, color: string, size: number) => (
    <Text modifiers={[font({ size, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(color)]}>{fmt(value)}</Text>
  );
  const oddsBar =
    props.winProbability !== null && !final ? (
      <ProgressView value={props.winProbability / 100} modifiers={[tint(myWinning ? accent : loss)]} />
    ) : null;
  const lastPlayRow = props.lastPlay ? (
    <HStack spacing={6}>
      <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(accent)]}>⚡︎</Text>
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(text), lineLimit(1)]}>{props.lastPlay}</Text>
      <Spacer />
    </HStack>
  ) : null;
  const touchdown = (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10}>
        {myLogo(34)}
        <Text modifiers={[font({ size: 28, weight: 'black' }), foregroundStyle(accent)]}>TOUCHDOWN</Text>
        <Spacer />
      </HStack>
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(text), lineLimit(1)]}>{props.lastPlay ?? ''}</Text>
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(muted), lineLimit(1)]}>
        {`${props.myName} ${fmt(props.myScore)} – ${fmt(props.oppScore)} ${props.oppName}`}
      </Text>
    </VStack>
  );

  const side = (mine: boolean, size: number) => (
    <HStack spacing={10}>
      {mine ? myLogo(size) : null}
      <VStack alignment={mine ? 'leading' : 'trailing'} spacing={1}>
        {score(mine ? myValue : oppValue, mine ? (myWinning && !pre ? accent : text) : !myWinning && !pre ? loss : text, size === 36 ? 30 : 28)}
        <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(muted), lineLimit(1), minimumScaleFactor(0.7)]}>
          {mine ? props.myName : props.oppName}
        </Text>
      </VStack>
      {!mine ? oppLogo(size) : null}
    </HStack>
  );

  return {
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 16 }), activityBackgroundTint('#0d1016'), widgetURL(url)]}>
        {td ? (
          touchdown
        ) : (
          <VStack alignment="leading" spacing={10}>
            <HStack>
              <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(labelColor)]}>{label}</Text>
              <Spacer />
              <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(muted)]}>
                {props.week ? `WEEK ${props.week} · THE WEEKEND` : 'THE WEEKEND'}
              </Text>
            </HStack>
            <HStack>
              {side(true, 36)}
              <Spacer />
              <Text
                modifiers={[
                  font({ size: 12, weight: 'bold', design: 'rounded' }),
                  foregroundStyle(myWinning ? accent : loss),
                  padding({ horizontal: 7, vertical: 3 }),
                  background(myWinning ? '#1d3a17' : '#3a1717'),
                  clipShape('capsule'),
                ]}>
                {pre ? 'PROJ' : marginText}
              </Text>
              <Spacer />
              {side(false, 36)}
            </HStack>
            {oddsBar}
            <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{pre ? 'Projected' : footer}</Text>
            {lastPlayRow}
          </VStack>
        )}
      </VStack>
    ),
    // Compact: your logo and score on the left, theirs on the right.
    compactLeading: (
      <HStack spacing={5}>
        {myLogo(20)}
        {score(myValue, myWinning ? accent : text, 14)}
      </HStack>
    ),
    compactTrailing: (
      <HStack spacing={5}>
        {score(oppValue, myWinning ? text : loss, 14)}
        {oppLogo(20)}
      </HStack>
    ),
    // Minimal (another app shares the Island): your logo in a win-% ring.
    minimal: (
      <ZStack>
        <Gauge value={(props.winProbability ?? 50) / 100} modifiers={[gaugeStyle('circularCapacity'), tint(myWinning ? accent : loss)]} />
        {myLogo(14)}
      </ZStack>
    ),
    expandedLeading: td ? (
      myLogo(40)
    ) : (
      <VStack alignment="leading" modifiers={[padding({ leading: 4 })]}>
        {side(true, 40)}
      </VStack>
    ),
    expandedTrailing: td ? (
      <Text modifiers={[font({ size: 22, weight: 'heavy', design: 'rounded' }), foregroundStyle(accent)]}>{marginText}</Text>
    ) : (
      <VStack alignment="trailing" modifiers={[padding({ trailing: 4 })]}>
        {side(false, 40)}
      </VStack>
    ),
    expandedCenter: td ? (
      <Text modifiers={[font({ size: 20, weight: 'black' }), foregroundStyle(accent)]}>TOUCHDOWN</Text>
    ) : (
      <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(labelColor)]}>{label}</Text>
    ),
    expandedBottom: (
      <VStack spacing={6} modifiers={[padding({ horizontal: 4 }), widgetURL(url)]}>
        {td ? (
          <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(text), lineLimit(1)]}>{props.lastPlay ?? ''}</Text>
        ) : (
          oddsBar
        )}
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
          {td ? `${props.myName} ${fmt(props.myScore)} – ${fmt(props.oppScore)}` : pre ? 'Projected' : footer}
        </Text>
        {!td ? lastPlayRow : null}
      </VStack>
    ),
  };
};

export default createLiveActivity<MatchupActivityProps>('MatchupActivity', MatchupActivity);
