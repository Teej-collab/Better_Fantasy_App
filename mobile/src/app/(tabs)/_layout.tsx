import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <NativeTabs backgroundColor={Colors.surface} tintColor={Colors.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="standings">
        <NativeTabs.Trigger.Label>Standings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.number" md="leaderboard" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
