import { router, type Href } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EngineIcon, TabIcon, type EngineIconName, type TabIconName } from '@/components/NavIcons';
import { Text } from '@/components/Text';
import { Colors, withAlpha } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useHouseRules, useMyWeek } from '@/lib/queries';
import { TAB_BAR_HEIGHT, setTabBarHidden, tabBarHidden } from '@/lib/tabBar';

// The app's tab bar (2026-10-20): a slim floating pill, icons only, that
// slides away while you scroll down and comes back when you scroll up
// (lib/tabBar.ts) — modeled on Facebook's.
//
// 2026-10-21 (Option D of the tab bar mockups): four tabs around a center
// Engines button that opens every engine — Matchup, What-If, Lounge,
// Gamecast, League Bets and Chug — so none of them hides in a menu.
// Players is no longer a tab; it stays a route (Team → Free Agents, the
// Home free-agent cards), just without an icon here.

// Tab icons are the "Neon line" drawings and engine icons the
// "Playbook" ones (components/NavIcons.tsx, 2026-10-21).
const LABELS: Record<TabIconName, string> = { index: 'Home', team: 'Team', chat: 'Chat', league: 'League' };

type Engine = { key: EngineIconName; label: string; color: string; href: Href };

function useEngines(): Engine[] {
  const matchupId = useMyWeek().data?.matchup?.matchup_id ?? null;
  const chugEnabled = useHouseRules().data?.chugEnabled ?? false;
  return [
    ...(matchupId !== null
      ? [{ key: 'matchup', label: 'Matchup', color: '#39ff14', href: { pathname: '/matchup/[id]', params: { id: String(matchupId) } } } as Engine]
      : []),
    { key: 'whatif', label: 'What-If', color: '#facc15', href: { pathname: '/league', params: { section: 'standings', view: 'playoffs' } } as unknown as Href },
    { key: 'lounge', label: 'Lounge', color: '#f472b6', href: '/lounge' as Href },
    { key: 'gamecast', label: 'Gamecast', color: '#4cc3ff', href: '/gamecast' },
    { key: 'bets', label: 'League Bets', color: '#c084fc', href: '/bets/league' as Href },
    ...(chugEnabled ? [{ key: 'chug', label: 'Chug', color: '#ff8a3d', href: '/chug' } as Engine] : []),
  ];
}

const glass = isLiquidGlassAvailable();

export function FloatingTabBar({ state, navigation, accent, badges }: BottomTabBarProps & { accent: string; badges: Record<string, number> }) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 14, 12);
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(tabBarHidden.value, [0, 1], [0, TAB_BAR_HEIGHT + bottom + 24]) }],
    opacity: interpolate(tabBarHidden.value, [0, 0.8, 1], [1, 1, 0]),
  }));

  const [enginesOpen, setEnginesOpen] = useState(false);
  const engines = useEngines();

  const items = state.routes.map((route, index) => {
    const focused = state.index === index;
    const name = route.name as TabIconName;
    const label = LABELS[name];
    if (!label) return null;
    const badge = badges[route.name] ?? 0;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            haptics.tap();
            navigation.navigate(route.name, route.params);
          }
          setTabBarHidden(false);
        }}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
        style={styles.item}>
        <View style={[styles.itemInner, focused && { backgroundColor: withAlpha(accent, 0.16) }]}>
          <TabIcon name={name} focused={focused} color={focused ? accent : Colors.textSecondary} />
          {badge > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  });

  // The Engines button sits in the middle, right after Team.
  const teamAt = state.routes.findIndex((r) => r.name === 'team');
  const center = (
    <View key="engines" style={styles.item}>
      <Pressable
        onPress={() => {
          haptics.tap();
          setEnginesOpen((open) => !open);
          setTabBarHidden(false);
        }}
        accessibilityRole="button"
        accessibilityLabel={enginesOpen ? 'Close engines' : 'Engines'}
        accessibilityState={{ expanded: enginesOpen }}
        style={[styles.engineButton, { backgroundColor: enginesOpen ? Colors.text : accent }]}>
        <SymbolView
          name={enginesOpen ? 'xmark' : 'square.grid.2x2.fill'}
          size={20}
          tintColor={Colors.bg}
          fallback={<Text style={{ color: Colors.bg, fontWeight: '800' }}>{enginesOpen ? '×' : '⋯'}</Text>}
        />
      </Pressable>
    </View>
  );
  items.splice(teamAt + 1, 0, center);

  function openEngine(engine: Engine) {
    haptics.tap();
    setEnginesOpen(false);
    router.navigate(engine.href);
  }

  return (
    <>
      {enginesOpen && (
        <Pressable style={styles.backdrop} onPress={() => setEnginesOpen(false)} accessibilityLabel="Close engines">
          <View style={[styles.sheet, { bottom: bottom + TAB_BAR_HEIGHT + 12 }]} accessibilityViewIsModal>
            <Text style={styles.sheetTitle}>ENGINES</Text>
            <View style={styles.grid}>
              {engines.map((engine) => (
                <Pressable
                  key={engine.key}
                  onPress={() => openEngine(engine)}
                  accessibilityRole="button"
                  accessibilityLabel={engine.label}
                  style={({ pressed }) => [
                    styles.tile,
                    { backgroundColor: withAlpha(engine.color, 0.1), borderColor: withAlpha(engine.color, 0.35) },
                    pressed && styles.pressed,
                  ]}>
                  <EngineIcon name={engine.key} color={engine.color} />
                  <Text style={styles.tileText} numberOfLines={1}>
                    {engine.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      )}
      <Animated.View pointerEvents="box-none" style={[styles.wrap, { bottom }, slide]}>
        {glass ? (
          <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.bar}>
            {items}
          </GlassView>
        ) : (
          <View style={[styles.bar, styles.solid]}>{items}</View>
        )}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14 },
  bar: {
    height: TAB_BAR_HEIGHT,
    borderRadius: TAB_BAR_HEIGHT / 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  solid: {
    backgroundColor: withAlpha(Colors.surface, 0.96),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  itemInner: { width: 54, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 6,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  engineButton: { width: 46, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(5,6,9,0.72)' },
  sheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    padding: 16,
    gap: 12,
    borderRadius: 26,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  sheetTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '31%',
    flexGrow: 1,
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tileText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
