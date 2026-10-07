import { Gauge, HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  background,
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  resizable,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

// Your matchup as a widget (2026-10), every size:
// - Home Screen small: win-% ring (live), the result (final), or next week's odds.
// - Home Screen medium: both teams with logos, scores, win bar.
// - Home Screen large: that, plus your players on the field right now and who's next.
// - Lock Screen rectangle, circle (win-% gauge) and the one-liner above the clock.
// The widget can't fetch anything itself (the 'widget' function runs in an
// isolated runtime inside the extension), so the app hands it a snapshot
// whenever it loads your week — see lib/homeWidget.ts — and a silent push
// wakes the app to do that on game day. Only import this file through
// there: it needs the ExpoWidgets native module.
export type WidgetPlayer = { pos: string; name: string; pts: number; detail: string };

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
  // Logos: saved on the phone as <logoDir>logo-<team id> (lib/widgetAssets.ts).
  myTeamId?: number | null;
  oppTeamId?: number | null;
  myInitials?: string;
  oppInitials?: string;
  logoDir?: string | null;
  // Large size: your starters whose games are on right now, and who plays next.
  playing?: WidgetPlayer[];
  nextUp?: { name: string; detail: string; projected: number } | null;
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
  const loss = '#f87171';
  const family = environment.widgetFamily;
  const fullColor = environment.widgetRenderingMode === 'fullColor';

  const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  const updated = new Date(props.updatedAt);
  const hours = updated.getHours();
  const time = `${hours % 12 === 0 ? 12 : hours % 12}:${String(updated.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
  const pre = props.state === 'pre';
  const myValue = pre ? props.myProjected : props.myScore;
  const oppValue = pre ? props.oppProjected : props.oppScore;
  const myWinning = myValue >= oppValue;
  const margin = Math.round((myValue - oppValue) * 10) / 10;
  const odds = props.winProbability !== null ? Math.round(props.winProbability) : null;
  const header =
    props.state === 'live' ? '● LIVE' : props.state === 'final' ? 'FINAL' : props.week ? `WEEK ${props.week}` : 'THE WEEKEND';
  const headerColor = props.state === 'live' && fullColor ? live : accent;
  const shortName = (name: string) => (name.length > 11 ? name.split(' ')[0] : name);

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

  // ---- Lock Screen ----
  if (family === 'accessoryInline') {
    if (props.state === 'none') return <Text>The Weekend</Text>;
    return (
      <Text>
        {pre
          ? `Wk ${props.week ?? ''} · ${odds ?? '–'}% to win`
          : `${fmt(props.myScore)}–${fmt(props.oppScore)}${odds !== null && props.state !== 'final' ? ` · ${odds}%` : ''}`}
      </Text>
    );
  }
  if (family === 'accessoryCircular') {
    if (props.state === 'final') {
      return (
        <VStack spacing={0} modifiers={[widgetURL(props.url)]}>
          <Text modifiers={[font({ size: 20, weight: 'heavy', design: 'rounded' })]}>{myWinning ? 'W' : 'L'}</Text>
          <Text modifiers={[font({ size: 10, weight: 'semibold' }), monospacedDigit()]}>{fmt(Math.abs(margin))}</Text>
        </VStack>
      );
    }
    return (
      <Gauge value={(odds ?? 50) / 100} modifiers={[gaugeStyle('circular'), widgetURL(props.url)]} currentValueLabel={<Text modifiers={[font({ size: 16, weight: 'heavy', design: 'rounded' })]}>{odds !== null ? String(odds) : '–'}</Text>}>
        <Text modifiers={[font({ size: 9, weight: 'bold' })]}>WIN%</Text>
      </Gauge>
    );
  }
  if (family === 'accessoryRectangular') {
    if (props.state === 'none') {
      return (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13, weight: 'bold' })]}>THE WEEKEND</Text>
          <Text modifiers={[font({ size: 12 })]}>No matchup this week</Text>
        </VStack>
      );
    }
    const row = (name: string, value: number, dim: boolean) => (
      <HStack spacing={4}>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1), foregroundStyle(dim ? muted : text)]}>{shortName(name)}</Text>
        <Spacer />
        <Text modifiers={[font({ size: 17, weight: 'heavy', design: 'rounded' }), monospacedDigit()]}>{fmt(value)}</Text>
      </HStack>
    );
    return (
      <VStack alignment="leading" spacing={1} modifiers={[widgetURL(props.url)]}>
        <HStack>
          <Text modifiers={[font({ size: 11, weight: 'bold' })]}>{props.state === 'live' ? `● LIVE · WK ${props.week ?? ''}` : header}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 11, weight: 'semibold' })]}>{props.state === 'live' ? `${props.myLeft} left` : pre ? 'Proj' : ''}</Text>
        </HStack>
        {row(props.myName, myValue, false)}
        {row(props.oppName, oppValue, true)}
      </VStack>
    );
  }

  // ---- Home Screen ----
  if (props.state === 'none') {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
        <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(accent)]}>THE WEEKEND</Text>
        <Spacer />
        <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(text)]}>No matchup this week</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>Open the app to refresh</Text>
      </VStack>
    );
  }

  const oddsBar =
    odds !== null && props.state !== 'final' ? <ProgressView value={odds / 100} modifiers={[tint(myWinning ? accent : loss)]} /> : null;
  const footer =
    props.state === 'final'
      ? `Final · ${myWinning ? 'won' : 'lost'} by ${fmt(Math.abs(margin))}`
      : pre
        ? `Projected · ${odds !== null ? `${odds}% to win` : `updated ${time}`}`
        : `${odds !== null ? `${odds}% to win · ` : ''}${props.myLeft} left · ${props.oppLeft} left`;

  if (family === 'systemSmall') {
    if (props.state === 'live' || props.state === 'between') {
      return (
        <VStack spacing={6} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
          <HStack>
            <Text modifiers={[font({ size: 10, weight: 'heavy' }), foregroundStyle(headerColor)]}>{header}</Text>
            <Spacer />
            {logo(props.myTeamId, props.myInitials, 20, '#13301a')}
          </HStack>
          <Gauge
            value={(odds ?? 50) / 100}
            modifiers={[gaugeStyle('circularCapacity'), tint(myWinning ? accent : loss), frame({ width: 78, height: 78 })]}
            currentValueLabel={<Text modifiers={[font({ size: 20, weight: 'heavy', design: 'rounded' }), foregroundStyle(text)]}>{odds !== null ? `${odds}%` : '–'}</Text>}
          />
          <Text modifiers={[font({ size: 12, weight: 'bold', design: 'rounded' }), monospacedDigit(), foregroundStyle(myWinning ? accent : loss)]}>
            {`${margin >= 0 ? '+' : ''}${fmt(margin)} ${myWinning ? 'lead' : 'behind'}`}
          </Text>
        </VStack>
      );
    }
    return (
      <VStack alignment="leading" spacing={4} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
        <Text modifiers={[font({ size: 10, weight: 'heavy' }), foregroundStyle(headerColor)]}>{header}</Text>
        <Spacer />
        {props.state === 'final' ? (
          <Text modifiers={[font({ size: 30, weight: 'heavy' }), foregroundStyle(myWinning ? accent : loss)]}>{myWinning ? 'WIN' : 'LOSS'}</Text>
        ) : (
          logo(props.oppTeamId, props.oppInitials, 30, '#2a1a12')
        )}
        <Text modifiers={[font({ size: 15, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(text)]}>{`${fmt(myValue)} – ${fmt(oppValue)}`}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{pre ? `vs ${props.oppName}` : `vs ${props.oppName}`}</Text>
        {pre && odds !== null ? (
          <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(accent)]}>{`${odds}% to win`}</Text>
        ) : null}
      </VStack>
    );
  }

  const teamRow = (teamId: number | null | undefined, initials: string | undefined, ring: string, name: string, value: number, leading: boolean, size: number) => (
    <HStack spacing={10}>
      {logo(teamId, initials, size === 30 ? 30 : 26, ring)}
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(text), lineLimit(1), minimumScaleFactor(0.7)]}>{name}</Text>
      <Spacer />
      <Text modifiers={[font({ size, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(leading && !pre ? accent : text)]}>
        {fmt(value)}
      </Text>
    </HStack>
  );

  const scoreboard = (size: number) => (
    <VStack alignment="leading" spacing={8}>
      <HStack>
        <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(headerColor)]}>{props.state === 'live' ? `● LIVE · WEEK ${props.week ?? ''}` : header}</Text>
        <Spacer />
        <Text modifiers={[font({ size: 11, weight: 'heavy' }), foregroundStyle(accent)]}>THE WEEKEND</Text>
      </HStack>
      {teamRow(props.myTeamId, props.myInitials, '#13301a', props.myName, myValue, myWinning, size)}
      {teamRow(props.oppTeamId, props.oppInitials, '#2a1a12', props.oppName, oppValue, !myWinning, size)}
      {oddsBar}
      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{footer}</Text>
    </VStack>
  );

  if (family === 'systemLarge') {
    const playing = props.playing ?? [];
    return (
      <VStack alignment="leading" spacing={10} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
        {scoreboard(30)}
        <Spacer />
        <Text modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(muted)]}>{playing.length ? 'ON THE FIELD NOW' : 'YOUR STARTERS'}</Text>
        {playing.length ? (
          playing.slice(0, 3).map((p) => (
            <HStack key={`${p.pos}-${p.name}`} spacing={8}>
              <Text modifiers={[font({ size: 10, weight: 'heavy' }), foregroundStyle(accent), frame({ width: 26, alignment: 'leading' })]}>{p.pos}</Text>
              <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(text), lineLimit(1)]}>{p.name}</Text>
              <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{p.detail}</Text>
              <Spacer />
              <Text modifiers={[font({ size: 14, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(text)]}>{fmt(p.pts)}</Text>
            </HStack>
          ))
        ) : (
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{props.state === 'final' ? 'All games are final.' : 'Nobody on the field right now.'}</Text>
        )}
        {props.nextUp ? (
          <HStack spacing={8}>
            <Text modifiers={[font({ size: 10, weight: 'heavy' }), foregroundStyle(muted), frame({ width: 26, alignment: 'leading' })]}>NEXT</Text>
            <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(text), lineLimit(1)]}>{props.nextUp.name}</Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{props.nextUp.detail}</Text>
            <Spacer />
            <Text modifiers={[font({ size: 12, weight: 'bold', design: 'rounded' }), foregroundStyle(muted)]}>{`${fmt(props.nextUp.projected)} proj`}</Text>
          </HStack>
        ) : null}
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
      {scoreboard(24)}
    </VStack>
  );
};

export default createWidget<MatchupWidgetProps>('MatchupWidget', MatchupWidget);
