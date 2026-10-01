import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { useMe } from '@/lib/queries';

// Shared pieces for the Commissioner Tools screens (ports of the web's
// components/commissioner/*), so every tool looks the same.

// Every commissioner page shows this to anyone else (the backend
// enforces it too).
export function CommishGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <LoadingState />;
  if (!me.data?.is_commissioner) {
    return <MessageState message="Commissioner tools are only visible to your league's commissioner." />;
  }
  return <>{children}</>;
}

export function CommishScreen({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <CommishGate>{children}</CommishGate>
    </ScrollView>
  );
}

export function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.head}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.groupLabel}>{children}</Text>;
}

export function Input(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  decimal?: boolean;
  secure?: boolean;
  editable?: boolean;
  maxLength?: number;
  style?: StyleProp<TextStyle>;
  onSubmitEditing?: () => void;
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor="rgba(255,255,255,0.35)"
      keyboardType={props.decimal ? 'numbers-and-punctuation' : props.numeric ? 'number-pad' : 'default'}
      secureTextEntry={props.secure}
      editable={props.editable}
      maxLength={props.maxLength}
      autoCorrect={false}
      autoCapitalize="none"
      onSubmitEditing={props.onSubmitEditing}
      style={[styles.input, props.editable === false && styles.disabled, props.style]}
    />
  );
}

// A label on the left, a small input on the right (the web's
// label + w-20 number input rows).
export function NumberRow(props: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; decimal?: boolean; editable?: boolean; extra?: ReactNode }) {
  return (
    <View style={styles.numberRow}>
      <View style={styles.flex}>
        <Text style={styles.rowLabel}>{props.label}</Text>
        {props.hint && <Text style={styles.hint}>{props.hint}</Text>}
      </View>
      <Input
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        numeric
        decimal={props.decimal}
        editable={props.editable}
        style={styles.numberInput}
      />
      {props.extra}
    </View>
  );
}

export function PrimaryButton({ label, busyLabel, busy, disabled, onPress }: { label: string; busyLabel?: string; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const accent = useAppearance().accent;
  const off = busy || disabled;
  return (
    <Pressable onPress={onPress} disabled={off} style={[styles.primary, { backgroundColor: accent }, off && styles.disabled]}>
      {busy && !busyLabel ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>{busy ? busyLabel : label}</Text>}
    </Pressable>
  );
}

export function OutlineButton({ label, onPress, disabled, tone = 'default', small }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'default' | 'danger' | 'add' | 'warn'; small?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4} style={[styles.outline, small && styles.outlineSmall, toneBorder[tone], disabled && styles.disabled]}>
      <Text style={[styles.outlineText, toneText[tone]]}>{label}</Text>
    </Pressable>
  );
}

const toneBorder = StyleSheet.create({
  default: { borderColor: 'rgba(255,255,255,0.12)' },
  danger: { borderColor: 'rgba(239,68,68,0.35)' },
  add: { borderColor: 'rgba(16,185,129,0.45)' },
  warn: { borderColor: 'rgba(245,158,11,0.45)' },
});
const toneText = StyleSheet.create({
  default: { color: Colors.text },
  danger: { color: '#ef4444' },
  add: { color: '#34d399' },
  warn: { color: '#fbbf24' },
});

export type SaveStatus = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string };

export function StatusText({ panel }: { panel: SaveStatus }) {
  if (panel.status === 'saved') return <Text style={styles.saved}>Saved.</Text>;
  if (panel.status === 'error') return <Text style={styles.error}>{panel.message}</Text>;
  return null;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

// The web's <select>: a button showing the choice, opening a sheet.
export function Picker<T extends string | number>(props: {
  value: T | null;
  options: { value: T; label: string }[];
  placeholder: string;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const current = props.options.find((o) => o.value === props.value);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} disabled={props.disabled} style={[styles.picker, props.disabled && styles.disabled]}>
        <Text style={[styles.pickerText, !current && styles.placeholder]} numberOfLines={1}>
          {current?.label ?? props.placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{props.placeholder}</Text>
            <ScrollView style={styles.sheetList}>
              {props.options.map((o) => (
                <Pressable
                  key={String(o.value)}
                  onPress={() => {
                    setOpen(false);
                    props.onChange(o.value);
                  }}
                  style={styles.option}>
                  <Text style={[styles.optionText, o.value === props.value && styles.optionActive]}>{o.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// "2026-08-28 18:00" (local) ⇄ ISO — a text field standing in for the
// web's datetime-local input, same as the Keepers screen.
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(text: string): string | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return 'invalid';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}

export const commishStyles = StyleSheet.create({
  gap: { gap: Spacing.md },
  gapSm: { gap: Spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  label: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  body: { color: Colors.text, fontSize: 14 },
  bodySoft: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  bold: { color: Colors.text, fontWeight: '700' },
  medium: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  item: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  box: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: Spacing.md, gap: Spacing.sm },
  dangerBox: { borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.03)', padding: Spacing.md, gap: Spacing.sm },
  warnBox: { borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.05)', padding: Spacing.sm, gap: 6 },
  noteBox: { borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: Colors.tile, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: Spacing.md },
  warnText: { color: '#fbbf24', fontSize: 12 },
  danger: { color: '#ef4444', fontSize: 12 },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  flex: { flex: 1, minWidth: 0 },
  head: { gap: 4 },
  title: { color: Colors.text, fontSize: 18, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 20 },
  groupLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  input: { backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
  },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  numberInput: { width: 76, textAlign: 'right', fontVariant: ['tabular-nums'] },
  rowLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 16 },
  primary: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minWidth: 120, alignItems: 'center' },
  primaryText: { color: '#000', fontSize: 14, fontWeight: '600' },
  outline: { alignSelf: 'flex-start', borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  outlineSmall: { paddingHorizontal: 10, paddingVertical: 4 },
  outlineText: { fontSize: 12, fontWeight: '500' },
  disabled: { opacity: 0.4 },
  saved: { color: '#34d399', fontSize: 14 },
  error: { color: Colors.loss, fontSize: 14 },
  picker: { backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
  },
  pickerText: { flexShrink: 1, color: Colors.text, fontSize: 14 },
  placeholder: { color: 'rgba(255,255,255,0.45)' },
  chevron: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, backgroundColor: Colors.surface, paddingTop: Spacing.md },
  sheetTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  sheetList: { flexGrow: 0 },
  option: { paddingHorizontal: Spacing.lg, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  optionText: { color: Colors.text, fontSize: 16 },
  optionActive: { fontWeight: '700' },
});
