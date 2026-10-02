import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';

import { LeaguePicker } from '@/components/start/LeaguePicker';
import { api } from '@/lib/api';

// The front door for joining or creating a league (port of the web's
// /start, components/start/StartFlow.tsx), opened from Settings, Home's
// no-league card and invite links. A cold open shows the same picker in
// place instead (components/LaunchPicker.tsx).
export default function StartScreenRoute() {
  const q = useQuery({ queryKey: ['leagues-mine'], queryFn: api.leaguesMine });
  const hasLeagues = (q.data?.leagues.length ?? 0) > 0;
  return (
    <>
      <Stack.Screen options={{ title: hasLeagues ? 'Your Leagues' : 'Get Started' }} />
      <LeaguePicker onOpened={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </>
  );
}
