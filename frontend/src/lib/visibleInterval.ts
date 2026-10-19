// setInterval that only runs while the page is on screen — the
// GameDayRefresher / AdminLive pattern (the 2026-09 battery pass),
// shared. A background tab or a backgrounded phone browser stops
// polling; coming back runs `fn` once straight away to catch up, then
// resumes the beat. Returns the cleanup, for use inside an effect.
export function startVisibleInterval(fn: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  let missed = document.visibilityState !== "visible";
  function sync() {
    if (document.visibilityState === "visible") {
      if (id === null) {
        if (missed) fn();
        missed = false;
        id = setInterval(fn, ms);
      }
    } else if (id !== null) {
      clearInterval(id);
      id = null;
      missed = true;
    }
  }
  sync();
  document.addEventListener("visibilitychange", sync);
  return () => {
    document.removeEventListener("visibilitychange", sync);
    if (id !== null) clearInterval(id);
  };
}
