import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

// Is the phone reaching the backend right now? Worked out from the app's
// own requests rather than a network-status library: a library would be
// native code, and an over-the-air update can't add that to installs
// that predate it. Any request that can't reach the server marks the app
// offline; any response at all (even an error) marks it back online.
// While offline it re-checks every few seconds and whenever the app
// comes back to the foreground.
//
// It also drives react-query's onlineManager, so screens stop retrying
// while offline and refetch everything the moment the connection returns.

type State = { online: boolean; lastOnlineAt: number | null };

let state: State = { online: true, lastOnlineAt: null };
const listeners = new Set<() => void>();
const PROBE_MS = 5000;
let probeTimer: ReturnType<typeof setInterval> | null = null;
let probeUrl: string | null = null;

function set(next: State) {
  if (next.online === state.online && next.lastOnlineAt === state.lastOnlineAt) return;
  state = next;
  onlineManager.setOnline(next.online);
  listeners.forEach((l) => l());
}

// When data last arrived ("showing data from 2:14 PM"). Kept out of
// `state` so a successful request doesn't re-render every banner; it's
// only copied in when the app actually goes offline.
let lastSuccessAt: number | null = null;

export function reportReachable() {
  lastSuccessAt = Date.now();
  if (state.online) return;
  set({ online: true, lastOnlineAt: lastSuccessAt });
  stopProbe();
}

export function reportUnreachable() {
  if (!state.online) return;
  set({ online: false, lastOnlineAt: lastSuccessAt });
  startProbe();
}

async function probe() {
  if (!probeUrl) return;
  try {
    await fetch(probeUrl, { method: 'GET' });
    reportReachable();
  } catch {
    // Still offline.
  }
}

function startProbe() {
  if (probeTimer) return;
  probeTimer = setInterval(probe, PROBE_MS);
}

function stopProbe() {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
}

// Called once by lib/api.ts with the backend's /health url.
export function initConnectivity(healthUrl: string) {
  probeUrl = healthUrl;
  AppState.addEventListener('change', (s) => {
    if (s === 'active' && !state.online) void probe();
  });
}

export function useConnectivity(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// A thrown fetch (as opposed to an HTTP error response) means the server
// couldn't be reached at all.
export function isNetworkFailure(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && e.name === 'AbortError');
}
