import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Kicker, NeonButton } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { joinLinkFor } from '@/lib/qrJoin';

/** The invite text: the web link everyone can open, plus a link that
 *  opens the app's join screen for anyone who already has the app. */
export function inviteMessage(leagueName: string, code: string): string {
  return [
    `Join my league "${leagueName}" on The Weekend!`,
    `Invite code: ${code}`,
    joinLinkFor(code),
    `Have the app? Open: weekendleague://start/join?code=${encodeURIComponent(code)}`,
  ].join('\n');
}

// Inviting someone to a league (2026-10): the code big enough to read
// across a table (tap to copy), a QR to scan in person, and one button
// to send the invite by text or anything else. The same sheet opens
// from Leagues, the League tab's "Invite friends", and Commissioner
// Tools.
export function InviteSheet({ league, onClose }: { league: { name: string; invite_code: string } | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  if (!league) return null;
  const link = joinLinkFor(league.invite_code);

  async function copy(what: 'code' | 'link') {
    await Clipboard.setStringAsync(what === 'code' ? league!.invite_code : link);
    haptics.success();
    setCopied(what);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Kicker>Invite to</Kicker>
              <Text style={styles.name} numberOfLines={1}>
                {league.name}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => void copy('code')} style={styles.codeBox} accessibilityRole="button" accessibilityLabel={`Invite code ${league.invite_code}. Tap to copy`}>
            <Text style={styles.codeLabel}>{copied === 'code' ? 'Copied!' : 'Invite code · tap to copy'}</Text>
            <Text style={styles.code} selectable>
              {league.invite_code}
            </Text>
          </Pressable>

          {/* Dark on white with a quiet zone: what every scanner reads best. */}
          <View style={styles.qrWrap}>
            <View style={styles.qrCard} accessible accessibilityRole="image" accessibilityLabel={`QR code to join ${league.name}`}>
              <QRCode value={link} size={180} color="#000000" backgroundColor="#ffffff" ecl="M" />
            </View>
            <Text style={styles.qrCaption}>Scan with a phone camera, or in The Weekend → Join a league</Text>
          </View>

          <NeonButton
            label="Share invite"
            onPress={() => {
              haptics.tap();
              void Share.share({ message: inviteMessage(league.name, league.invite_code) });
            }}
          />
          <Pressable onPress={() => void copy('link')} style={styles.copyLink} accessibilityRole="button">
            <Text style={styles.copyLinkText}>{copied === 'link' ? 'Link copied!' : 'Copy invite link'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#0f121a', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: Spacing.lg, gap: Spacing.md, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  name: { fontFamily: Fonts.displayBold, fontSize: 24, letterSpacing: 1, textTransform: 'uppercase', color: Colors.text },
  done: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  codeBox: { alignItems: 'center', gap: 4, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.06)' },
  codeLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  code: { color: Colors.accent, fontFamily: Fonts.monoBold, fontSize: 30, letterSpacing: 3 },
  qrWrap: { alignItems: 'center', gap: Spacing.sm },
  qrCard: { backgroundColor: '#ffffff', padding: 14, borderRadius: Radius.md },
  qrCaption: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
  copyLink: { alignItems: 'center', paddingVertical: Spacing.sm },
  copyLinkText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
});
