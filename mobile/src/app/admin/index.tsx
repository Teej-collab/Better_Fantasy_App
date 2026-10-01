import { useQuery } from '@tanstack/react-query';
import { router, Stack, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminNav, useAdminBadges } from '@/components/admin/AdminNav';
import { AdminScreen, AdminSection, adminStyles as s, DonutChart, EmptyNote, LineChart, StatTile, TileGrid } from '@/components/admin/AdminUI';
import { Display, Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { eventLabel } from '@/lib/analyticsEvents';
import type { AdminBadges } from '@/lib/adminTypes';

const JOB_LABELS: Record<string, string> = {
  full_sync: 'Full ESPN Sync',
  live_sync: 'Live Sync',
  sleeper_player_sync: 'Player Database Sync',
  projected_points_sync: 'Projected Points Sync',
  weekly_compute: 'Weekly Scoring Compute',
};

const ACTIVITY_LABELS: Record<string, string> = {
  signup: 'New signup',
  league_created: 'League created',
  feedback: 'Feedback submitted',
};

function sinceLabel(iso: string | null): string {
  if (!iso) return "Collection hasn't started yet";
  return `Tracking since ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function jobAgo(iso: string | null): string {
  if (!iso) return 'Never run';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const MINUTE = 60_000;

// The web's /admin layout + Overview: the section grid, the 24-hour
// health strip, KPIs, activity chart, feature donut, recent activity,
// system health and alerts. Refreshes on the web's cadence.
export default function AdminHome() {
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Admin' }} />
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Admin</Text>
        <Text style={s.small}>The control room — usage, people, and app health.</Text>
      </View>
      <AdminNav />
      <Overview />
    </AdminScreen>
  );
}

function Overview() {
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.admin.overview(7), refetchInterval: MINUTE });
  const timeseries = useQuery({ queryKey: ['admin', 'timeseries'], queryFn: () => api.admin.timeseries(30), refetchInterval: MINUTE });
  const features = useQuery({ queryKey: ['admin', 'features', 30], queryFn: () => api.admin.features(30) });
  const activity = useQuery({ queryKey: ['admin', 'activity'], queryFn: () => api.admin.activity(15), refetchInterval: MINUTE });
  const alerts = useQuery({ queryKey: ['admin', 'alerts'], queryFn: api.admin.alerts, refetchInterval: MINUTE });
  const health = useQuery({ queryKey: ['admin', 'health'], queryFn: api.admin.systemHealth, refetchInterval: MINUTE });
  const online = useQuery({ queryKey: ['admin', 'online'], queryFn: api.admin.online, refetchInterval: 20_000 });

  const all = [overview, timeseries, features, activity, alerts, health, online];
  if (all.some((q) => q.isPending)) return <LoadingState />;
  if (!overview.data || !timeseries.data || !features.data || !activity.data || !alerts.data || !health.data || !online.data) {
    return <Text style={s.error}>Couldn&apos;t load the overview — try refreshing.</Text>;
  }
  const o = overview.data;
  const days = timeseries.data.days;
  const h = health.data;
  const ws = h.websocket_connections;
  const owners = online.data.owners;

  return (
    <>
      <HealthStrip />
      <Text style={s.small}>{sinceLabel(o.tracking_started_at)}</Text>
      <TileGrid>
        <StatTile label="Total Users" value={o.total_users.toLocaleString()} />
        <StatTile label={`New (${o.window_days}d)`} value={o.new_users.toLocaleString()} />
        <StatTile label={`Active (${o.window_days}d)`} value={o.active_users.toLocaleString()} />
        <StatTile label="Total Leagues" value={o.total_leagues.toLocaleString()} />
        <StatTile label={`Active Leagues (${o.window_days}d)`} value={o.active_leagues.toLocaleString()} />
        <StatTile label="Online Now" value={o.online_now.toLocaleString()} live />
      </TileGrid>

      <AdminSection title={`Activity Over Time (${timeseries.data.window_days}d)`}>
        <LineChart
          labels={days.map((d) => shortDay(d.day))}
          series={[
            { label: 'Events', color: '#39ff14', values: days.map((d) => d.events) },
            { label: 'Active users', color: '#22d3ee', values: days.map((d) => d.active_owners) },
            { label: 'Signups', color: '#f59e0b', values: days.map((d) => d.signups) },
          ]}
        />
        <Text style={s.tiny}>Real data — genuinely sparse this early on. Fills in as usage accumulates.</Text>
      </AdminSection>

      <AdminSection title="Feature Usage (30d)">
        <DonutChart
          slices={features.data.features.slice(0, 6).map((f) => ({ label: eventLabel(f.event_name), value: f.uses }))}
          centerLabel={`${features.data.features.reduce((sum, f) => sum + f.uses, 0)} uses`}
        />
      </AdminSection>

      <AdminSection title="Recent Activity">
        {activity.data.activity.length === 0 ? (
          <EmptyNote>Nothing yet.</EmptyNote>
        ) : (
          activity.data.activity.map((item, i) => (
            <View key={i} style={[s.between, styles.listRow, i > 0 && styles.divided]}>
              <Text style={[s.body, s.flex]}>
                <Text style={s.small}>{ACTIVITY_LABELS[item.kind]}:</Text> {item.label}
              </Text>
              <Text style={s.tiny}>{jobAgo(item.created_at)}</Text>
            </View>
          ))
        )}
      </AdminSection>

      <AdminSection title="System Health">
        <View style={s.between}>
          <Text style={s.body}>Database</Text>
          <View style={s.row}>
            <View style={[styles.dot, { backgroundColor: h.db.reachable ? '#10b981' : '#ef4444' }]} />
            <Text style={{ fontSize: 12, color: h.db.reachable ? '#10b981' : '#ef4444' }}>{h.db.reachable ? 'Healthy' : 'Unreachable'}</Text>
          </View>
        </View>
        <HealthRow label="Connection pool" value={`${h.db.pool_size - h.db.pool_idle}/${h.db.pool_max} in use`} />
        <HealthRow
          label="Live connections"
          value={`${ws.chat + ws.draft + ws.gamecast} (${ws.chat} chat, ${ws.draft} draft, ${ws.gamecast} gamecast)`}
        />
        <HealthRow
          label="Backend uptime"
          value={h.uptime_seconds < 3600 ? `${Math.round(h.uptime_seconds / 60)}m` : `${Math.round(h.uptime_seconds / 3600)}h`}
        />
        <View style={s.rule} />
        {Object.entries(JOB_LABELS).map(([name, label]) => (
          <View key={name} style={s.between}>
            <Text style={s.small}>{label}</Text>
            <Text style={[s.small, { color: Colors.text }]}>{jobAgo(h.jobs[name] ?? null)}</Text>
          </View>
        ))}
        {owners.length > 0 && (
          <>
            <View style={s.rule} />
            <Text style={s.small}>Online now ({owners.length})</Text>
            {owners.map((ow) => (
              <View key={ow.owner_id} style={s.row}>
                <View style={[styles.dotSm, { backgroundColor: '#10b981' }]} />
                <Text style={s.body}>{ow.display_name}</Text>
              </View>
            ))}
          </>
        )}
      </AdminSection>

      <AdminSection title="Alerts">
        {alerts.data.alerts.length === 0 ? (
          <EmptyNote>Nothing needs your attention.</EmptyNote>
        ) : (
          alerts.data.alerts.map((a, i) => (
            <View key={i} style={[s.row, styles.listRow, { alignItems: 'flex-start' }, i > 0 && styles.divided]}>
              <Text>{a.severity === 'warning' ? '⚠️' : 'ℹ️'}</Text>
              <Text style={[s.body, s.flex]}>{a.message}</Text>
            </View>
          ))
        )}
      </AdminSection>
    </>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.between}>
      <Text style={s.small}>{label}</Text>
      <Text style={[s.small, s.flex, s.right, { fontVariant: ['tabular-nums'] }]}>{value}</Text>
    </View>
  );
}

const STRIP: { key: keyof AdminBadges; label: string; href: Href }[] = [
  { key: 'crashes', label: 'Crashes', href: '/admin/crashes' },
  { key: 'errors', label: 'Errors', href: '/admin/errors' },
  { key: 'security', label: 'Failed sign-ins', href: '/admin/security' },
];

// The last 24 hours of app health at a glance — green when quiet.
function HealthStrip() {
  const badges = useAdminBadges().data;
  return (
    <View style={styles.strip}>
      {STRIP.map((item) => {
        const n = badges?.[item.key];
        const bad = n !== undefined && n > 0;
        return (
          <Pressable key={item.key} onPress={() => router.push(item.href)} style={[styles.stripTile, bad ? styles.stripBad : styles.stripGood]}>
            <Text style={styles.stripLabel} numberOfLines={1}>
              {item.label} · 24h
            </Text>
            <Display style={[styles.stripValue, { color: bad ? '#ef4444' : '#10b981' }]}>{n === undefined ? '–' : n}</Display>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: Colors.text, fontSize: 24, fontWeight: '600' },
  listRow: { paddingVertical: 6 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotSm: { width: 6, height: 6, borderRadius: 3 },
  strip: { flexDirection: 'row', gap: Spacing.sm },
  stripTile: { flex: 1, minWidth: 0, gap: 2, borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  stripGood: { borderColor: 'rgba(16,185,129,0.25)', backgroundColor: 'rgba(16,185,129,0.05)' },
  stripBad: { borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.1)' },
  stripLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  stripValue: { fontSize: 20, letterSpacing: 0, fontVariant: ['tabular-nums'] },
});
