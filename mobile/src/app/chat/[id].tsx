import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SharedBetCard } from '@/components/bets/SharedBetCard';
import { GifPicker } from '@/components/chat/GifPicker';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api, uploadChatImage } from '@/lib/api';
import { conversationTitle, formatMessageTime } from '@/lib/chatFormat';
import { pickChatPhoto, type PhotoSource } from '@/lib/chatImage';
import { markConversationRead, useChatSocket } from '@/lib/chatSocket';
import { queryClient, useChatConversations, useChatMessages, useMe } from '@/lib/queries';
import type { AnnouncementReceipts, ChatGif, ChatMessage } from '@/lib/types';

// backend/app/routers/chat.py's ALLOWED_REACTIONS and DEFAULT_PAGE_SIZE.
const REACTIONS = ['😂', '🔥', '💀', '👍', '❤️', '😭'];
const PAGE_SIZE = 50;
const TYPING_SEND_INTERVAL_MS = 2000;

// One attachment at a time, like the web composer. A GIF is one too:
// already hosted by GIPHY, so it's ready to send straight away.
type PendingImage = { status: 'uploading' | 'done' | 'error'; localUri: string; url?: string; gif?: boolean };

export default function ConversationScreen() {
  // `title` names a conversation that isn't in the chat list, like a
  // Watch Party room's chat.
  const { id, title: titleParam } = useLocalSearchParams<{ id: string; title?: string }>();
  const conversationId = Number(id);
  const insets = useSafeAreaInsets();
  const me = useMe();
  const conversation = useChatConversations().data?.find((c) => c.id === conversationId);
  const messages = useChatMessages(conversationId);
  const { connected, typingByConversation, send, setOpenConversation } = useChatSocket();

  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  // The message whose long-press menu is open (reactions + Reply).
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    setOpenConversation(conversationId);
    markConversationRead(conversationId);
    return () => setOpenConversation(null);
  }, [conversationId, setOpenConversation]);

  const myOwnerId = me.data?.owner_id ?? null;
  const isAnnouncements = conversation?.type === 'commish_corner';
  const canPost = conversation?.can_post ?? true;
  const typists = (typingByConversation[conversationId] ?? []).filter((t) => t.owner_id !== myOwnerId);

  async function loadOlder() {
    const current = messages.data;
    if (loadingOlder || reachedStart || !current || current.length < PAGE_SIZE) return;
    setLoadingOlder(true);
    try {
      const { messages: older } = await api.chatMessages(conversationId, current[0].id);
      if (older.length < PAGE_SIZE) setReachedStart(true);
      queryClient.setQueryData<ChatMessage[]>(['chat-messages', conversationId], (prev) => {
        const ids = new Set((prev ?? []).map((m) => m.id));
        return [...older.filter((m) => !ids.has(m.id)), ...(prev ?? [])];
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  function onChangeDraft(text: string) {
    setDraft(text);
    const now = Date.now();
    if (text && now - lastTypingSent.current > TYPING_SEND_INTERVAL_MS) {
      lastTypingSent.current = now;
      send({ type: 'typing', conversation_id: conversationId });
    }
  }

  const imageReady = pendingImage?.status === 'done';
  const canSend =
    connected && pendingImage?.status !== 'uploading' && (!!draft.trim() || imageReady) && (!isAnnouncements || !!title.trim());

  function onSend() {
    if (!canSend) return;
    const event: Record<string, unknown> = { type: 'message', conversation_id: conversationId, body: draft.trim() };
    if (isAnnouncements) event.title = title.trim();
    if (imageReady) event.image_url = pendingImage.url;
    if (replyTo) event.reply_to_id = replyTo.id;
    // The sent message comes back over the socket like everyone else's,
    // so it only appears once the server has saved it.
    if (send(event)) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDraft('');
      setTitle('');
      setPendingImage(null);
      setReplyTo(null);
    }
  }

  function react(emoji: string) {
    const target = actionsFor;
    setActionsFor(null);
    if (!target) return;
    void Haptics.selectionAsync();
    api.reactToMessage(target.id, emoji).catch(() => {});
  }

  function startReply() {
    const target = actionsFor;
    setActionsFor(null);
    if (!target) return;
    setReplyTo(target);
    inputRef.current?.focus();
  }

  async function attach(source: PhotoSource) {
    let localUri: string | null;
    try {
      localUri = await pickChatPhoto(source);
    } catch {
      Alert.alert("Couldn't open that photo");
      return;
    }
    if (!localUri) return;
    setPendingImage({ status: 'uploading', localUri });
    try {
      const url = await uploadChatImage(localUri);
      setPendingImage((prev) => (prev?.localUri === localUri ? { status: 'done', localUri, url } : prev));
    } catch {
      setPendingImage((prev) => (prev?.localUri === localUri ? { status: 'error', localUri } : prev));
    }
  }

  function pickGif(gif: ChatGif) {
    setGifPickerOpen(false);
    setPendingImage({ status: 'done', localUri: gif.preview_url, url: gif.url, gif: true });
  }

  function chooseAttachment() {
    if (pendingImage?.status === 'uploading') return;
    Alert.alert('Add a photo', undefined, [
      { text: 'Photo library', onPress: () => void attach('library') },
      { text: 'Take photo', onPress: () => void attach('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const headerTitle = conversation ? conversationTitle(conversation) : (titleParam ?? 'Chat');
  if (messages.isPending) return <LoadingState />;
  if (messages.isError && !messages.data) return <MessageState message="Couldn't load messages." />;

  // Inverted list: newest at the bottom, next to the composer.
  const newestFirst = [...(messages.data ?? [])].reverse();

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen options={{ title: headerTitle }} />
      <FlatList
        inverted
        data={newestFirst}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.list}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.3}
        keyboardDismissMode="interactive"
        ListFooterComponent={loadingOlder ? <ActivityIndicator color={Colors.accent} style={styles.olderSpinner} /> : null}
        renderItem={({ item, index }) => {
          // "Previous" in reading order is the next item in this
          // newest-first array.
          const previous = newestFirst[index + 1];
          const showName = item.owner_id !== myOwnerId && previous?.owner_id !== item.owner_id;
          return (
            <MessageBubble
              message={item}
              mine={item.owner_id === myOwnerId}
              showName={showName}
              announcement={isAnnouncements}
              canSeeReceipts={isAnnouncements && (canPost || item.owner_id === myOwnerId)}
              onLongPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setActionsFor(item);
              }}
              onOpenImage={setViewingImage}
            />
          );
        }}
      />

      {typists.length > 0 && (
        <Text style={styles.typing}>
          {typists.map((t) => t.owner_name).join(', ')} {typists.length === 1 ? 'is' : 'are'} typing…
        </Text>
      )}

      {canPost ? (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
          {isAnnouncements && (
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Announcement title"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, styles.titleInput]}
            />
          )}
          {replyTo && (
            <View style={styles.replyBanner}>
              <View style={styles.replyBannerText}>
                <Text style={styles.replyName}>Replying to {replyTo.owner_name}</Text>
                <Text style={styles.replyBody} numberOfLines={1}>
                  {replyTo.body || 'Photo'}
                </Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
                <Text style={styles.dismiss}>✕</Text>
              </Pressable>
            </View>
          )}
          {pendingImage && (
            <View style={styles.pendingImage}>
              <Image source={{ uri: pendingImage.localUri }} style={styles.pendingThumb} contentFit="cover" />
              <Text style={[styles.pendingText, pendingImage.status === 'error' && styles.pendingError]}>
                {pendingImage.status === 'uploading'
                  ? 'Uploading…'
                  : pendingImage.status === 'error'
                    ? "Couldn't upload. Remove it and try again."
                    : pendingImage.gif
                      ? 'GIF ready to send'
                      : 'Ready to send'}
              </Text>
              <Pressable onPress={() => setPendingImage(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={pendingImage.gif ? 'Remove GIF' : 'Remove photo'}>
                <Text style={styles.dismiss}>✕</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.composerRow}>
            <Pressable onPress={chooseAttachment} hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach a photo" style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}>
              <Text style={styles.attachText}>+</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (pendingImage?.status === 'uploading') return;
                setGifPickerOpen(true);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Send a GIF"
              style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}>
              <Text style={styles.gifText} maxFontSizeMultiplier={1.2}>
                GIF
              </Text>
            </Pressable>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={connected ? 'Message' : 'Connecting…'}
              placeholderTextColor={Colors.textSecondary}
              multiline
              style={[styles.input, styles.messageInput]}
            />
            <Pressable
              onPress={onSend}
              disabled={!canSend}
              style={({ pressed }) => [styles.sendButton, !canSend && styles.sendDisabled, pressed && styles.pressed]}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={[styles.readOnly, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          Only the commissioner can post here.
        </Text>
      )}

      <GifPicker visible={gifPickerOpen} onSelect={pickGif} onClose={() => setGifPickerOpen(false)} />

      <Modal visible={actionsFor !== null} transparent animationType="fade" onRequestClose={() => setActionsFor(null)}>
        <Pressable style={styles.reactBackdrop} onPress={() => setActionsFor(null)}>
          <View style={styles.reactBar}>
            {REACTIONS.map((emoji) => (
              <Pressable key={emoji} onPress={() => react(emoji)} hitSlop={6} style={({ pressed }) => pressed && styles.pressed}>
                <Text style={styles.reactEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          {canPost && (
            <Pressable onPress={startReply} style={({ pressed }) => [styles.replyAction, pressed && styles.pressed]}>
              <Text style={styles.replyActionText}>Reply</Text>
            </Pressable>
          )}
        </Pressable>
      </Modal>

      <Modal visible={viewingImage !== null} transparent animationType="fade" onRequestClose={() => setViewingImage(null)}>
        <Pressable style={styles.imageViewer} onPress={() => setViewingImage(null)} accessibilityRole="button" accessibilityLabel="Close photo">
          {viewingImage && <Image source={{ uri: viewingImage }} style={styles.fullImage} contentFit="contain" />}
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function MessageBubble(props: {
  message: ChatMessage;
  mine: boolean;
  showName: boolean;
  announcement: boolean;
  canSeeReceipts: boolean;
  onLongPress: () => void;
  onOpenImage: (url: string) => void;
}) {
  const { message, mine } = props;
  return (
    <View style={[styles.messageWrap, mine ? styles.alignEnd : styles.alignStart]}>
      {props.showName && (
        <Text style={[styles.sender, message.owner_chat_color ? { color: message.owner_chat_color } : null]}>
          {message.owner_name}
        </Text>
      )}
      <Pressable onLongPress={props.onLongPress} delayLongPress={300}>
        {/* A shared bet's live card sits above its "Shared a bet" bubble,
            outside it, so it keeps its own colors. */}
        {message.bet_id ? <SharedBetCard betId={message.bet_id} mine={mine} /> : null}
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {message.reply_to && (
            <View style={styles.reply}>
              <Text style={styles.replyName}>{message.reply_to.owner_name}</Text>
              <Text style={styles.replyBody} numberOfLines={2}>
                {message.reply_to.body}
              </Text>
            </View>
          )}
          {message.title && <Text style={[styles.announcementTitle, mine && styles.textMine]}>{message.title}</Text>}
          {message.image_url && (
            <Pressable onPress={() => props.onOpenImage(message.image_url!)} onLongPress={props.onLongPress} accessibilityRole="imagebutton" accessibilityLabel={`Photo from ${message.owner_name}`}>
              <Image source={{ uri: message.image_url }} style={styles.image} contentFit="cover" transition={150} />
            </Pressable>
          )}
          {!!message.body && (
            <Text style={[styles.body, mine && styles.textMine]}>
              {props.announcement ? <LinkedBody text={message.body} messageId={message.id} mine={mine} /> : message.body}
            </Text>
          )}
          {!!message.body && <BracketLinkCard body={message.body} />}
          <Text style={[styles.time, mine && styles.timeMine]}>{formatMessageTime(message.created_at)}</Text>
        </View>
      </Pressable>
      {message.reactions.length > 0 && (
        <View style={[styles.reactions, mine && styles.alignEnd]}>
          {message.reactions.map((r) => (
            <View key={r.emoji} style={[styles.reactionChip, r.reacted_by_me && styles.reactionMine]}>
              <Text style={styles.reactionText}>
                {r.emoji} {r.count}
              </Text>
            </View>
          ))}
        </View>
      )}
      {props.canSeeReceipts && !message.deleted && <ReceiptsLine messageId={message.id} mine={mine} />}
    </View>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;

/** Links in a Commish Corner post are tappable, and each tap is logged
 *  so the commissioner can see who actually followed it. */
function LinkedBody({ text, messageId, mine }: { text: string; messageId: number; mine: boolean }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Text
        key={at}
        style={[styles.link, mine && styles.textMine]}
        onPress={() => {
          api.recordLinkOpen(messageId, url).catch(() => {});
          void WebBrowser.openBrowserAsync(url);
        }}>
        {url}
      </Text>,
    );
    last = at + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** "Seen by 7 of 11 · 4 opened" under a Commish Corner post, for the
 *  commissioner and the poster; tap for names. */
function ReceiptsLine({ messageId, mine }: { messageId: number; mine: boolean }) {
  const [data, setData] = useState<AnnouncementReceipts | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .announcementReceipts(messageId)
      .then((r) => !cancelled && setData(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [messageId]);
  if (!data) return null;
  const names = (list: { name: string }[]) => (list.length ? list.map((p) => p.name).join(', ') : 'nobody yet');
  const summary = [`Seen by ${data.seen.length} of ${data.total}`, data.has_link ? `${data.opened.length} opened` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable onPress={() => setOpen((v) => !v)} style={[styles.receipts, mine && styles.alignEnd]} accessibilityRole="button">
      <Text style={styles.receiptsSummary}>
        {summary} {open ? '▴' : '▾'}
      </Text>
      {open && (
        <View style={styles.receiptsDetail}>
          {data.has_link && (
            <Text style={styles.receiptsText}>
              <Text style={styles.receiptsLabel}>Opened: </Text>
              {names(data.opened)}
            </Text>
          )}
          <Text style={styles.receiptsText}>
            <Text style={styles.receiptsLabel}>Seen: </Text>
            {names(data.seen)}
          </Text>
          {data.not_seen.length > 0 && (
            <Text style={styles.receiptsText}>
              <Text style={styles.receiptsLabel}>Not yet: </Text>
              {names(data.not_seen)}
            </Text>
          )}
          {data.receipts_off > 0 && (
            <Text style={styles.receiptsText}>
              {data.receipts_off} {data.receipts_off === 1 ? 'member has' : 'members have'} read receipts off
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline', fontWeight: '700' },
  receipts: { marginTop: 3, paddingHorizontal: 4 },
  receiptsSummary: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  receiptsDetail: { marginTop: 4, padding: 8, borderRadius: Radius.md, backgroundColor: Colors.surface, gap: 3 },
  receiptsText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16 },
  receiptsLabel: { color: Colors.text, fontWeight: '700' },
  bracketLink: { marginTop: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#39ff14', backgroundColor: 'rgba(57,255,20,0.08)', gap: 2 },
  bracketLinkTitle: { color: '#39ff14', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  bracketLinkSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  screen: { flex: 1 },
  list: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  olderSpinner: { marginVertical: Spacing.lg },
  messageWrap: { marginVertical: 3, maxWidth: '82%' },
  alignStart: { alignSelf: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
  sender: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 2, marginLeft: Spacing.sm },
  bubble: { borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  bubbleMine: { backgroundColor: Colors.accent },
  bubbleTheirs: { backgroundColor: Colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  body: { color: Colors.text, fontSize: 16, lineHeight: 21 },
  textMine: { color: Colors.bg },
  announcementTitle: { color: Colors.text, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  time: { color: Colors.textSecondary, fontSize: 11, marginTop: 2, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(13,16,22,0.6)' },
  image: { width: 220, height: 220, borderRadius: Radius.md, marginVertical: Spacing.xs },
  reply: { borderLeftWidth: 3, borderLeftColor: Colors.textSecondary, paddingLeft: Spacing.sm, marginBottom: Spacing.xs },
  replyName: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  replyBody: { color: Colors.textSecondary, fontSize: 13 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  reactionChip: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  reactionMine: { borderColor: Colors.accent },
  reactionText: { color: Colors.text, fontSize: 12 },
  typing: { color: Colors.textSecondary, fontSize: 12, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  input: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  titleInput: { fontWeight: '700' },
  messageInput: { flex: 1, maxHeight: 120 },
  sendButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: Colors.bg, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.6 },
  readOnly: { color: Colors.textSecondary, textAlign: 'center', paddingTop: Spacing.md },
  reactBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  reactBar: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  reactEmoji: { fontSize: 30 },
  replyAction: {
    marginTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  replyActionText: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
    paddingLeft: Spacing.sm,
  },
  replyBannerText: { flex: 1 },
  dismiss: { color: Colors.textSecondary, fontSize: 16, paddingHorizontal: Spacing.xs },
  pendingImage: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pendingThumb: { width: 48, height: 48, borderRadius: Radius.md },
  pendingText: { flex: 1, color: Colors.textSecondary, fontSize: 13 },
  pendingError: { color: Colors.loss },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  attachText: { color: Colors.text, fontSize: 22, lineHeight: 24 },
  gifText: { color: Colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  imageViewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  fullImage: { width: '100%', height: '80%' },
});

/** A shared What-If bracket (…/standings?view=playoffs&w=…) opens in
 *  League → Standings → Playoffs instead of the browser. */
function BracketLinkCard({ body }: { body: string }) {
  // Old links (/bracket?…) and new ones (/standings?view=playoffs&…).
  const m = body.match(/\/(?:bracket|standings)\?([^\s]+)/);
  if (!m) return null;
  const query = new URLSearchParams(m[1]);
  const w = query.get('w');
  if (!w) return null;
  return (
    <Pressable
      onPress={() => router.navigate({ pathname: '/league', params: { section: 'standings', view: 'playoffs', w } } as unknown as Href)}
      style={({ pressed }) => [styles.bracketLink, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel="Open this what-if bracket">
      <Text style={styles.bracketLinkTitle}>OPEN THIS WHAT-IF</Text>
      <Text style={styles.bracketLinkSub}>See the standings and bracket in this world</Text>
    </Pressable>
  );
}

