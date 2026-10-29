import { useQuery } from '@tanstack/react-query';
import { router, Stack, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ADMIN_PURPLE, AdminRowIcon, InboxCard, needsMe, useInbox } from '@/components/admin/AdminInbox';
import { RunJobs } from '@/components/admin/AdminJobs';
import { AdminScreen, useAdminBadges } from '@/components/admin/AdminUI';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';

// Admin home (2026-10-28, the approved mix of the mockups): "Needs you"
// from the inbox and "Run a job" on top (A), then every admin page as a
// grouped list like Settings, each row showing its live number (C).

const ICONS = {
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6H3v-6z',
  live: 'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  chart: 'M4 20v-8M10 20V5M16 20v-6M21.5 20H2.5',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  tap: 'M9 11V5a2 2 0 0 1 4 0v6M13 10a2 2 0 0 1 4 0v4a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.3-2.5L4 14.6a1.8 1.8 0 0 1 3-1.9L9 15',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  people: 'M16 20c0-2.8-2.7-5-6-5s-6 2.2-6 5M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 20c0-2-1.2-3.7-3-4.5M16 3.5a4 4 0 0 1 0 7',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  warn: 'M12 8v5M12 16.5v.5M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  lock: 'M5 11h14v10H5zM8 11V7.5a4 4 0 0 1 8 0V11',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  brain: 'M12 4a3 3 0 0 0-5.6 1.5A3 3 0 0 0 4 10a3 3 0 0 0 1 5.5A3 3 0 0 0 9 20a3 3 0 0 0 3-1.5M12 4a3 3 0 0 1 5.6 1.5A3 3 0 0 1 20 10a3 3 0 0 1-1 5.5A3 3 0 0 1 15 20a3 3 0 0 1-3-1.5M12 4v14.5',
  pulse: 'M3 12h4l3-7 4 14 3-7h4',
  money: 'M12 3v18M16.3 7.4C15.7 5.9 14.1 5 12 5c-2.5 0-4.3 1.3-4.3 3.1 0 4.3 8.6 2.4 8.6 6.6 0 1.9-1.8 3.2-4.3 3.2-2.3 0-4-1-4.5-2.6',
} as const;

type Row = { label: string; href: Href; icon: keyof typeof ICONS; color: string; keywords: string; value?: string; alert?: number };

export default function AdminHome() {
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Admin' }} />
      <Home />
    </AdminScreen>
  );
}

function Home() {
  const inbox = useInbox();
  const badges = useAdminBadges().data;
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.admin.overview(7), refetchInterval: 60_000 }).data;
  const ai = useQuery({ queryKey: ['admin', 'ai-usage', 30], queryFn: () => api.admin.aiUsage(30) }).data;
  const waitlist = useQuery({ queryKey: ['admin', 'waitlist'], queryFn: api.admin.waitlist }).data;
  const [query, setQuery] = useState('');

  const needs = needsMe(inbox.data);
  const health = badges ? badges.crashes + badges.errors : undefined;
  const status =
    health === undefined ? '' : health === 0 && needs.length === 0 ? 'All systems normal' : needs.length > 0 ? `${needs.length} ${needs.length === 1 ? 'thing needs' : 'things need'} a person` : 'Some errors today';

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: 'RIGHT NOW',
      rows: [
        { label: 'Inbox', href: '/admin/inbox' as Href, icon: 'inbox', color: ADMIN_PURPLE, keywords: 'claim feedback join requests', alert: needs.length },
        { label: 'Live', href: '/admin/live', icon: 'live', color: '#30d158', keywords: 'online now who', value: overview ? `${overview.online_now} online` : undefined },
        { label: 'Engagement', href: '/admin/engagement', icon: 'chart', color: '#0a84ff', keywords: 'active retention dau wau', value: overview ? `${overview.active_users} this week` : undefined },
        { label: 'Navigation', href: '/admin/navigation', icon: 'map', color: '#5e5ce6', keywords: 'screens pages paths heatmap' },
        { label: 'Taps', href: '/admin/taps' as Href, icon: 'tap', color: '#5e5ce6', keywords: 'buttons taps' },
        { label: 'Recaps', href: '/admin/recaps', icon: 'film', color: '#ff9f0a', keywords: 'weekly recap readers push' },
      ],
    },
    {
      title: 'PEOPLE',
      rows: [
        { label: 'Users', href: '/admin/users', icon: 'people', color: '#ff9500', keywords: 'accounts members admin access', value: overview?.total_users.toString() },
        { label: 'Leagues', href: '/admin/leagues', icon: 'trophy', color: '#0a84ff', keywords: 'league members', value: overview?.total_leagues.toString() },
        { label: 'Waitlist', href: '/admin/waitlist' as Href, icon: 'clock', color: '#ffd60a', keywords: 'signups commissioners invites', value: waitlist?.count.toString() },
      ],
    },
    {
      title: 'APP HEALTH',
      rows: [
        { label: 'Errors', href: '/admin/errors', icon: 'warn', color: '#ff3b30', keywords: 'bugs exceptions', alert: badges?.errors, value: badges?.errors === 0 ? 'None today' : undefined },
        { label: 'Crashes', href: '/admin/crashes', icon: 'bolt', color: '#ff2d55', keywords: 'app crash', alert: badges?.crashes, value: badges?.crashes === 0 ? 'None today' : undefined },
        { label: 'Sign-ins & security', href: '/admin/security', icon: 'lock', color: '#8e8e93', keywords: 'failed login password ip', value: badges ? (badges.security === 0 ? 'Quiet' : `${badges.security} failed today`) : undefined },
        { label: 'Audit log', href: '/admin/audit', icon: 'list', color: '#8e8e93', keywords: 'who changed what history' },
        { label: 'Brain', href: '/admin/brain', icon: 'brain', color: '#bf5af2', keywords: 'ai narrative memory' },
        { label: 'Charts & system health', href: '/admin/overview' as Href, icon: 'pulse', color: '#32ade6', keywords: 'overview database uptime jobs alerts activity feature usage' },
      ],
    },
    {
      title: 'MONEY',
      rows: [{ label: 'AI costs', href: '/admin/ai-costs' as Href, icon: 'money', color: '#30b456', keywords: 'anthropic claude spend tokens', value: ai ? `$${ai.total_cost.toFixed(2)} · 30d` : undefined }],
    },
  ];

  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => !q || `${r.label} ${r.keywords}`.toLowerCase().includes(q)) }))
    .filter((g) => g.rows.length > 0);

  return (
    <View style={styles.home}>
      <View style={styles.titleRow}>
        <Display style={styles.title}>Admin</Display>
        {status ? (
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: health === 0 && needs.length === 0 ? '#30d158' : '#ff9f0a' }]} />
            <Text style={styles.statusText}>{status}</Text>
          </View>
        ) : null}
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search: errors, waitlist, AI…"
        placeholderTextColor={Colors.textSecondary}
        clearButtonMode="while-editing"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search admin"
        style={styles.search}
      />

      {!q && needs.length > 0 && inbox.data && (
        <View style={[styles.card, styles.needsCard]}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardTitle, { color: '#ff9f0a' }]}>NEEDS YOU · {needs.length}</Text>
            <Pressable onPress={() => router.push('/admin/inbox' as Href)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>
          {needs.slice(0, 3).map((item) => (
            <InboxCard key={`${item.kind}:${item.ref}`} item={item} me={inbox.data.me} compact />
          ))}
        </View>
      )}

      {!q && (
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: ADMIN_PURPLE }]}>RUN A JOB</Text>
          <RunJobs />
        </View>
      )}

      {shown.length === 0 && <Text style={styles.empty}>Nothing matches “{query.trim()}”.</Text>}
      {shown.map((g) => (
        <View key={g.title} style={styles.group}>
          <Text style={styles.groupTitle}>{g.title}</Text>
          <View style={styles.list}>
            {g.rows.map((r, i) => (
              <Pressable
                key={r.label}
                onPress={() => {
                  haptics.select();
                  router.push(r.href);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}${r.alert ? `, ${r.alert} new` : r.value ? `, ${r.value}` : ''}`}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}>
                <AdminRowIcon d={ICONS[r.icon]} color={r.color} />
                <Text style={styles.label}>{r.label}</Text>
                {r.alert ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{r.alert > 99 ? '99+' : r.alert}</Text>
                  </View>
                ) : r.value ? (
                  <Text style={styles.value} numberOfLines={1}>
                    {r.value}
                  </Text>
                ) : null}
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  home: { gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  title: { color: Colors.text, fontSize: 32 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  statusText: { color: Colors.textSecondary, fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  search: { minHeight: 44, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, color: Colors.text, fontSize: 15, paddingHorizontal: 12 },
  card: { gap: 10, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: 14 },
  needsCard: { borderColor: 'rgba(255,159,10,0.5)', gap: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  seeAll: { color: Colors.textSecondary, fontSize: 13 },
  empty: { color: Colors.textSecondary, fontSize: 14 },
  group: { gap: 6 },
  groupTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, paddingLeft: 4 },
  list: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 14, paddingVertical: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: Colors.border },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  label: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '500' },
  value: { maxWidth: 150, color: Colors.textSecondary, fontSize: 13, textAlign: 'right' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: '#ff3b30', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  chevron: { color: Colors.textSecondary, fontSize: 20 },
});
