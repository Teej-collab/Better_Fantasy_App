import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { useActiveLeagueName, useMe, useMySettings } from '@/lib/queries';

// The bar across the top of every tab (2026-10 navigation pass): your
// league on the left — tap for the league picker (switch, join, or
// start one) — and you on
// the right, opening the account menu (Settings, Commissioner Tools,
// League Kitty, Help, Admin — the 2026-10-28 cleanup).
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

// The account menu (2026-10-28 cleanup, the approved mockup): who you
// are and your league up top, then five things. The Lounge, Friends and
// My Bets live on the grid button; notifications and feedback are in
// Settings and Help.
function AccountMenu({ visible, onClose, name, isCommissioner, isSiteOwner }: { visible: boolean; onClose: () => void; name: string | null; isCommissioner: boolean; isSiteOwner: boolean }) {
  const insets = useSafeAreaInsets();
  const team = useMySettings().data?.team_name ?? null;
  const leagueName = useActiveLeagueName().data;
  const kitty = useQuery({ queryKey: ['kitty'], queryFn: api.kitty, enabled: visible, staleTime: 60_000 }).data;
  const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
  const items: { label: string; sub: string; href: Href; color: string; glyph: string }[] = [
    { label: 'Settings', sub: 'You, alerts, look, account', href: '/settings', color: Colors.accent, glyph: 'S' },
    ...(isCommissioner ? [{ label: 'Commissioner Tools', sub: 'Run your league', href: '/commissioner' as Href, color: '#facc15', glyph: 'C' }] : []),
    {
      label: 'League Kitty',
      sub: kitty ? `${money(kitty.collected)} in · ${money(kitty.outstanding)} owed` : 'Who owes the pot',
      href: '/kitty' as Href,
      color: '#4ade80',
      glyph: '$',
    },
    { label: 'Help', sub: 'Glossary, tour, what’s new, feedback', href: { pathname: '/settings', params: { section: 'help' } }, color: '#4cc3ff', glyph: '?' },
    ...(isSiteOwner ? [{ label: 'Admin', sub: 'Only you', href: '/admin' as Href, color: '#c084fc', glyph: 'A' }] : []),
  ];
  function go(href: Href) {
    onClose();
    router.push(href);
  }
  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <View style={[styles.menu, { marginTop: insets.top + 50 }]} accessibilityViewIsModal>
          <View style={styles.menuHead}>
            <View style={[styles.menuAvatar, { borderColor: Colors.accent }]}>
              <Text style={styles.menuAvatarText}>{initials}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.menuNameBig} numberOfLines={1}>
                {name ?? 'You'}
              </Text>
              {team ? (
                <Text style={styles.menuSub} numberOfLines={1}>
                  {team}
                </Text>
              ) : null}
            </View>
          </View>
          <Pressable onPress={() => go('/leagues')} accessibilityRole="button" accessibilityLabel={`League: ${leagueName ?? 'none'}. Switch, invite or join`} style={({ pressed }) => [styles.leagueRow, pressed && styles.menuItemPressed]}>
            <View style={styles.flex}>
              <Text style={[styles.menuKicker, { color: Colors.accent }]}>LEAGUE</Text>
              <Text style={styles.menuText} numberOfLines={1}>
                {leagueName ?? 'Join or start one'}
              </Text>
            </View>
            <Text style={styles.menuSub}>Switch · invite</Text>
          </Pressable>
          {items.map((item, i) => (
            <Pressable
              key={item.label}
              onPress={() => go(item.href)}
              style={({ pressed }) => [styles.menuItem, i > 0 && styles.menuDivider, pressed && styles.menuItemPressed]}
              accessibilityRole="button"
              accessibilityHint={item.sub}>
              <View style={[styles.menuIcon, { backgroundColor: `${item.color}1f` }]}>
                <Text style={[styles.menuGlyph, { color: item.color }]}>{item.glyph}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.menuText}>{item.label}</Text>
                <Text style={styles.menuSub} numberOfLines={1}>
                  {item.sub}
                </Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
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
    minHeight: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(18,21,29,0.9)',
  },
  leagueName: { color: Colors.text, fontFamily: Fonts.display, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', flexShrink: 1 },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,21,29,0.9)' },
  avatarText: { color: Colors.text, fontSize: 12, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'flex-end', paddingHorizontal: Spacing.lg },
  menu: { width: 300, maxWidth: '100%', borderRadius: 22, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  menuAvatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e2430' },
  menuAvatarText: { color: Colors.text, fontFamily: Fonts.display, fontSize: 18 },
  menuNameBig: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  menuKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 16, backgroundColor: 'rgba(57,255,20,0.05)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16 },
  menuDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  menuItemPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  menuIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  menuGlyph: { fontSize: 13, fontWeight: '800' },
  menuText: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  menuSub: { color: Colors.textSecondary, fontSize: 12 },
  menuChevron: { color: '#5b6372', fontSize: 18 },
  flex: { flex: 1, minWidth: 0 },
});
