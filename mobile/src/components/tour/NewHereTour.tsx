import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { TourHoneycomb } from '@/components/tour/TourHoneycomb';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { DEFAULT_CHUG_RULE_NAME, useHouseRules, useMe } from '@/lib/queries';
import { markTourSeen, tour, tourSeen, tourSlides, useTour, type TourSlide } from '@/lib/tour';

// The New Here tour (2026-10-28, the approved "New Here Popup" mockup):
// a sheet of slides over the app, each with a small preview, what the
// feature does, where it lives and a "Show me" that takes you there.
// Opens by itself once per phone, the first time someone with a league
// opens the app (after the intro), and again from the Glossary.

const AMBER = '#f59e0b';
const MUTED = '#8790a0';
const SOFT = '#aeb5c1';
const LINE = '#2a303a';
const TILE = '#0d1016';

function Chip({ children }: { children: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

function Tile({ children, on }: { children: React.ReactNode; on?: boolean }) {
  return <View style={[styles.tile, on && styles.tileOn]}>{children}</View>;
}

function Label({ children, color = MUTED }: { children: string; color?: string }) {
  return <Text style={[styles.label, { color }]}>{children}</Text>;
}

// The picture at the top of each slide: a small, true-to-life piece of
// the feature it describes.
function Preview({ slide, ruleName }: { slide: TourSlide; ruleName: string }) {
  switch (slide.key) {
    case 'welcome':
      return (
        <View style={styles.center}>
          <View style={styles.emblem}>
            <Text style={styles.emblemThe}>THE</Text>
            <Text style={styles.emblemWord}>WEEKEND</Text>
          </View>
          <View style={styles.row}>
            <Chip>From ESPN</Chip>
            <Chip>From Sleeper</Chip>
            <Chip>Or start fresh</Chip>
          </View>
        </View>
      );
    case 'living':
      return (
        <View style={styles.grid}>
          {[
            ['MON', 'Monday-night sweat', 'What you need to win', false],
            ['TUE · TODAY', 'Recap day', 'The recap at 2 PM', true],
            ['WED', 'Waivers clear', 'Who got who', false],
            ['THU–SUN', 'Game-day board', 'Lineup fixes, live scores', false],
          ].map(([day, title, sub, on]) => (
            <Tile key={day as string} on={on as boolean}>
              <Label color={on ? Colors.accent : MUTED}>{day as string}</Label>
              <Text style={styles.tileTitle}>{title as string}</Text>
              <Text style={styles.tileSub}>{sub as string}</Text>
            </Tile>
          ))}
        </View>
      );
    case 'tickers':
      return (
        <View style={styles.stack}>
          <View style={styles.ticker}>
            <Text style={styles.tickerTag}>NFL</Text>
            <Text style={styles.tickerText} numberOfLines={1}>SF 20 — ATL 29 Final  •  PIT 16 — NO 10</Text>
          </View>
          <View style={styles.ticker}>
            <Text style={[styles.tickerTag, { color: Colors.accent }]}>LEAGUE</Text>
            <Text style={styles.tickerText} numberOfLines={1}>Ryan 112.4 — Jeff 87.0  •  Clay 101.2 — Ian 99.8</Text>
          </View>
          <View style={styles.lock}>
            <View style={{ flexShrink: 1 }}>
              <Label>LOCK SCREEN · LIVE</Label>
              <Text style={styles.lockScore} numberOfLines={1}>You 104.2 – 97.5 Ian</Text>
            </View>
            <Text style={[styles.big, { color: Colors.accent }]}>68%</Text>
          </View>
        </View>
      );
    case 'gamecast':
      return (
        <View style={styles.stack}>
          <View style={styles.field}>
            {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={styles.yardLine} />)}
            <View style={styles.ball} />
          </View>
          <View style={styles.row}>
            <View style={styles.badge}><Text style={styles.badgeText}>TURNING POINT</Text></View>
            <Text style={styles.small}>Kelce 24-yd TD · +6.0 · <Text style={{ color: Colors.accent, fontWeight: '700' }}>+17%</Text></Text>
          </View>
        </View>
      );
    case 'writeups':
      return (
        <View style={styles.stack}>
          <Label color={Colors.accent}>WEEK 8 RECAP · LIVE NOW</Label>
          <Text style={styles.quote}>“Jeff started a kicker on a bye and somehow blamed the refs. Ian dropped Puka in Week 3, and Puka just put 31 on him.”</Text>
          <View style={[styles.badge, { backgroundColor: Colors.text, alignSelf: 'flex-start' }]}><Text style={styles.badgeText}>GREAT WHITE BUFFALO WATCH</Text></View>
        </View>
      );
    case 'whatif':
      return (
        <View style={styles.stack}>
          <View style={styles.between}>
            <Label>PLAYOFF ODDS · 10,000 SEASONS</Label>
            <Text style={[styles.big, { color: Colors.accent }]}>64%</Text>
          </View>
          <View style={styles.grid}>
            <Tile><Text style={styles.tileSub}>If you win</Text><Text style={[styles.mid, { color: Colors.accent }]}>81%</Text></Tile>
            <Tile><Text style={styles.tileSub}>If you lose</Text><Text style={[styles.mid, { color: Colors.loss }]}>42%</Text></Tile>
          </View>
          <Text style={styles.small}>Root for: Clay over Ian, Ryan over Jeff</Text>
        </View>
      );
    case 'chug':
      return (
        <View style={styles.stack}>
          <View style={styles.between}>
            <Label color={AMBER}>CHUG ANALYZER</Label>
            <View style={[styles.badge, { backgroundColor: AMBER, flexShrink: 1 }]}><Text style={styles.badgeText} numberOfLines={1}>{ruleName.toUpperCase()}</Text></View>
          </View>
          <Text style={styles.score}>8.6<Text style={styles.scoreOf}>/10</Text></Text>
          <View style={styles.row}><Chip>2.31s</Chip><Chip>Clean form</Chip><Chip>Hype 9</Chip></View>
          <Text style={[styles.quote, { fontSize: 14 }]}>“Didn&apos;t spill a drop. Still lost by 30.”</Text>
        </View>
      );
    case 'social':
      return (
        <View style={styles.stack}>
          <View style={styles.row}>
            <View style={[styles.cam, { flex: 2 }]}><Text style={styles.tileSub}>TV · SNF</Text></View>
            <View style={[styles.cam, { backgroundColor: '#273142' }]} />
            <View style={[styles.cam, { backgroundColor: '#2f2a42' }]} />
          </View>
          <Label color={Colors.accent}>THE LOUNGE · 4 WATCHING</Label>
          <View style={styles.bubble}><Text style={styles.small}>Who starts a TE on a bye??</Text></View>
        </View>
      );
    case 'bragging':
      return (
        <View style={styles.grid}>
          {[
            ['GREAT WHITE BUFFALO', 'Gave away 214 pts', Colors.accent],
            ['MANAGER OF THE YEAR', '1-4 start, 8-6 finish', Colors.accent],
            ['RIVALRY WEEK', 'Jeff vs Ian, 12 meetings', '#f97316'],
            ['WAR ROOM', 'Draft grade B → A−', '#eab308'],
          ].map(([t, s, c]) => (
            <Tile key={t}><Text style={[styles.tileHead, { color: c }]}>{t}</Text><Text style={styles.tileSub}>{s}</Text></Tile>
          ))}
        </View>
      );
    case 'appearance':
      return (
        <View style={styles.stack}>
          <View style={styles.between}><Text style={styles.tileSub}>Look</Text><View style={styles.row}><Seg on>Calm</Seg><Seg>Cosmic</Seg></View></View>
          <View style={styles.between}>
            <Text style={styles.tileSub}>Accent</Text>
            <View style={styles.row}>
              {[Colors.accent, '#4cc3ff', '#f472b6', '#facc15'].map((c, i) => <View key={c} style={[styles.swatch, { backgroundColor: c }, i === 0 && styles.swatchOn]} />)}
            </View>
          </View>
          <View style={styles.between}><Text style={styles.tileSub}>Neon</Text><View style={styles.row}><Seg>Subtle</Seg><Seg on>Standard</Seg><Seg>High</Seg></View></View>
        </View>
      );
    case 'alerts':
      return (
        <View style={styles.stack}>
          <Label>SUNDAY MODE</Label>
          <View style={styles.row}><Seg on>Full Send</Seg><Seg>Game Day</Seg><Seg>Leave Me Alone</Seg></View>
          <View style={styles.between}><Text style={styles.small}>Touchdowns</Text><Toggle /></View>
          <View style={styles.between}><Text style={styles.small}>Quiet Hours</Text><Text style={styles.tileSub}>11 PM – 8 AM</Text></View>
        </View>
      );
    case 'glossary':
      return (
        <View style={[styles.row, { justifyContent: 'flex-end', alignItems: 'flex-start' }]}>
          <View style={styles.menu}>
            {['Settings', 'Friends', 'League Kitty', 'Help'].map((m) => (
              <Text key={m} style={[styles.menuItem, m === 'Help' && styles.menuItemOn]}>{m}</Text>
            ))}
          </View>
          <View style={styles.avatar}><Text style={styles.tileTitle}>You</Text></View>
        </View>
      );
  }
}

function Seg({ children, on }: { children: string; on?: boolean }) {
  return (
    <View style={[styles.seg, on && styles.segOn]}>
      <Text style={[styles.segText, on && styles.segTextOn]}>{children}</Text>
    </View>
  );
}

function Toggle() {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleKnob} />
    </View>
  );
}

function Path({ steps }: { steps: string[] }) {
  return (
    <View style={styles.path}>
      {steps.map((s, i) =>
        s === 'or' ? (
          <Text key={i} style={styles.pathSep}>or</Text>
        ) : (
          <View key={i} style={styles.row}>
            {i > 0 && steps[i - 1] !== 'or' && <Text style={styles.pathSep}>›</Text>}
            <Text style={styles.pathStep}>{s}</Text>
          </View>
        ),
      )}
    </View>
  );
}

function TourSheet() {
  const { open, index } = useTour();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const rules = useHouseRules().data;
  const ruleName = rules?.chugRuleName ?? DEFAULT_CHUG_RULE_NAME;
  const slides = useMemo(() => tourSlides({ chugEnabled: Boolean(rules?.chugEnabled), chugRuleName: ruleName }), [rules?.chugEnabled, ruleName]);
  const i = Math.min(index, slides.length - 1);
  const slide = slides[i];
  const last = i === slides.length - 1;
  const sheetHeight = Math.min(height - insets.top - 24, 800);

  const next = () => {
    haptics.select();
    if (last) tour.close();
    else tour.go(i + 1);
  };
  const showMe = () => {
    if (!slide.href) return;
    haptics.tap();
    tour.showMe(slide, i);
    router.navigate(slide.href);
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => tour.close()}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { height: sheetHeight, paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <TourHoneycomb width={width} height={sheetHeight} />
          <View style={styles.top}>
            <Text style={styles.count}>NEW HERE · {i + 1} OF {slides.length}</Text>
            <Pressable onPress={() => tour.close()} hitSlop={10} accessibilityRole="button" style={styles.skip}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.flex} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.preview}>
              <Preview slide={slide} ruleName={ruleName} />
            </View>
            <Text style={[styles.kicker, slide.key === 'chug' && { color: AMBER }]}>{slide.kicker}</Text>
            <Text style={styles.title} accessibilityRole="header">{slide.title}</Text>
            <Text style={styles.text}>{slide.body}</Text>
            <View style={styles.chips}>
              {slide.chips.map((c) => <Chip key={c}>{c}</Chip>)}
            </View>
            {slide.where && (
              <View style={styles.where}>
                <Label>WHERE TO FIND IT</Label>
                <View style={styles.whereRow}>
                  <Path steps={slide.where} />
                  {slide.key !== 'chug' && slide.key !== 'glossary' && (
                    <Pressable onPress={showMe} accessibilityRole="button" style={({ pressed }) => [styles.showMe, pressed && styles.pressed]}>
                      <Text style={styles.showMeText}>Show me</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
            {i === 0 && (
              <Text style={styles.hint}>Every slide shows where that feature lives. Replay this tour anytime: Profile circle › Help.</Text>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {slide.key === 'chug' && (
              <Pressable onPress={showMe} accessibilityRole="button" style={({ pressed }) => [styles.wide, { backgroundColor: AMBER }, pressed && styles.pressed]}>
                <Text style={styles.wideText}>Take me to the Chug Board</Text>
              </Pressable>
            )}
            {slide.key === 'glossary' && (
              <Pressable onPress={showMe} accessibilityRole="button" style={({ pressed }) => [styles.wide, styles.wideOutline, pressed && styles.pressed]}>
                <Text style={[styles.wideText, { color: Colors.accent }]}>Open the Glossary</Text>
              </Pressable>
            )}
            <View style={styles.nav}>
              <View style={styles.dots} accessibilityLabel={`Slide ${i + 1} of ${slides.length}`}>
                {slides.map((s, k) => <View key={s.key} style={[styles.dot, k === i && styles.dotOn]} />)}
              </View>
              {i > 0 && (
                <Pressable onPress={() => tour.go(i - 1)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}>
                  <Text style={styles.btnGhostText}>Back</Text>
                </Pressable>
              )}
              <Pressable onPress={next} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.btnSolid, pressed && styles.pressed]}>
                <Text style={styles.btnSolidText}>{last ? "Let's go" : 'Next'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// After "Show me": you're on the real screen, and this says where you are
// and how to get back here next time.
function FoundBanner() {
  const { found } = useTour();
  const insets = useSafeAreaInsets();
  if (!found) return null;
  return (
    <View style={[styles.found, { bottom: insets.bottom + 96 }]} accessibilityLiveRegion="polite">
      <Text style={styles.foundTitle}>You&apos;re in {found.place}</Text>
      {found.where.length > 0 && (
        <View style={styles.whereRow}>
          <Text style={styles.tileSub}>Find it again:</Text>
          <Path steps={found.where} />
        </View>
      )}
      <View style={styles.row}>
        <Pressable onPress={() => tour.open(found.index)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.btnGhost, styles.flex, pressed && styles.pressed]}>
          <Text style={styles.btnGhostText}>Back to the tour</Text>
        </Pressable>
        <Pressable onPress={() => tour.dismissFound()} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.btnSolid, pressed && styles.pressed]}>
          <Text style={styles.btnSolidText}>Got it</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Mounted once in the root layout. `ready` is false while the intro plays,
// so the tour opens on the app, not over the intro.
export function NewHereTourHost({ ready }: { ready: boolean }) {
  const { token } = useAuth();
  const me = useMe(Boolean(token)).data;
  const pathname = usePathname();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current || !ready || !token || !me || me.active_league_id === null) return;
    if (pathname.startsWith('/start') || pathname.startsWith('/sign-in')) return;
    checked.current = true;
    void tourSeen().then((seen) => {
      if (seen) return;
      void markTourSeen();
      tour.open(0);
    });
  }, [ready, token, me, pathname]);

  return (
    <>
      <TourSheet />
      <FoundBanner />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(4,6,9,0.74)' },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: 'rgba(57,255,20,0.35)', overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  count: { color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  skip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  skipText: { color: SOFT, fontSize: 14, fontWeight: '600' },
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  preview: { minHeight: 196, borderRadius: 20, backgroundColor: TILE, borderWidth: 1, borderColor: '#1c2027', padding: 14, justifyContent: 'center', marginBottom: 4 },
  kicker: { color: Colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase' },
  title: { color: Colors.text, fontFamily: Fonts.displayBold, fontSize: 28, lineHeight: 31, textTransform: 'uppercase', letterSpacing: 0.5 },
  text: { color: SOFT, fontSize: 15, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: LINE, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: '#c3c9d3', fontSize: 12, fontWeight: '600' },
  where: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#343b47', borderRadius: 14, padding: 12, gap: 8 },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  path: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  pathStep: { color: Colors.text, fontSize: 12, fontWeight: '700', backgroundColor: '#1c2027', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  pathSep: { color: '#5b6372', fontSize: 13, marginRight: 4 },
  showMe: { minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: Colors.accent, paddingHorizontal: 14, justifyContent: 'center' },
  showMeText: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
  hint: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 10, gap: 10 },
  wide: { minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  wideOutline: { borderWidth: 1, borderColor: Colors.accent },
  wideText: { color: '#0d1016', fontSize: 15, fontWeight: '700' },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  dot: { width: 5, height: 7, borderRadius: 4, backgroundColor: '#2f3540' },
  dotOn: { width: 18, backgroundColor: Colors.accent },
  btn: { minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnGhost: { borderWidth: 1, borderColor: LINE },
  btnGhostText: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  btnSolid: { backgroundColor: Colors.accent, minWidth: 108 },
  btnSolidText: { color: '#0d1016', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  found: { position: 'absolute', left: 12, right: 12, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.accent, padding: Spacing.md, gap: 10, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 12 },
  foundTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  // Previews
  center: { alignItems: 'center', gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stack: { gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48%', flexGrow: 1, borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 10, gap: 2, backgroundColor: Colors.surface },
  tileOn: { borderColor: Colors.accent },
  tileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tileHead: { fontFamily: Fonts.displayBold, fontSize: 13 },
  tileSub: { color: MUTED, fontSize: 11 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  emblem: { width: 108, height: 108, borderRadius: 54, borderWidth: 3, borderColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  emblemThe: { fontFamily: Fonts.display, color: SOFT, fontSize: 14, letterSpacing: 3 },
  emblemWord: { fontFamily: Fonts.displayBold, color: Colors.accent, fontSize: 22, letterSpacing: 1 },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#1c2027', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  tickerTag: { fontFamily: Fonts.display, color: MUTED, fontSize: 12 },
  tickerText: { color: Colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  lock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: '#1a1f27', paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  lockScore: { fontFamily: Fonts.displayBold, color: Colors.text, fontSize: 19 },
  big: { fontFamily: Fonts.displayBold, fontSize: 30 },
  mid: { fontFamily: Fonts.displayBold, fontSize: 20 },
  field: { height: 84, borderRadius: 10, backgroundColor: '#14532d', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, overflow: 'hidden' },
  yardLine: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  ball: { position: 'absolute', left: '62%', top: 36, width: 14, height: 9, borderRadius: 7, backgroundColor: '#a16207', borderWidth: 1, borderColor: '#fde68a' },
  badge: { backgroundColor: Colors.accent, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: '#0d1016', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  small: { color: Colors.text, fontSize: 13 },
  quote: { color: Colors.text, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  score: { fontFamily: Fonts.displayBold, color: Colors.text, fontSize: 46, lineHeight: 50 },
  scoreOf: { fontFamily: Fonts.display, color: MUTED, fontSize: 18 },
  cam: { flex: 1, height: 52, borderRadius: 10, backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' },
  bubble: { alignSelf: 'flex-start', backgroundColor: '#1c2027', borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 7 },
  seg: { borderWidth: 1, borderColor: LINE, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  segOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  segText: { color: SOFT, fontSize: 12, fontWeight: '600' },
  segTextOn: { color: '#0d1016' },
  swatch: { width: 20, height: 20, borderRadius: 10 },
  swatchOn: { borderWidth: 2, borderColor: Colors.text },
  toggle: { width: 36, height: 22, borderRadius: 11, backgroundColor: Colors.accent, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 3 },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#0d1016' },
  menu: { width: 176, borderWidth: 1, borderColor: LINE, borderRadius: 14, backgroundColor: Colors.surface, padding: 6, gap: 2 },
  menuItem: { color: '#c3c9d3', fontSize: 13, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, overflow: 'hidden' },
  menuItemOn: { backgroundColor: Colors.accent, color: '#0d1016', fontWeight: '700' },
  avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
});
