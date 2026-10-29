import { BlurMask, Canvas, Circle, DashPathEffect, Group, Oval, Path, RadialGradient, Rect, RoundedRect, Skia, useClock, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { SnowLevel, WeatherKind } from '@/components/living/WeatherFx';

// Weather Watch's effects drawn with Skia (build 10 on), so they have the
// mockup's soft light: drops that land on the glass and fade, a lightning
// flash with a glowing bolt and edge, real frost, glowing snow from
// flurries to a blizzard, and wind swirls with a glow. Everything runs
// off one clock per pane. Only required where Skia exists (lib/skia.ts);
// older builds keep the plain versions in WeatherFx.tsx.

type Props = { w: number; h: number; kind: WeatherKind; level: SnowLevel | null; blowing: boolean; poke: number };

export function WeatherFxSkia({ w, h, kind, level, blowing, poke }: Props) {
  const clock = useClock();
  // When the last tap landed, on the same clock.
  const pokedAt = useSharedValue(-1e9);
  useEffect(() => {
    if (poke > 0) pokedAt.set(clock.get());
  }, [poke, clock, pokedAt]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {kind === 'storm' && <Clouds w={w} clock={clock} />}
      {(kind === 'snow' || kind === 'cold') && <Frost w={w} h={h} clock={clock} />}
      {level === 'blizzard' && <Whiteout w={w} h={h} clock={clock} />}
      {kind === 'storm' && <Drops w={w} h={h} clock={clock} count={26} period={1100} tint="rgba(200,190,255,0.5)" />}
      {kind === 'rain' && (
        <>
          <Drops w={w} h={h} clock={clock} count={14} period={1800} tint="rgba(170,215,255,0.45)" />
          <Beads w={w} h={h} clock={clock} />
        </>
      )}
      {level && <Snow w={w} h={h} clock={clock} level={level} />}
      {(blowing || level === 'blizzard') && <Wind w={w} h={h} clock={clock} pokedAt={pokedAt} white={kind === 'snow'} />}
      {kind === 'storm' && <Lightning w={w} h={h} clock={clock} pokedAt={pokedAt} />}
    </Canvas>
  );
}

type Clock = SharedValue<number>;

// ---- Storm ----

function Clouds({ w, clock }: { w: number; clock: Clock }) {
  const transform = useDerivedValue(() => [{ translateX: Math.sin(clock.get() / 1450) * w * 0.03 }]);
  return (
    <Group transform={transform}>
      {[
        [0.2, 0.55],
        [0.6, 0.6],
        [0.92, 0.5],
      ].map(([cx, rx], i) => (
        <Oval key={i} x={w * (cx - rx / 2)} y={-34} width={w * rx} height={74} color="rgba(70,75,110,0.55)">
          <BlurMask blur={18} style="normal" />
        </Oval>
      ))}
    </Group>
  );
}

// The flash's shape over one beat (0–1): flicker, flicker, gone.
function flashAt(p: number) {
  'worklet';
  if (p < 0.58 || p > 0.7) return 0;
  if (p < 0.6) return (p - 0.58) / 0.02;
  if (p < 0.62) return 1 - ((p - 0.6) / 0.02) * 0.9;
  if (p < 0.64) return 0.1 + ((p - 0.62) / 0.02) * 0.75;
  return 0.85 * (1 - (p - 0.64) / 0.06);
}

function Lightning({ w, h, clock, pokedAt }: { w: number; h: number; clock: Clock; pokedAt: SharedValue<number> }) {
  const opacity = useDerivedValue(() => {
    const since = clock.get() - pokedAt.get();
    // A tap strikes right away (the whole beat squeezed into 0.9 s).
    if (since >= 0 && since < 900) return flashAt(0.58 + (since / 900) * 0.14);
    return flashAt(((clock.get() + 1500) % 5500) / 5500);
  });
  const bolt = useMemo(() => {
    const p = Skia.Path.MakeFromSVGString('M24 0 L8 40 L20 40 L10 90 L34 32 L21 32 L30 0 Z')!;
    p.transform(Skia.Matrix().translate(w - 94, -4).scale(0.75, 0.75));
    return p;
  }, [w]);
  return (
    <Group opacity={opacity}>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={vec(w * 0.7, 0)} r={Math.max(w, h) * 0.9} colors={['rgba(225,220,255,0.55)', 'rgba(150,140,255,0.12)', 'rgba(150,140,255,0)']} positions={[0, 0.6, 1]} />
      </Rect>
      <Path path={bolt} color="#8f7bff">
        <BlurMask blur={10} style="normal" />
      </Path>
      <Path path={bolt} color="#f2efff">
        <BlurMask blur={2} style="solid" />
      </Path>
      <RoundedRect x={0.75} y={0.75} width={w - 1.5} height={h - 1.5} r={16} style="stroke" strokeWidth={1.5} color="rgba(190,180,255,0.9)">
        <BlurMask blur={4} style="solid" />
      </RoundedRect>
    </Group>
  );
}

// ---- Rain ----

// Drops hitting the glass: each lands, swells a touch, and fades where it hit.
function Drops({ w, h, clock, count, period, tint }: { w: number; h: number; clock: Clock; count: number; period: number; tint: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Drop key={i} x={(((i * 47 + 9) % 97) / 100) * w} y={(((i * 31 + 5) % 90) / 100) * h} size={1.6 + ((i * 7) % 5) * 0.55} offset={(i * 0.29) % 1} period={period} clock={clock} tint={tint} />
      ))}
    </>
  );
}

function Drop({ x, y, size, offset, period, clock, tint }: { x: number; y: number; size: number; offset: number; period: number; clock: Clock; tint: string }) {
  const p = useDerivedValue(() => (clock.get() / period + offset) % 1);
  const r = useDerivedValue(() => {
    const t = p.get();
    return size * (t < 0.08 ? 0.2 + (t / 0.08) * 0.95 : t < 0.18 ? 1.15 - ((t - 0.08) / 0.1) * 0.15 : 1);
  });
  const opacity = useDerivedValue(() => {
    const t = p.get();
    return t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.92;
  });
  const cy = useDerivedValue(() => y + p.get() * 3);
  const hx = useDerivedValue(() => x - r.get() * 0.3);
  const hy = useDerivedValue(() => cy.get() - r.get() * 0.35);
  const hr = useDerivedValue(() => r.get() * 0.38);
  return (
    <Group opacity={opacity}>
      <Circle cx={x} cy={cy} r={r} color={tint}>
        <BlurMask blur={0.8} style="normal" />
      </Circle>
      <Circle cx={hx} cy={hy} r={hr} color="rgba(255,255,255,0.9)">
        <BlurMask blur={0.6} style="normal" />
      </Circle>
    </Group>
  );
}

// Bigger beads that gather and run down the glass.
function Beads({ w, h, clock }: { w: number; h: number; clock: Clock }) {
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => (
        <Bead key={i} x={((((i * 53 + 17) % 92) + 2) / 100) * w} y={((((i * 29 + 11) % 55) + 6) / 100) * h} offset={(i * 0.37) % 1} period={3200 + (i % 4) * 500} clock={clock} />
      ))}
    </>
  );
}

function Bead({ x, y, offset, period, clock }: { x: number; y: number; offset: number; period: number; clock: Clock }) {
  const p = useDerivedValue(() => (clock.get() / period + offset) % 1);
  const opacity = useDerivedValue(() => {
    const t = p.get();
    return t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
  });
  const cy = useDerivedValue(() => {
    const t = p.get();
    return y + (t < 0.55 ? t * 7 : 4 + ((t - 0.55) / 0.45) ** 2 * 70);
  });
  const hy = useDerivedValue(() => cy.get() - 1.4);
  return (
    <Group opacity={opacity}>
      <Oval x={x - 3} y={cy} width={6} height={8} color="rgba(160,210,255,0.35)">
        <BlurMask blur={0.6} style="normal" />
      </Oval>
      <Circle cx={x - 0.8} cy={hy} r={1.5} color="rgba(255,255,255,0.85)" />
    </Group>
  );
}

// ---- Snow and cold ----

function Frost({ w, h, clock }: { w: number; h: number; clock: Clock }) {
  const opacity = useDerivedValue(() => 0.8 + 0.2 * Math.sin(clock.get() / 1270));
  return (
    <Group opacity={opacity}>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={vec(0, 0)} r={Math.max(w * 0.3, h * 0.6)} colors={['rgba(230,245,255,0.38)', 'rgba(230,245,255,0)']} />
      </Rect>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={vec(w, h)} r={Math.max(w * 0.3, h * 0.6)} colors={['rgba(230,245,255,0.3)', 'rgba(230,245,255,0)']} />
      </Rect>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={vec(w, 0)} r={Math.max(w * 0.2, h * 0.45)} colors={['rgba(230,245,255,0.22)', 'rgba(230,245,255,0)']} />
      </Rect>
    </Group>
  );
}

function Whiteout({ w, h, clock }: { w: number; h: number; clock: Clock }) {
  const opacity = useDerivedValue(() => 0.75 + 0.25 * Math.sin(clock.get() / 510));
  return (
    <Rect x={0} y={0} width={w} height={h} opacity={opacity}>
      <RadialGradient c={vec(w * 0.3, h * 0.5)} r={w * 0.8} colors={['rgba(235,245,255,0.32)', 'rgba(235,245,255,0.05)']} />
    </Rect>
  );
}

const SNOW = {
  flurries: { count: 9, base: 4600, step: 800 },
  snow: { count: 18, base: 3200, step: 600 },
  blizzard: { count: 40, base: 900, step: 250 },
} as const;

function Snow({ w, h, clock, level }: { w: number; h: number; clock: Clock; level: SnowLevel }) {
  const { count, base, step } = SNOW[level];
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Flake
          key={i}
          x={(((i * 37 + 9) % 100) / 100) * w}
          y={(((i * 23) % 100) / 100) * h}
          w={w}
          h={h}
          r={1 + (i % (level === 'blizzard' ? 4 : 3)) * 0.6}
          offset={((i * 0.71) % 4) / 4}
          period={base + (i % 5) * step}
          sideways={level === 'blizzard'}
          opacity={0.55 + (i % 3) * 0.15}
          clock={clock}
        />
      ))}
    </>
  );
}

function Flake(props: { x: number; y: number; w: number; h: number; r: number; offset: number; period: number; sideways: boolean; opacity: number; clock: Clock }) {
  const { x, y, w, h, r, offset, period, sideways, opacity, clock } = props;
  const p = useDerivedValue(() => (clock.get() / period + offset) % 1);
  // Falling with a little drift, or in a blizzard driven sideways across the pane.
  const cx = useDerivedValue(() => (sideways ? -10 + ((x / w + p.get()) % 1) * (w + 20) : x + p.get() * 14 + Math.sin(p.get() * 6.28) * 3));
  const cy = useDerivedValue(() => (sideways ? (y + p.get() * h * 0.6) % (h + 10) : -6 + p.get() * (h + 12)));
  return (
    <Circle cx={cx} cy={cy} r={r} color="#ffffff" opacity={opacity}>
      <BlurMask blur={1.2} style="solid" />
    </Circle>
  );
}

// ---- Wind ----

const SWIRLS = [
  'M-20 34 C60 18 120 46 190 30 S300 12 330 26 C350 36 335 52 318 46',
  'M-20 74 C70 62 140 88 230 70 S340 58 420 70',
  'M-20 100 C80 92 150 108 210 98 C250 92 265 78 250 72 C238 68 228 76 238 82',
];

function Wind({ w, h, clock, pokedAt, white }: { w: number; h: number; clock: Clock; pokedAt: SharedValue<number>; white: boolean }) {
  const paths = useMemo(
    () =>
      SWIRLS.map((d) => {
        const p = Skia.Path.MakeFromSVGString(d)!;
        p.transform(Skia.Matrix().scale(w / 390, h / 120));
        return p;
      }),
    [w, h],
  );
  return (
    <>
      {paths.map((p, i) => (
        <Swirl key={i} path={p} delay={i * 870} clock={clock} pokedAt={pokedAt} color={white ? 'rgba(240,250,255,' : 'rgba(140,255,230,'} />
      ))}
    </>
  );
}

function Swirl({ path, delay, clock, pokedAt, color }: { path: ReturnType<typeof Skia.Path.Make>; delay: number; clock: Clock; pokedAt: SharedValue<number>; color: string }) {
  // A tap: three quick gusts, brighter and thicker, then back to the breeze.
  const gust = useDerivedValue(() => {
    const since = clock.get() - pokedAt.get() - delay / 3.5;
    return since >= 0 && since < 2100 ? 1 : 0;
  });
  const phase = useDerivedValue(() => {
    const since = clock.get() - pokedAt.get() - delay / 3.5;
    const p = gust.get() ? (since % 700) / 700 : ((clock.get() - delay + 1e6) % 2600) / 2600;
    // Ease the travel like the mockup's cubic-bezier(.4,0,.3,1).
    const e = gust.get() ? p : 1 - (1 - p) ** 2.2;
    return 460 * (1 - e);
  });
  const width = useDerivedValue(() => 2 + gust.get());
  const glow = useDerivedValue(() => 0.3 + 0.25 * gust.get());
  return (
    <>
      <Path path={path} style="stroke" strokeWidth={6} strokeCap="round" color={`${color}1)`} opacity={glow}>
        <DashPathEffect intervals={[60, 400]} phase={phase} />
        <BlurMask blur={5} style="normal" />
      </Path>
      <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" color={`${color}0.75)`}>
        <DashPathEffect intervals={[60, 400]} phase={phase} />
      </Path>
    </>
  );
}
