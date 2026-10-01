import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, Divided, EmptyNote, formatWhen, Pill, StatTile, TileGrid, timeAgo, WindowPicker } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';

const KIND_LABELS: Record<string, string> = {
  login_failed: 'Failed sign-in',
  forbidden: 'Blocked request',
  rate_limited: 'Rate limited',
  invalid_token: 'Bad sign-in link',
};

const KIND_TONES: Record<string, 'bad' | 'warn' | 'default'> = {
  login_failed: 'bad',
  forbidden: 'warn',
  rate_limited: 'warn',
  invalid_token: 'bad',
};

// Port of the web's AdminSecurity.
export default function AdminSecurityScreen() {
  const [days, setDays] = useState(7);
  const q = useQuery({ queryKey: ['admin', 'security', days], queryFn: () => api.admin.security(days), placeholderData: keepPreviousData });
  const data = q.data;
  const count = (kind: string) => data?.by_kind.find((k) => k.kind === kind)?.events ?? 0;
  const failed = count('login_failed');

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Security' }} />
      <View style={s.between}>
        <Text style={[s.small, s.flex]}>10 failed sign-ins from one IP (or 5 on one account) in 15 minutes sends you a push alert.</Text>
        <WindowPicker value={days} onChange={setDays} disabled={q.isFetching} options={[1, 7, 30]} />
      </View>
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load security events.</Text>
      ) : (
        <>
          <TileGrid>
            <StatTile label="Failed sign-ins" value={failed} tone={failed >= 10 ? 'bad' : failed ? 'warn' : 'good'} />
            <StatTile label="Blocked requests" value={count('forbidden')} hint="403 — not allowed" />
            <StatTile label="Rate limited" value={count('rate_limited')} hint="429 — too many tries" />
            <StatTile label="Bad sign-in links" value={count('invalid_token')} />
          </TileGrid>

          <AdminSection title="Accounts Targeted" hint="Emails with failed sign-ins — normal for a mistyped password, suspicious from many IPs.">
            {data.targeted_accounts.length === 0 ? (
              <EmptyNote>No failed sign-ins.</EmptyNote>
            ) : (
              data.targeted_accounts.map((a, i) => (
                <Divided key={a.email} index={i}>
                  <View style={s.between}>
                    <View style={s.flex}>
                      <Text style={s.body}>{a.email}</Text>
                      <Text style={s.small}>
                        {a.real_account ? 'real account' : 'no such account'} · last {timeAgo(a.last_seen)}
                      </Text>
                    </View>
                    <View>
                      <Text style={[s.small, s.right]}>{a.failed_logins} fails</Text>
                      <Text style={[s.small, s.right]}>
                        {a.ips} IP{a.ips === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>
                </Divided>
              ))
            )}
          </AdminSection>

          <AdminSection title="Busiest IPs" hint="Where security events come from.">
            {data.top_ips.length === 0 ? (
              <EmptyNote>Nothing recorded.</EmptyNote>
            ) : (
              data.top_ips.map((ip, i) => (
                <Divided key={ip.ip} index={i}>
                  <View style={s.between}>
                    <View style={s.flex}>
                      <Text style={s.mono}>{ip.ip}</Text>
                      <Text style={s.small}>last {timeAgo(ip.last_seen)}</Text>
                    </View>
                    <View>
                      <Text style={[s.small, s.right]}>{ip.events} events</Text>
                      {ip.failed_logins > 0 && (
                        <Text style={[s.small, s.right, { color: '#ef4444' }]}>
                          {ip.failed_logins} failed · {ip.emails_tried} email{ip.emails_tried === 1 ? '' : 's'}
                        </Text>
                      )}
                    </View>
                  </View>
                </Divided>
              ))
            )}
          </AdminSection>

          <AdminSection title="Blocked Pages" hint="Which endpoints turned requests away, and why.">
            {data.top_paths.length === 0 ? (
              <EmptyNote>Nothing blocked.</EmptyNote>
            ) : (
              data.top_paths.map((p, i) => (
                <Divided key={`${p.path}-${p.kind}`} index={i}>
                  <View style={s.between}>
                    <View style={[s.row, s.flex, { flexWrap: 'wrap' }]}>
                      <Pill tone={KIND_TONES[p.kind] ?? 'default'}>{KIND_LABELS[p.kind] ?? p.kind}</Pill>
                      <Text style={s.mono}>{p.path}</Text>
                    </View>
                    <Text style={s.small}>{p.events}</Text>
                  </View>
                </Divided>
              ))
            )}
          </AdminSection>

          <AdminSection title="Recent Events">
            {data.recent.length === 0 ? (
              <EmptyNote>Nothing recorded in this window.</EmptyNote>
            ) : (
              data.recent.map((e, i) => (
                <Divided key={`${e.created_at}-${i}`} index={i}>
                  <View style={s.between}>
                    <View style={[s.row, s.flex, { flexWrap: 'wrap' }]}>
                      <Pill tone={KIND_TONES[e.kind] ?? 'default'}>{KIND_LABELS[e.kind] ?? e.kind}</Pill>
                      <Text style={s.body}>{e.email ?? e.who ?? 'Signed-out visitor'}</Text>
                    </View>
                    <Text style={s.small}>{formatWhen(e.created_at)}</Text>
                  </View>
                  <Text style={[s.mono, s.tiny]}>{[e.ip, e.method && e.path ? `${e.method} ${e.path}` : e.path].filter(Boolean).join(' · ')}</Text>
                </Divided>
              ))
            )}
          </AdminSection>
        </>
      )}
    </AdminScreen>
  );
}
