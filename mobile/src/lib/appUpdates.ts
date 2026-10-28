import * as Updates from 'expo-updates';

// App updates on the first open (2026-10-28). By default an update
// downloads while the app is open and only runs on the next launch, so
// people saw new features one open late. Right after a launch (while
// the intro plays) this checks for one and, if it's there, restarts into
// it straight away. Later in a session it never restarts under you; the
// update waits for the next open.

const LAUNCH_WINDOW_MS = 8_000;

export async function applyUpdateOnLaunch(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  const started = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    // Slow connection: too late to restart without yanking someone
    // mid-tap. It's downloaded, so the next open has it.
    if (!fetched.isNew || Date.now() - started > LAUNCH_WINDOW_MS) return;
    await Updates.reloadAsync();
  } catch {
    // Offline or the update server is down: carry on with this version.
  }
}
