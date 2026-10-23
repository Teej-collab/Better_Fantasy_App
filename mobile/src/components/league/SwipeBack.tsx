import { type ReactNode, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

// Swipe from the left edge to go back (2026-10-23), the way a chat swipes
// back to the chat list. The League tab's cards open in place rather than
// as their own screens, so they don't get the stack's swipe for free: the
// page follows your finger, and a long or quick enough swipe slides it off
// and calls onBack. Only the left edge starts it, so sideways scrollers
// inside the page keep working.

const EDGE = 28;

export function SwipeBack({ enabled, onBack, children }: { enabled: boolean; onBack: () => void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);

  const pan = useMemo(() => {
    const finish = () => {
      onBack();
      x.set(0);
    };
    return Gesture.Pan()
      .enabled(enabled)
      .hitSlop({ left: 0, width: EDGE })
      .activeOffsetX(10)
      .failOffsetY([-20, 20])
      .onUpdate((e) => {
        x.set(Math.max(0, e.translationX));
      })
      .onEnd((e) => {
        if (e.translationX > width * 0.35 || e.velocityX > 600) {
          x.set(
            withTiming(width, { duration: 180 }, (done) => {
              if (done) runOnJS(finish)();
            }),
          );
        } else {
          x.set(withSpring(0, { damping: 20, stiffness: 220 }));
        }
      });
  }, [enabled, onBack, width, x]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.fill, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
