import { View } from 'react-native';

import { PlayersScreenContent } from '@/app/(tabs)/players';
import { HoneycombBackground } from '@/components/HoneycombBackground';

// Free Agents as a page of its own, with a back button (2026-10-29: opened
// from My Team or Home onto the Players tab, there was no way back and no
// tab bar). The Players tab stays for the home-screen shortcut.
export default function FreeAgentsScreen() {
  return (
    <View style={{ flex: 1 }}>
      <HoneycombBackground />
      <PlayersScreenContent />
    </View>
  );
}
