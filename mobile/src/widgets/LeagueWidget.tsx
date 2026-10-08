import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, lineLimit, minimumScaleFactor, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

// The league between games (2026-10):
// - small: your place in the standings, power rank, and a live countdown
//   to the Wednesday waiver run;
// - medium: last week's awards — top score, bench crime, biggest upset.
// Like MatchupWidget, it shows a snapshot the app hands it (lib/homeWidget.ts).
export type LeagueWidgetProps = {
  leagueName: string | null;
  standing: number | null;
  standingDelta: number | null;
  record: string | null;
  pointsFor: number | null;
  powerRank: number | null;
  // Epoch ms of the next waiver run; null when there isn't one coming.
  waiversAt: number | null;
  awardsWeek: number | null;
  // Up to three of last week's awards (overachiever, bench crime, top player…).
  awards: { label: string; who: string; value: string; tone: 'good' | 'bad' | 'fun' }[];
  url: string;
};

const LeagueWidget = (props: LeagueWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const bg = '#0d1016';
  const text = '#eceef1';
  const muted = '#8790a0';
  const accent = '#39ff14';
  const gold = '#facc15';
  const purple = '#c084fc';
  const loss = '#f87171';
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };

  if (environment.widgetFamily === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
        <Text modifiers={[font({ size: 10, weight: 'heavy' }), foregroundStyle(muted)]}>STANDINGS</Text>
        <HStack spacing={6}>
          <Text modifiers={[font({ size: 38, weight: 'heavy', design: 'rounded' }), foregroundStyle(accent)]}>
            {props.standing ? ordinal(props.standing) : '–'}
          </Text>
          <Spacer />
          {props.standingDelta ? (
            <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(props.standingDelta > 0 ? accent : loss)]}>
              {props.standingDelta > 0 ? `▲ ${props.standingDelta}` : `▼ ${-props.standingDelta}`}
            </Text>
          ) : null}
        </HStack>
        <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(text), lineLimit(1)]}>
          {[props.record, props.powerRank ? `Power #${props.powerRank}` : null].filter(Boolean).join(' · ')}
        </Text>
        <Spacer />
        {props.waiversAt && props.waiversAt > Date.now() ? (
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[font({ size: 9, weight: 'heavy' }), foregroundStyle(gold)]}>WAIVERS RUN IN</Text>
            <Text date={new Date(props.waiversAt)} dateStyle="timer" modifiers={[font({ size: 18, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle(text)]} />
          </VStack>
        ) : (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>{props.leagueName ?? 'The Weekend'}</Text>
        )}
      </VStack>
    );
  }

  const award = (item: { label: string; who: string; value: string; tone: 'good' | 'bad' | 'fun' }) => (
    <VStack key={item.label} alignment="leading" spacing={3}>
      <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle(muted)]}>{item.label}</Text>
      <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(text), lineLimit(2), minimumScaleFactor(0.8)]}>{item.who}</Text>
      <Text modifiers={[font({ size: 15, weight: 'heavy', design: 'rounded' }), foregroundStyle(item.tone === 'good' ? accent : item.tone === 'bad' ? loss : purple), lineLimit(1)]}>
        {item.value}
      </Text>
    </VStack>
  );

  return (
    <VStack alignment="leading" spacing={10} modifiers={[containerBackground(bg, 'widget'), widgetURL(props.url)]}>
      <HStack>
        <Text modifiers={[font({ size: 10, weight: 'heavy' }), foregroundStyle(purple)]}>
          {props.awardsWeek ? `WEEK ${props.awardsWeek} AWARDS` : 'WEEKLY AWARDS'}
        </Text>
        <Spacer />
        <Text modifiers={[font({ size: 10, weight: 'heavy' }), foregroundStyle(accent)]}>THE WEEKEND</Text>
      </HStack>
      {props.awards?.length ? (
        <HStack alignment="top" spacing={14}>
          {props.awards.slice(0, 3).map(award)}
        </HStack>
      ) : (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(muted)]}>Awards post after the week is final.</Text>
      )}
      <Spacer />
      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>Tap for the full recap</Text>
    </VStack>
  );
};

export default createWidget<LeagueWidgetProps>('LeagueWidget', LeagueWidget);
