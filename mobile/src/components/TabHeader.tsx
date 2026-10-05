import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { useActiveLeagueName, useMe } from '@/lib/queries';

// The bar across the top of every tab (2026-10 navigation pass): your
// league on the left — tap for the league picker (switch, join, or
// start one) — and you on
// the right, opening the same account menu as the web's (Settings,
// Notifications, Bets, Leagues, Commissioner Tools, Admin, Feedback).
// Replaces the lone ⚙︎ that only Home had, so none of those were more
// than one tap from any tab.
export function TabHeader() {
  const accent = useAppearance().accent;
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const leagueName = useActiveLeagueName().data;
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (me?.display_name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Pressable
        onPress={() => {
          haptics.tap();
          // The league picker everyone sees on launch (new, or in 2+
          // leagues): your leagues as cards, plus Join and Create.
          router.push('/start');
        }}
        style={styles.league}
        accessibilityRole="button"
        accessibilityLabel={`${leagueName ?? 'Your league'}. Switch leagues`}>
        <Text style={styles.leagueName} numberOfLines={1}>
          {leagueName ?? 'Leagues'}
        </Text>
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={Colors.textSecondary} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M6 9l6 6 6-6" />
        </Svg>
      </Pressable>
      <Pressable
        onPress={() => {
          haptics.tap();
          setMenuOpen(true);
        }}
        style={[styles.avatar, { borderColor: accent }]}
        accessibilityRole="button"
        accessibilityLabel="Account menu">
        <Text style={styles.avatarText}>{initials}</Text>
      </Pressable>
      <AccountMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        name={me?.display_name ?? null}
        isCommissioner={!!me?.is_commissioner}
        isSiteOwner={!!me?.is_site_owner}
      />
    </View>
  );
}

function AccountMenu({ visible, onClose, name, isCommissioner, isSiteOwner }: { visible: boolean; onClose: () => void; name: string | null; isCommissioner: boolean; isSiteOwner: boolean }) {
  const insets = useSafeAreaInsets();
  const items: { label: string; href: Href }[] = [
    { label: 'Settings', href: '/settings' },
    { label: 'Notifications', href: { pathname: '/settings', params: { section: 'notifications' } } },
    { label: 'My Bets', href: '/bets' },
    { label: 'Leagues', href: '/leagues' },
    ...(isCommissioner ? [{ label: 'Commissioner Tools', href: '/commissioner' as Href }] : []),
    ...(isSiteOwner ? [{ label: 'Admin', href: '/admin' as Href }] : []),
    { label: 'Send feedback', href: { pathname: '/settings', params: { section: 'feedback' } } },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <View style={[styles.menu, { marginTop: insets.top + 50 }]} accessibilityViewIsModal>
          {name && <Text style={styles.menuName}>{name}</Text>}
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onClose();
                router.push(item.href);
              }}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              accessibilityRole="button">
              <Text style={styles.menuText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: 6 },
  league: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(18,21,29,0.9)',
  },
  leagueName: { color: Colors.text, fontFamily: Fonts.display, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', flexShrink: 1 },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,21,29,0.9)' },
  avatarText: { color: Colors.text, fontSize: 12, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'flex-end', paddingHorizontal: Spacing.lg },
  menu: { minWidth: 220, borderRadius: Radius.lg, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 6, overflow: 'hidden' },
  menuName: { color: Colors.textSecondary, fontSize: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12 },
  menuItemPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  menuText: { color: Colors.text, fontSize: 15, fontWeight: '600' },
});
