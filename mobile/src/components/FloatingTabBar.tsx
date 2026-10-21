import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { Colors, withAlpha } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { TAB_BAR_HEIGHT, setTabBarHidden, tabBarHidden } from '@/lib/tabBar';

// The app's tab bar (2026-10-20): a slim floating pill, icons only, that
// slides away while you scroll down and comes back when you scroll up
// (lib/tabBar.ts) — modeled on Facebook's.

const ICONS: Record<string, { sf: SFSymbol; label: string }> = {
  index: { sf: 'house.fill', label: 'Home' },
  team: { sf: 'person.3.fill', label: 'Team' },
  players: { sf: 'magnifyingglass', label: 'Players' },
  chat: { sf: 'bubble.left.and.bubble.right.fill', label: 'Chat' },
  league: { sf: 'trophy.fill', label: 'League' },
};

const glass = isLiquidGlassAvailable();

export function FloatingTabBar({ state, navigation, accent, badges }: BottomTabBarProps & { accent: string; badges: Record<string, number> }) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 14, 12);
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(tabBarHidden.value, [0, 1], [0, TAB_BAR_HEIGHT + bottom + 24]) }],
    opacity: interpolate(tabBarHidden.value, [0, 0.8, 1], [1, 1, 0]),
  }));

  const items = state.routes.map((route, index) => {
    const focused = state.index === index;
    const icon = ICONS[route.name];
    if (!icon) return null;
    const badge = badges[route.name] ?? 0;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={badge > 0 ? `${icon.label}, ${badge} unread` : icon.label}
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
          <SymbolView name={icon.sf} size={21} tintColor={focused ? accent : Colors.textSecondary} fallback={<Text style={{ color: focused ? accent : Colors.textSecondary }}>{icon.label[0]}</Text>} />
          {badge > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  });

  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { bottom }, slide]}>
      {glass ? (
        <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.bar}>
          {items}
        </GlassView>
      ) : (
        <View style={[styles.bar, styles.solid]}>{items}</View>
      )}
    </Animated.View>
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
});
