import { Image } from 'expo-image';
import { useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';

// A photo full screen: pinch to zoom in (up to 5x) and drag around it.
// A tap closes it unless you're zoomed in; ✕ always does.
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const zoom = useRef(1);

  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <ScrollView
          key={uri ?? ''}
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          bouncesZoom
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) => {
            zoom.current = e.nativeEvent.zoomScale ?? 1;
          }}
          onLayout={() => {
            zoom.current = 1;
          }}>
          <Pressable
            onPress={() => {
              if (zoom.current <= 1.01) onClose();
            }}
            accessibilityRole="image"
            accessibilityLabel="Photo. Pinch to zoom.">
            {uri && <Image source={{ uri }} style={{ width, height }} contentFit="contain" />}
          </Pressable>
        </ScrollView>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={[styles.close, { top: insets.top + 8 }]}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  close: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
