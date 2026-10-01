import { useState } from 'react';
import { RefreshControl } from 'react-native';

import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';

// Pull-to-refresh for any screen: refetches every query the screen (and
// anything else on screen) is showing, so a screen doesn't have to know
// which of its queries to refresh. A light tap when the pull triggers.
export function AppRefreshControl() {
  const accent = useAppearance().accent;
  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() {
    haptics.tap();
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
    } finally {
      setRefreshing(false);
    }
  }
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />;
}
