import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Kicker, NeonButton, Segments, StartScreen, Sub, Title } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';

export type GenderChoice = 'male' | 'female' | 'none';

export const GENDER_OPTIONS: { key: GenderChoice; label: string }[] = [
  { key: 'male', label: 'Male' },
  { key: 'female', label: 'Female' },
  { key: 'none', label: 'Prefer not to say' },
];

// The one-time About you step (2026-11-10), over everything once
// signed in until it's answered: a birthday that keeps under-13s out
// (only the year is kept) and the gender the recaps write with. Typed
// boxes, not a date wheel, so it ships without a new native build.
// Under 13 signs the phone out (lib/api.ts's under_13 handling).
export function AboutYou() {
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [gender, setGender] = useState<GenderChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dayRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  const typed = month.length > 0 && day.length > 0 && year.length === 4;

  async function save() {
    if (!typed || m < 1 || m > 12 || d < 1 || d > 31) {
      setError('Enter your birthday as month, day and year.');
      haptics.error();
      return;
    }
    if (gender === null) {
      setError('Pick one. Prefer not to say is fine.');
      haptics.error();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const birthdate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      await api.aboutYou({ birthdate, gender: gender === 'none' ? null : gender });
      haptics.success();
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      // under_13 already signed the phone out (lib/api.ts).
      if (!(e instanceof ApiError && e.message === 'under_13')) setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      setBusy(false);
    }
  }

  return (
    <Animated.View exiting={FadeOut.duration(250)} style={StyleSheet.absoluteFill}>
      <StartScreen footer={<NeonButton label="Done" onPress={() => void save()} busy={busy} incomplete={!typed || gender === null} />}>
        <View style={styles.head}>
          <Kicker>One quick thing</Kicker>
          <Title>About you</Title>
          <Sub>We ask once. Everyone here has to be 13 or older.</Sub>
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Your birthday</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.field, styles.part]}
              accessibilityLabel="Birth month"
              placeholder="MM"
              placeholderTextColor={Colors.textSecondary}
              value={month}
              onChangeText={(t) => {
                const v = t.replace(/\D/g, '').slice(0, 2);
                setMonth(v);
                if (v.length === 2) dayRef.current?.focus();
              }}
              keyboardType="number-pad"
              maxLength={2}
            />
            <TextInput
              ref={dayRef}
              style={[styles.field, styles.part]}
              accessibilityLabel="Birth day"
              placeholder="DD"
              placeholderTextColor={Colors.textSecondary}
              value={day}
              onChangeText={(t) => {
                const v = t.replace(/\D/g, '').slice(0, 2);
                setDay(v);
                if (v.length === 2) yearRef.current?.focus();
              }}
              keyboardType="number-pad"
              maxLength={2}
            />
            <TextInput
              ref={yearRef}
              style={[styles.field, styles.year]}
              accessibilityLabel="Birth year"
              placeholder="YYYY"
              placeholderTextColor={Colors.textSecondary}
              value={year}
              onChangeText={(t) => setYear(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
            />
          </View>
          <Text style={styles.note}>We only keep the year.</Text>
        </View>

        <Segments label="You are" options={GENDER_OPTIONS} value={gender as GenderChoice} onChange={setGender} />
        <Text style={styles.note}>{"The weekly recaps use this so they get you right. If you'd rather not say, they'll use your name."}</Text>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </StartScreen>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm, marginBottom: Spacing.lg },
  group: { gap: Spacing.sm },
  label: { color: '#aab2bf', fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: Spacing.sm },
  part: { flex: 1 },
  year: { flex: 1.5 },
  field: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.tile, color: Colors.text, fontSize: 18, textAlign: 'center' },
  note: { color: '#8790a0', fontSize: 13, lineHeight: 18 },
  error: { color: '#f87171', fontSize: 14, fontWeight: '600' },
});
