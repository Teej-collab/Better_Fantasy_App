import { Alert } from 'react-native';

import { api } from '@/lib/api';
import { queryClient } from '@/lib/queries';

// Buttons on a push (2026-11-08). The backend names one of these sets in
// the push (aps.category, app/notifications/formatter.py) along with the
// ids they act on. iOS only runs a button's code with the app open, so
// each opens it, does the thing, and lands on the push's own screen.
type NotificationsModule = typeof import('expo-notifications');
type PushData = { url?: string; trade_id?: number; entry_id?: number; user_id?: number; conversation_id?: number };

type Action = {
  identifier: string;
  buttonTitle: string;
  options?: { isDestructive?: boolean; isAuthenticationRequired?: boolean };
  textInput?: { submitButtonTitle: string; placeholder: string };
};

const CATEGORIES: Record<string, Action[]> = {
  chat_message: [{ identifier: 'reply', buttonTitle: 'Reply', textInput: { submitButtonTitle: 'Send', placeholder: 'Reply…' } }],
  trade_offer: [
    { identifier: 'accept', buttonTitle: 'Accept', options: { isAuthenticationRequired: true } },
    { identifier: 'decline', buttonTitle: 'Decline', options: { isDestructive: true } },
  ],
  survivor_pick: [{ identifier: 'best', buttonTitle: 'Pick best odds' }],
  friend_request: [{ identifier: 'accept', buttonTitle: 'Accept' }],
};

export function registerNotificationCategories(n: NotificationsModule) {
  for (const [id, actions] of Object.entries(CATEGORIES)) {
    n.setNotificationCategoryAsync(
      id,
      actions.map((a) => ({ ...a, options: { ...a.options, opensAppToForeground: true } })),
    ).catch(() => {});
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Try again from the app.';
}

/** Runs a button's action; the caller opens the push's screen either way. */
export async function runNotificationAction(category: string | undefined, action: string, data: PushData, userText?: string): Promise<void> {
  try {
    if (category === 'chat_message' && data.conversation_id && action === 'reply') {
      const text = userText?.trim();
      if (text) await api.replyToChat(data.conversation_id, text);
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    } else if (category === 'trade_offer' && data.trade_id) {
      if (action === 'accept') {
        await api.acceptTrade(data.trade_id, []);
        Alert.alert('Trade accepted');
      } else if (action === 'decline') {
        await api.tradeAction(data.trade_id, 'reject');
        Alert.alert('Trade declined');
      }
      void queryClient.invalidateQueries({ queryKey: ['my-trades'] });
    } else if (category === 'survivor_pick' && data.entry_id && action === 'best') {
      const res = await api.survivorBestPick(data.entry_id);
      Alert.alert('Picked', `${res.teams.join(' and ')} for week ${res.week}. You can change it until kickoff.`);
      void queryClient.invalidateQueries({ queryKey: ['survivor-pools'] });
    } else if (category === 'friend_request' && data.user_id && action === 'accept') {
      await api.acceptFriend(data.user_id);
      Alert.alert('Friends now');
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
    }
  } catch (e) {
    // A trade that needs a drop, a pick that just locked: the screen it
    // opens to lets them finish by hand.
    Alert.alert("Couldn't do that from the notification", message(e));
  }
}
