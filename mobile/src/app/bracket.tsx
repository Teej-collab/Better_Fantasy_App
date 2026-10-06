import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { BracketExperience } from '@/components/bracket/BracketExperience';

// The standalone Bracket screen (shared what-if links land here). The
// same experience lives in League → Standings → Playoffs.
export default function BracketScreen() {
  const params = useLocalSearchParams<{ mode?: string; w?: string }>();
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Bracket' }} />
      <BracketExperience initialMode={params.mode} initialW={params.w} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1016' },
});
