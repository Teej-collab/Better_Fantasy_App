import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ADMIN_ACCENT } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import type { AdminBadges } from '@/lib/adminTypes';

type Section = { href: Href; label: string; icon: string; badge?: keyof AdminBadges };

// Same groups, labels and icons as the web's AdminNav. The red counts
// are the last 24 hours (GET /admin/badges).
const GROUPS: { title: string; sections: Section[] }[] = [
  {
    title: 'Usage',
    sections: [
      { href: '/admin/live', label: 'Live', icon: '◍' },
      { href: '/admin/engagement', label: 'Engagement', icon: '◭' },
      { href: '/admin/navigation', label: 'Navigation', icon: '◉' },
      { href: '/admin/recaps', label: 'Recaps', icon: '◧' },
    ],
  },
  {
    title: 'People',
    sections: [
      { href: '/admin/users', label: 'Users', icon: '◐' },
      { href: '/admin/leagues', label: 'Leagues', icon: '◆' },
    ],
  },
  {
    title: 'Health',
    sections: [
      { href: '/admin/crashes', label: 'Crashes', icon: '◬', badge: 'crashes' },
      { href: '/admin/errors', label: 'Errors', icon: '◮', badge: 'errors' },
      { href: '/admin/security', label: 'Security', icon: '◘', badge: 'security' },
      { href: '/admin/audit', label: 'Audit Log', icon: '◫' },
    ],
  },
];

export function useAdminBadges() {
  return useQuery({ queryKey: ['admin', 'badges'], queryFn: api.admin.badges, refetchInterval: 60_000 });
}

export function AdminNav() {
  const badges = useAdminBadges().data;
  return (
    <View style={styles.nav}>
      {GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.grid}>
            {group.sections.map((s) => {
              const count = s.badge && badges ? badges[s.badge] : 0;
              return (
                <Pressable key={s.label} onPress={() => router.push(s.href)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
                  <Text style={styles.icon}>{s.icon}</Text>
                  <Text style={styles.label} numberOfLines={1}>
                    {s.label}
                  </Text>
                  {count > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { gap: Spacing.md },
  group: { gap: 4 },
  groupTitle: { paddingHorizontal: 4, color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  link: {
    flexBasis: '32%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.tileRaised,
  },
  pressed: { backgroundColor: 'rgba(56,189,248,0.15)' },
  icon: { color: ADMIN_ACCENT, fontSize: 12 },
  label: { flex: 1, color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: '500' },
  badge: { borderRadius: Radius.pill, backgroundColor: '#ef4444', paddingHorizontal: 6, minWidth: 18, alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 16, fontVariant: ['tabular-nums'] },
});

