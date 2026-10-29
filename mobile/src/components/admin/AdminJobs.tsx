import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ADMIN_PURPLE } from '@/components/admin/AdminInbox';
import { relativeTime } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { Colors, Radius } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { haptics } from '@/lib/haptics';

// "Run a job" (2026-10-28, mockup A): the server jobs that used to be
// API-only, one tap each, with when each last ran. Live scores is left
// out on purpose: run outside a game it can misread 0-point starters as
// chugs (backend /admin/weekly-team-stats docstring).
export const JOBS = [
  { key: 'full_sync', label: 'Sync ESPN', path: '/admin/sync', what: 'Pulls League 1 from ESPN: teams, rosters, scores. Can take a minute or two.' },
  { key: 'weekly_compute', label: 'Weekly scoring', path: '/admin/weekly-compute', what: "Recomputes this week's scores from real stats." },
  { key: 'sleeper_player_sync', label: 'Player database', path: '/admin/players/sync', what: 'Refreshes every NFL player from Sleeper.' },
  { key: 'projected_points_sync', label: 'Projections', path: '/admin/players/sync-projections', what: "Refreshes ESPN's projected points." },
] as const;

export function useSystemHealth() {
  return useQuery({ queryKey: ['admin', 'health'], queryFn: api.admin.systemHealth, refetchInterval: 60_000 });
}

export function lastRunLabel(iso: string | undefined): string {
  return iso ? `Last: ${relativeTime(iso)}` : 'Not run since restart';
}

export function RunJobs() {
  const queryClient = useQueryClient();
  const jobs = useSystemHealth().data?.jobs ?? {};
  const [running, setRunning] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (job: (typeof JOBS)[number]) => api.admin.runJob(job.path),
    onMutate: (job) => setRunning(job.key),
    onSuccess: (_data, job) => {
      haptics.success();
      Alert.alert(`${job.label} finished`);
    },
    onError: (e, job) => {
      haptics.error();
      const message =
        e instanceof ApiError && e.status === 403 ? "Only League 1's commissioner can run jobs." : e instanceof Error ? e.message : 'Something went wrong.';
      Alert.alert(`${job.label} didn't run`, message);
    },
    onSettled: () => {
      setRunning(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'health'] });
    },
  });

  const confirm = (job: (typeof JOBS)[number]) => {
    haptics.select();
    Alert.alert(`Run ${job.label}?`, job.what, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Run it', onPress: () => run.mutate(job) },
    ]);
  };

  return (
    <View style={styles.grid}>
      {JOBS.map((job) => (
        <Pressable
          key={job.key}
          onPress={() => confirm(job)}
          disabled={running !== null}
          accessibilityRole="button"
          accessibilityLabel={`Run ${job.label}. ${lastRunLabel(jobs[job.key])}`}
          style={({ pressed }) => [styles.job, pressed && styles.pressed, running !== null && running !== job.key && styles.dim]}>
          <View style={styles.jobHead}>
            <Text style={styles.jobLabel}>{job.label}</Text>
            {running === job.key && <ActivityIndicator size="small" color={ADMIN_PURPLE} />}
          </View>
          <Text style={styles.jobLast}>{running === job.key ? 'Running…' : lastRunLabel(jobs[job.key])}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  job: { flexBasis: '47%', flexGrow: 1, minHeight: 58, gap: 2, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 10, paddingVertical: 8 },
  jobHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobLabel: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  jobLast: { color: Colors.textSecondary, fontSize: 11 },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.4 },
});
