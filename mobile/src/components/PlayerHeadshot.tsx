import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/Text';

// A player's headshot in a circle, like ESPN's roster rows (backend
// app/domain/headshots.py picks the URL: ESPN's CDN, else Sleeper's;
// a team logo for a D/ST). No URL, or one that fails to load, shows the
// position instead so the row keeps its shape.
export function PlayerHeadshot({
  url,
  position,
  size = 40,
  style,
}: {
  url?: string | null;
  position: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const dims = { width: size, height: size, borderRadius: size / 2 };
  const isTeam = position === 'DEF';
  return (
    <View style={[styles.circle, dims, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {url && !failed ? (
        <Image
          source={{ uri: url }}
          style={isTeam ? { width: size * 0.78, height: size * 0.78 } : { width: size * 1.37, height: size }}
          contentFit="contain"
          contentPosition="top"
          transition={120}
          cachePolicy="memory-disk"
          recyclingKey={url}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.fallback, { fontSize: size * 0.3 }]}>{isTeam ? 'D/ST' : position}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  fallback: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', alignSelf: 'center', marginBottom: 'auto', marginTop: 'auto' },
});
