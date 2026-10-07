import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommishScreen, ErrorText, errorMessage } from '@/components/commissioner/CommishUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { CatalogStat, PreviewPlayer, ScoringCatalog } from '@/lib/scoringCatalog';

// The scoring editor (2026-10, port of the web's ScoringRulesSection and
// the approved "League Types & Scoring" mockups): presets, tabs, every
// value editable, changed values in gold, a live preview of real
// players, and new rules from the catalog of every tracked stat.

const GOLD = '#f5c542';
const PRESETS: { key: string; label: string; rec: number }[] = [
  { key: 'ppr', label: 'PPR', rec: 1 },
  { key: 'half', label: 'Half', rec: 0.5 },
  { key: 'standard', label: 'Standard', rec: 0 },
];

export default function ScoringScreen() {
  const [catalog, setCatalog] = useState<ScoringCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .scoringCatalog()
      .then(setCatalog)
      .catch((e) => setLoadError(errorMessage(e, "Couldn't load scoring rules.")));
  }, []);

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Scoring' }} />
      {catalog ? <Editor catalog={catalog} /> : loadError ? <ErrorText>{loadError}</ErrorText> : <LoadingState />}
    </CommishScreen>
  );
}

function Editor({ catalog }: { catalog: ScoringCatalog }) {
  const initial = useMemo(
    () => Object.fromEntries(catalog.stats.filter((s) => s.value !== null).map((s) => [s.key, s.value as number])),
    [catalog],
  );
  const [saved, setSaved] = useState<Record<string, number>>(initial);
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [tab, setTab] = useState('passing');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<{ week: number | null; players: PreviewPlayer[] } | null>(null);
  const changed = Object.keys(values).filter((k) => values[k] !== saved[k]);

  useEffect(() => {
    const id = setTimeout(() => {
      api.scoringPreview(values).then(setPreview).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [values]);

  function set(key: string, value: number) {
    setValues((v) => ({ ...v, [key]: value }));
    setStatus(null);
  }

  async function save() {
    setBusy(true);
    try {
      await api.updateScoringRules(catalog.season, Object.fromEntries(changed.map((k) => [k, values[k]])));
      setSaved(values);
      haptics.success();
      setStatus({ ok: true, text: 'Saved' });
      void queryClient.invalidateQueries({ queryKey: ['scoring-rules'] });
    } catch (e) {
      setStatus({ ok: false, text: errorMessage(e, "Couldn't save scoring rules.") });
    } finally {
      setBusy(false);
    }
  }

  const showIdp = catalog.idp || catalog.stats.some((s) => s.idp && values[s.key] !== undefined);
  const groups = catalog.groups.filter((g) => g.key !== 'defenders' || showIdp);
  const rows = catalog.stats.filter((s) => s.group === tab && values[s.key] !== undefined);
  const preset = PRESETS.find((p) => values.rec === p.rec)?.key ?? null;

  return (
    <View style={styles.gap}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>Scoring</Text>
          <Text style={styles.muted}>{catalog.season} season. Changes count from the current week on; past weeks keep their scores.</Text>
        </View>
        <Pressable
          onPress={save}
          disabled={busy || changed.length === 0}
          style={[styles.save, (busy || changed.length === 0) && styles.dim]}
          accessibilityRole="button">
          <Text style={styles.saveText}>{busy ? 'Saving…' : changed.length ? `Save ${changed.length}` : 'Saved'}</Text>
        </Pressable>
      </View>
      {status && <Text style={{ color: status.ok ? Colors.win : Colors.loss, fontSize: 13 }}>{status.text}</Text>}

      <View style={styles.gapSm}>
        <Text style={styles.kicker}>Start from</Text>
        <View style={styles.presets}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => {
                haptics.select();
                set('rec', p.rec);
              }}
              style={[styles.preset, preset === p.key && styles.presetOn]}>
              <Text style={[styles.presetText, preset === p.key && styles.presetTextOn]}>{p.label}</Text>
            </Pressable>
          ))}
          <View style={[styles.preset, preset === null && styles.presetOn]}>
            <Text style={[styles.presetText, preset === null && styles.presetTextOn]}>Custom</Text>
          </View>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {groups.map((g) => (
          <Pressable
            key={g.key}
            onPress={() => {
              haptics.select();
              setTab(g.key);
            }}
            style={[styles.tab, tab === g.key && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === g.key }}>
            <Text style={[styles.tabText, tab === g.key && styles.tabTextOn]}>{g.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View>
        {rows.length === 0 && <Text style={styles.muted}>Nothing here is scored yet. Add a rule below.</Text>}
        {rows.map((s) => (
          <RuleRow key={s.key} stat={s} value={values[s.key]} changed={values[s.key] !== saved[s.key]} onChange={(v) => set(s.key, v)} />
        ))}
      </View>

      <PreviewCard preview={preview} />

      <Pressable onPress={() => setAdding(true)} style={styles.addButton} accessibilityRole="button">
        <Text style={styles.addButtonText}>+ Add a scoring rule</Text>
      </Pressable>

      <AddRuleSheet
        visible={adding}
        stats={catalog.stats.filter((s) => values[s.key] === undefined && (!s.idp || showIdp))}
        onAdd={(s) => {
          set(s.key, 1);
          setTab(s.group);
        }}
        onClose={() => setAdding(false)}
      />
    </View>
  );
}

function RuleRow({ stat, value, changed, onChange }: { stat: CatalogStat; value: number; changed: boolean; onChange: (v: number) => void }) {
  // Kept as text while typing so "-0." and "1.5" can be entered.
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <View style={styles.rule}>
      <View style={styles.flex}>
        <Text style={styles.ruleLabel}>
          {stat.label}
          {!stat.tracked && <Text style={styles.untracked}>  NOT TRACKED YET</Text>}
        </Text>
        <Text style={styles.small}>{stat.hint}</Text>
      </View>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          const n = Number(t);
          if (t.trim() !== '' && !Number.isNaN(n)) onChange(n);
        }}
        keyboardType="numbers-and-punctuation"
        accessibilityLabel={stat.label}
        style={[styles.value, changed && styles.valueChanged, !changed && value < 0 && { color: Colors.loss }]}
      />
    </View>
  );
}

function PreviewCard({ preview }: { preview: { week: number | null; players: PreviewPlayer[] } | null }) {
  return (
    <View style={styles.preview}>
      <View style={styles.previewHead}>
        <Text style={styles.small}>Live preview{preview?.week ? ` · Week ${preview.week}` : ''}</Text>
        <Text style={styles.small}>real players</Text>
      </View>
      {!preview?.players.length && <Text style={styles.small}>Scores show here once a week has been played.</Text>}
      {preview?.players.map((p) => {
        const delta = Math.round((p.after - p.before) * 100) / 100;
        return (
          <View key={p.sleeper_player_id} style={styles.previewRow}>
            <View style={styles.flex}>
              <Text style={styles.previewName} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={styles.small}>
                {p.position}
                {p.pro_team ? ` · ${p.pro_team}` : ''}
              </Text>
            </View>
            <View style={styles.previewPts}>
              <Text style={styles.big}>{p.after.toFixed(1)}</Text>
              {delta !== 0 && (
                <Text style={styles.delta}>
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(1)}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function AddRuleSheet({ visible, stats, onAdd, onClose }: { visible: boolean; stats: CatalogStat[]; onAdd: (s: CatalogStat) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const q = query.trim().toLowerCase();
  const matches = stats.filter((s) => !q || s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q) || s.group.includes(q));
  const tracked = matches.filter((s) => s.tracked || added.includes(s.key));
  const untracked = matches.filter((s) => !s.tracked);

  function request(key: string, message: string) {
    api
      .requestScoringStat(message)
      .then(() => {
        haptics.success();
        setRequested((r) => [...r, key]);
      })
      .catch(() => {});
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]} onPress={() => {}}>
          <View style={styles.grab} />
          <View style={styles.headRow}>
            <Text style={styles.sheetTitle}>Add a scoring rule</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search stats, e.g. tackle" placeholderTextColor={Colors.textSecondary} style={styles.search} autoCorrect={false} />
          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            {tracked.length > 0 && <Text style={styles.kicker}>Tracked · adds right away</Text>}
            {tracked.map((s) => {
              const isAdded = added.includes(s.key);
              return (
                <View key={s.key} style={styles.result}>
                  <View style={styles.flex}>
                    <Text style={styles.ruleLabel}>{s.label}</Text>
                    <Text style={styles.small}>{s.hint}</Text>
                  </View>
                  <Pressable
                    disabled={isAdded}
                    onPress={() => {
                      haptics.select();
                      onAdd(s);
                      setAdded((a) => [...a, s.key]);
                    }}
                    style={styles.addChip}>
                    <Text style={styles.addChipText}>{isAdded ? 'Added ✓' : 'Add'}</Text>
                  </Pressable>
                </View>
              );
            })}
            {untracked.length > 0 && <Text style={[styles.kicker, { marginTop: Spacing.md }]}>Not tracked yet</Text>}
            {untracked.map((s) => (
              <View key={s.key} style={[styles.result, styles.dim]}>
                <View style={styles.flex}>
                  <Text style={styles.ruleLabel}>{s.label}</Text>
                  <Text style={styles.small}>We don&apos;t record this one yet</Text>
                </View>
                <Pressable disabled={requested.includes(s.key)} onPress={() => request(s.key, s.label)} style={styles.requestChip}>
                  <Text style={styles.requestText}>{requested.includes(s.key) ? 'Requested' : 'Request'}</Text>
                </Pressable>
              </View>
            ))}
            <Text style={[styles.ruleLabel, { marginTop: Spacing.md }]}>Don&apos;t see it?</Text>
            <View style={styles.customRow}>
              <TextInput value={custom} onChangeText={setCustom} placeholder="e.g. first downs" placeholderTextColor={Colors.textSecondary} style={[styles.search, styles.flex]} />
              <Pressable
                disabled={!custom.trim() || requested.includes('custom:' + custom.trim())}
                onPress={() => request('custom:' + custom.trim(), custom.trim())}
                style={[styles.requestChip, !custom.trim() && styles.dim]}>
                <Text style={styles.requestText}>{requested.includes('custom:' + custom.trim()) ? 'Requested' : 'Request'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.lg },
  gapSm: { gap: Spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.5 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { color: Colors.text, fontSize: 20, fontWeight: '700' },
  muted: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  small: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 6 },
  save: { backgroundColor: Colors.accent, borderRadius: Radius.pill, paddingHorizontal: 16, paddingVertical: 9 },
  saveText: { color: '#06110a', fontWeight: '800', fontSize: 14 },
  presets: { flexDirection: 'row', gap: Spacing.sm },
  preset: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  presetOn: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.12)' },
  presetText: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  presetTextOn: { color: Colors.accent },
  tabs: { gap: 6 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.pill, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface },
  tabOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tabText: { color: '#aab2bf', fontSize: 12.5, fontWeight: '600' },
  tabTextOn: { color: '#06110a' },
  rule: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  ruleLabel: { color: Colors.text, fontSize: 14.5, fontWeight: '500' },
  untracked: { color: '#f59e0b', fontSize: 10, fontWeight: '800' },
  value: { minWidth: 76, textAlign: 'center', color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 15, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 9, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.tile },
  valueChanged: { borderColor: GOLD, color: GOLD },
  preview: { gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,197,66,0.4)', backgroundColor: 'rgba(245,197,66,0.06)' },
  previewHead: { flexDirection: 'row', justifyContent: 'space-between' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  previewName: { color: Colors.text, fontSize: 14.5, fontWeight: '700' },
  previewPts: { alignItems: 'flex-end' },
  big: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 18 },
  delta: { color: GOLD, fontFamily: Fonts.monoBold, fontSize: 12 },
  addButton: { minHeight: 50, borderRadius: 14, borderWidth: 2, borderColor: Colors.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,10,7,0.9)' },
  addButtonText: { color: Colors.accent, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', backgroundColor: '#151a21', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: Spacing.lg, gap: Spacing.md },
  grab: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#2a303a', alignSelf: 'center' },
  sheetTitle: { flex: 1, color: Colors.text, fontSize: 17, fontWeight: '700' },
  done: { color: Colors.accent, fontSize: 15, fontWeight: '600' },
  search: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: Colors.accent, backgroundColor: Colors.tile, color: Colors.text, paddingHorizontal: 12, fontSize: 15 },
  sheetList: { flexGrow: 0 },
  result: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: 12, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  addChip: { borderWidth: 1, borderColor: 'rgba(57,255,20,0.5)', borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  addChipText: { color: Colors.accent, fontWeight: '700', fontSize: 12.5 },
  requestChip: { borderWidth: 1, borderColor: '#2a303a', borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 6 },
  requestText: { color: '#aab2bf', fontWeight: '600', fontSize: 12 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 6, marginBottom: Spacing.md },
});
