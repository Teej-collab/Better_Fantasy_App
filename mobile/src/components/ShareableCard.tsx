import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { canShareImages, shareViewAsImage } from '@/lib/shareImage';

// Wraps a card that can be sent to the group chat as an image: a Share
// button, and on share a "WEEKEND LEAGUE" signature strip added to the
// bottom of the captured image only for that moment.
export function ShareableCard({
  children,
  title,
  style,
}: {
  children: ReactNode;
  // The share sheet's title, e.g. "Week 3 Awards".
  title: string;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<View>(null);
  const [capturing, setCapturing] = useState(false);

  async function share() {
    haptics.tap();
    setCapturing(true);
    // Let the signature strip render before the capture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await shareViewAsImage(ref, title);
    } catch {
      haptics.error();
    } finally {
      setCapturing(false);
    }
  }

  return (
    <View style={style}>
      <View ref={ref} collapsable={false} style={capturing && styles.capture}>
        {children}
        {capturing && (
          <View style={styles.signature}>
            <Text style={styles.signatureText}>WEEKEND LEAGUE</Text>
          </View>
        )}
      </View>
      {canShareImages && (
        <Pressable onPress={share} disabled={capturing} hitSlop={8} style={({ pressed }) => [styles.share, pressed && styles.pressed]}>
          {capturing ? <ActivityIndicator size="small" color={Colors.textSecondary} /> : <Text style={styles.shareText}>Share ↗</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // A solid backdrop so the image doesn't come out transparent.
  capture: { backgroundColor: Colors.bg, padding: Spacing.md, borderRadius: Radius.lg },
  signature: { alignItems: 'center', paddingTop: Spacing.md },
  signatureText: { fontFamily: Fonts.display, color: Colors.accent, fontSize: 13, letterSpacing: 3 },
  share: { alignSelf: 'flex-end', marginTop: 6, paddingHorizontal: 10, paddingVertical: 4 },
  shareText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
