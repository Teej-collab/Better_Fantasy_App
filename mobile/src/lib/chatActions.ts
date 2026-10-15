import { Alert } from 'react-native';

import { api } from '@/lib/api';
import { conversationTitle } from '@/lib/chatFormat';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { ChatConversation } from '@/lib/types';

// League Chat and Commish Corner belong to the whole league.
export function canDeleteConversation(c: ChatConversation): boolean {
  return c.type === 'direct' || c.type === 'group';
}

// Asks first, then takes the chat off your list (history included, for
// you only). A new message from anyone brings it back, like Messages.
export function confirmDeleteConversation(c: ChatConversation, onDone?: () => void) {
  Alert.alert(
    `Delete ${conversationTitle(c)}?`,
    "It's removed from your chats, along with its messages. Everyone else keeps theirs. A new message brings it back.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const before = queryClient.getQueryData<ChatConversation[]>(['chat-conversations']);
          queryClient.setQueryData<ChatConversation[]>(['chat-conversations'], (prev) => prev?.filter((x) => x.id !== c.id));
          queryClient.removeQueries({ queryKey: ['chat-messages', c.id] });
          haptics.success();
          onDone?.();
          api.deleteConversation(c.id).catch((e: unknown) => {
            queryClient.setQueryData(['chat-conversations'], before);
            haptics.error();
            Alert.alert("Couldn't delete that chat", e instanceof Error ? e.message : 'Try again.');
          });
        },
      },
    ],
  );
}
