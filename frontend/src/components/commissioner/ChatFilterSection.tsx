"use client";

import { useEffect, useState } from "react";

// The league's own chat-filter words (2026-10). Slurs and hate speech are
// masked in every league already (backend app/moderation.py); these are
// extra words this league wants hidden too. Each change saves right away.
async function call(init?: RequestInit): Promise<{ words: string[] }> {
  const res = await fetch("/api/backend/league/chat-filter", {
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let detail = "Couldn't save the filter.";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Not JSON.
    }
    throw new Error(detail);
  }
  return res.json();
}

export function ChatFilterSection() {
  const [words, setWords] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call()
      .then((r) => setWords(r.words))
      .catch((e) => setError(e.message));
  }, []);

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      setWords((await call({ method: "PUT", body: JSON.stringify({ words: next }) })).words);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the filter.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const word = draft.trim().toLowerCase();
    if (!word || !words) return;
    if (/\s/.test(word)) return setError("One word at a time.");
    if (words.includes(word)) return setDraft("");
    if (await save([...words, word])) setDraft("");
  }

  if (words === null) {
    return <p className="text-sm text-black/50 dark:text-white/50">{error ?? "Loading…"}</p>;
  }

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
      <form onSubmit={(e) => void add(e)} className="flex gap-2">
        <label className="sr-only" htmlFor="filter-word">
          Word to filter
        </label>
        <input
          id="filter-word"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={40}
          placeholder="Add a word"
          className="h-10 min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 text-sm dark:border-white/15"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="h-10 rounded-lg bg-[var(--wl-accent)] px-4 text-sm font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add"}
        </button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {words.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No extra words yet — only the built-in list applies.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {words.map((word) => (
            <li key={word}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(words.filter((w) => w !== word))}
                aria-label={`Remove ${word}`}
                className="flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-sm dark:bg-white/10"
              >
                {word} <span className="text-black/40 dark:text-white/40">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
