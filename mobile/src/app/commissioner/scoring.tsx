import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  CommishScreen,
  commishStyles as s,
  ErrorText,
  errorMessage,
  GroupLabel,
  NumberRow,
  PrimaryButton,
  SectionHead,
  StatusText,
  type SaveStatus,
} from '@/components/commissioner/CommishUI';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { humanizeStatCategory } from '@/lib/matchups';
import { queryClient, useScoringRulesEditor } from '@/lib/queries';
import type { ScoringRule } from '@/lib/types';

// Same grouping as the web's ScoringRulesSection: categories are flat
// strings in the DB, grouped here by prefix.
const GROUP_ORDER = ['Passing', 'Rushing', 'Receiving', 'Kicking', 'Defense', 'Points Allowed', 'Yards Allowed', 'Misc'];

function groupFor(key: string): string {
  if (key.startsWith('pass_')) return 'Passing';
  if (key.startsWith('rush_')) return 'Rushing';
  if (key.startsWith('rec')) return 'Receiving';
  if (key.startsWith('fg_') || key === 'xp_made') return 'Kicking';
  if (key === 'qb_tackle') return 'Passing';
  if (key.startsWith('def_')) return 'Defense';
  if (key.startsWith('pts_allow_')) return 'Points Allowed';
  if (key.startsWith('yds_allow_')) return 'Yards Allowed';
  return 'Misc';
}

const HINTS: Record<string, string> = {
  qb_tackle: "A QB's own tackle — e.g. after his own interception gets returned. The only position awarded points for a tackle in this league.",
};

export default function ScoringRulesScreen() {
  const q = useScoringRulesEditor();
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Scoring Rules' }} />
      {q.isPending ? (
        <LoadingState />
      ) : !q.data ? (
        <ErrorText>{errorMessage(q.error, "Couldn't load scoring rules.")}</ErrorText>
      ) : (
        <ScoringForm season={q.data.season} rules={q.data.rules} />
      )}
    </CommishScreen>
  );
}

function ScoringForm({ season, rules }: { season: number; rules: ScoringRule[] }) {
  // Kept as text while editing so "-0." and "1.5" can be typed.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rules.map((r) => [r.stat_category, String(r.points_per_unit)])),
  );
  const [panel, setPanel] = useState<SaveStatus>({ status: 'idle' });

  async function save() {
    const parsed: Record<string, number> = {};
    for (const [key, raw] of Object.entries(values)) {
      const n = Number(raw);
      if (raw.trim() === '' || Number.isNaN(n)) {
        setPanel({ status: 'error', message: `${humanizeStatCategory(key)} needs a number.` });
        return;
      }
      parsed[key] = n;
    }
    setPanel({ status: 'saving' });
    try {
      const { rules: updated } = await api.updateScoringRules(season, parsed);
      setValues(Object.fromEntries(updated.map((r) => [r.stat_category, String(r.points_per_unit)])));
      setPanel({ status: 'saved' });
      void queryClient.invalidateQueries({ queryKey: ['scoring-rules'] });
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't save scoring rules.") });
    }
  }

  const byGroup = new Map<string, string[]>();
  for (const key of Object.keys(values)) {
    const group = groupFor(key);
    byGroup.set(group, [...(byGroup.get(group) ?? []), key]);
  }

  return (
    <>
      <SectionHead
        title="Scoring Rules"
        subtitle={`Points per stat category for the ${season} season — changes apply immediately, including mid-season.`}
      />
      {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => (
        <View key={group} style={s.gapSm}>
          <GroupLabel>{group}</GroupLabel>
          {byGroup
            .get(group)!
            .sort()
            .map((key) => (
              <NumberRow
                key={key}
                label={humanizeStatCategory(key)}
                hint={HINTS[key]}
                value={values[key]}
                decimal
                onChange={(v) => {
                  setValues((prev) => ({ ...prev, [key]: v }));
                  setPanel({ status: 'idle' });
                }}
              />
            ))}
        </View>
      ))}
      <View style={s.row}>
        <PrimaryButton label="Save scoring rules" busyLabel="Saving…" busy={panel.status === 'saving'} onPress={save} />
        <StatusText panel={panel} />
      </View>
    </>
  );
}
