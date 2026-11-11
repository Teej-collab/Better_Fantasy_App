import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { ANTON, Elite, EliteSegmented } from '@/components/elite/Elite';
import { Text } from '@/components/Text';
import { Spacing } from '@/constants/theme';
import { api, WEB_BASE_URL, type ShareRef } from '@/lib/api';
import { haptics } from '@/lib/haptics';

// Post and Story send the picture alone; Link sends the link alone, which
// unfurls into the Wide card. Never both: iMessage turned the link into a
// second card under the picture (2026-11-11).
type Format = 'post' | 'story' | 'link';

const SITE = WEB_BASE_URL || 'https://weekend-league-web.vercel.app';
const FORMATS: { key: Format; label: string; ratio: number }[] = [
  { key: 'post', label: 'Post', ratio: 1080 / 1350 },
  { key: 'story', label: 'Story', ratio: 1080 / 1920 },
  { key: 'link', label: 'Link', ratio: 1200 / 630 },
];

// The share overhaul (2026-11-10): a designed card, drawn by the web
// (frontend/src/app/s/[token]/image), instead of a screenshot of the
// screen. Sharing makes a public link (backend app/routers/share.py)
// that the card, the league chat and anyone outside the league can
// open. The web's twin is frontend/src/components/share/ShareButton.tsx.
export function ShareButton({ shareRef, title, label = 'Share ↗' }: { shareRef: ShareRef; title: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Share ${title}`}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>{label}</Text>
      </Pressable>
      {open && <ShareSheet shareRef={shareRef} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={Elite.cream} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}

function ShareSheet({ shareRef, title, onClose }: { shareRef: ShareRef; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>('post');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .createShareLink(shareRef)
      .then((r) => live && setToken(r.token))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't make a share link."));
    return () => {
      live = false;
    };
    // One link per sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = token ? `${SITE}/s/${token}` : null;
  const imageUrl = token ? `${SITE}/s/${token}/image?f=${format === 'link' ? 'wide' : format}` : null;
  const ratio = FORMATS.find((f) => f.key === format)!.ratio;

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await action();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  // Through the phone's own share sheet (Messages, Instagram, Save
  // Image…): the picture alone, or for Link the link alone. Falls back to
  // the link on a build without the file module.
  async function shareOut() {
    if (!link || !imageUrl) return;
    if (format === 'link') {
      await Share.share(Platform.OS === 'ios' ? { url: link } : { message: link });
      return;
    }
    let file: string | null = null;
    try {
      const { File, Paths } = await import('expo-file-system');
      const dest = new File(Paths.cache, `weekend-${token}-${format}.png`);
      if (dest.exists) dest.delete();
      file = (await File.downloadFileAsync(imageUrl, dest)).uri;
    } catch {
      file = null;
    }
    if (file && Platform.OS === 'ios') {
      await Share.share({ url: file });
    } else if (file) {
      const Sharing = await import('expo-sharing');
      await Sharing.shareAsync(file, { mimeType: 'image/png', dialogTitle: title });
    } else {
      await Share.share({ message: `${title} ${link}` });
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <View style={styles.header}>
          <Text style={styles.title}>SHARE</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.close}>
            <Icon d="M6 6l12 12M18 6 6 18" />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.preview, { aspectRatio: ratio, maxHeight: format === 'story' ? 420 : undefined }]}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} accessibilityLabel={title} />
            ) : error ? null : (
              <ActivityIndicator color={Elite.green} />
            )}
          </View>

          <EliteSegmented options={FORMATS.map((f) => ({ key: f.key, label: f.label }))} value={format} onChange={setFormat} />
          <Text style={styles.hint}>
            {format === 'post'
              ? 'Sends the picture, sized for group chats.'
              : format === 'story'
                ? 'Sends the picture, full screen for stories.'
                : 'Sends the link. It opens as this card, and anyone can tap through, no sign-in needed.'}
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}
          {note && <Text style={styles.note}>{note}</Text>}
        </ScrollView>

        <View style={styles.dests}>
          <Dest
            label="League chat"
            hot
            busy={busy === 'chat'}
            disabled={!link}
            d="M4 5h16v11H9l-5 4z"
            onPress={() =>
              void run('chat', async () => {
                await api.shareToLeagueChat(`${title} ${link}`);
                haptics.success();
                setNote('Posted to the league chat.');
              })
            }
          />
          <Dest label="Share" busy={busy === 'out'} disabled={!link} d="M12 15V4M7 9l5-5 5 5M5 14v5h14v-5" onPress={() => void run('out', shareOut)} />
          <Dest
            label="Copy link"
            busy={busy === 'copy'}
            disabled={!link}
            d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
            onPress={() =>
              void run('copy', async () => {
                await Clipboard.setStringAsync(link!);
                haptics.success();
                setNote('Link copied.');
              })
            }
          />
        </View>
      </View>
    </Modal>
  );
}

function Dest(props: { label: string; d: string; onPress: () => void; hot?: boolean; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => [styles.dest, (pressed || props.disabled) && styles.pressed]}>
      <View style={[styles.destIcon, props.hot && styles.destHot]}>{props.busy ? <ActivityIndicator color={Elite.green} /> : <Icon d={props.d} />}</View>
      <Text style={styles.destLabel}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  buttonText: { color: Elite.soft, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.55 },
  sheet: { flex: 1, backgroundColor: '#0b0f14' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
  title: { fontFamily: ANTON, fontSize: 24, color: Elite.green, letterSpacing: 1, textShadowColor: 'rgba(57,255,20,0.7)', textShadowRadius: 10 },
  close: { width: 44, height: 44, borderRadius: 14, backgroundColor: Elite.card, borderWidth: 1, borderColor: Elite.line, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.lg },
  preview: { width: '100%', alignSelf: 'center', borderRadius: 18, backgroundColor: Elite.card, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  hint: { color: Elite.faint, fontSize: 13, lineHeight: 18 },
  error: { color: '#f87171', fontSize: 14, fontWeight: '600' },
  note: { color: Elite.green, fontSize: 14, fontWeight: '600' },
  dests: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Elite.line },
  dest: { alignItems: 'center', gap: 6, minWidth: 72 },
  destIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: Elite.card, borderWidth: 1, borderColor: Elite.line, alignItems: 'center', justifyContent: 'center' },
  destHot: { borderColor: Elite.green, backgroundColor: '#0f1a12' },
  destLabel: { color: Elite.cream, fontSize: 12, fontWeight: '600' },
});
