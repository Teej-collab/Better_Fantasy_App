import { useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { makeMutable, withTiming } from 'react-native-reanimated';

// The floating tab bar (components/FloatingTabBar.tsx) slides away while
// you scroll down a tab and comes back the moment you scroll up — the
// Facebook-style bar (2026-10-20). 0 = showing, 1 = hidden.
export const tabBarHidden = makeMutable(0);
let hidden = false;

// The bar's size, and the room each tab leaves under its content so the
// last card can scroll clear of it.
export const TAB_BAR_HEIGHT = 52;
export const TAB_BAR_CONTENT_INSET = TAB_BAR_HEIGHT + 20;

export function setTabBarHidden(next: boolean) {
  if (next === hidden) return;
  hidden = next;
  tabBarHidden.value = withTiming(next ? 1 : 0, { duration: 220 });
}

// Spread onto a tab's main ScrollView / FlatList: reports which way it's
// scrolling and leaves room for the bar at the bottom.
export function useTabBarScroll() {
  const lastY = useRef(0);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const y = contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    // The bounce at either end isn't a change of direction.
    const bottom = contentSize.height - layoutMeasurement.height;
    if (y <= 0) setTabBarHidden(false);
    else if (y >= bottom) return;
    else if (dy > 6 && y > 60) setTabBarHidden(true);
    else if (dy < -6) setTabBarHidden(false);
  }
  return {
    onScroll,
    scrollEventThrottle: 16,
    contentInset: { bottom: TAB_BAR_CONTENT_INSET },
    scrollIndicatorInsets: { bottom: TAB_BAR_CONTENT_INSET },
  };
}
