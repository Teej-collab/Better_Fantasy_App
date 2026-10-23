import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { load } from '@/lib/localNotifications';
import { queryClient } from '@/lib/queries';

// The red number on the app icon: unread chat messages plus, for a
// commissioner, trades waiting on their review (backend app/domain/
// app_badge.py). Every iPhone push carries the number so it updates while
// the app is closed; this keeps it right while it's open, dropping it the
// moment a chat is read. Signed out, it's cleared.

export function refreshAppBadge() {
  void queryClient.invalidateQueries({ queryKey: ['app-badge'] });
}

export function useAppBadge() {
  const { token } = useAuth();
  const { data } = useQuery({ queryKey: ['app-badge'], queryFn: api.chatBadge, enabled: !!token, refetchInterval: 60_000 });
  const total = token ? data?.total : 0;
  useEffect(() => {
    if (total === undefined) return;
    load()
      ?.setBadgeCountAsync(total)
      .catch(() => {});
  }, [total]);
}
