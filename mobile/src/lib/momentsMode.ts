import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Which Lounge moments you want (2026-10-29), yours alone on this phone:
// everything, only plays for or against you, or only the big ones (the
// takeovers, the TV's touchdowns and your bets cashing).
export type MomentsMode = 'all' | 'mine' | 'big';

const KEY = 'wl:lounge-moments-mode';
let current: MomentsMode = 'all';
const listeners = new Set<() => void>();

AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === 'all' || v === 'mine' || v === 'big') {
      current = v;
      listeners.forEach((fn) => fn());
    }
  })
  .catch(() => {});

export function useMomentsMode(): MomentsMode {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

export function setMomentsMode(mode: MomentsMode) {
  current = mode;
  listeners.forEach((fn) => fn());
  AsyncStorage.setItem(KEY, mode).catch(() => {});
}
