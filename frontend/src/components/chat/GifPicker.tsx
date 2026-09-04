"use client";

import { useEffect, useRef, useState } from "react";
import { GifSearchError, searchGifs, type ChatGif } from "@/lib/api";

const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_QUERY = "fantasy football";

export function GifPicker({ onSelect, onClose }: { onSelect: (gif: ChatGif) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<ChatGif[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unconfigured" | "error">("loading");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced live search — the empty-query case still runs (against a
  // fixed default term) so the picker never opens to a blank grid.
  // `cancelled` guards against a slower, now-stale request (an earlier
  // keystroke) resolving after a faster, more recent one and clobbering
  // its results — the debounce alone only stops firing a request per
  // keystroke, not out-of-order responses from ones already in flight.
  useEffect(() => {
    let cancelled = false;
    const term = query.trim() || DEFAULT_QUERY;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setStatus("loading");
      searchGifs(term)
        .then((results) => {
          if (cancelled) return;
          setGifs(results);
          setStatus("ready");
        })
        .catch((err) => {
          if (cancelled) return;
          setStatus(err instanceof GifSearchError && err.status === 503 ? "unconfigured" : "error");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  return (
    // z-40 — above BottomNav's fixed z-30 (components/nav/BottomNav.tsx):
    // on a short mobile viewport with the on-screen keyboard open, this
    // popover's own bottom edge can land in roughly the same screen band
    // the nav bar occupies; without this it visually got sliced in half
    // by the nav rendering on top of it. max-h-[60vh] keeps it from ever
    // demanding more vertical space than a keyboard-shrunk viewport
    // actually has.
    <div className="absolute bottom-full left-3 z-40 mb-1 flex h-80 max-h-[60vh] w-72 flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-black/10 p-2 dark:border-white/10">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs..."
          aria-label="Search GIFs"
          className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF search"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {status === "unconfigured" ? (
          <p className="mt-8 px-2 text-center text-xs text-black/50 dark:text-white/50">
            GIF search isn&apos;t set up for this app yet.
          </p>
        ) : status === "error" ? (
          <p className="mt-8 px-2 text-center text-xs text-black/50 dark:text-white/50">
            Couldn&apos;t reach GIF search — try again in a moment.
          </p>
        ) : status === "loading" && gifs.length === 0 ? (
          <p className="mt-8 text-center text-xs text-black/40 dark:text-white/40">Searching…</p>
        ) : gifs.length === 0 ? (
          <p className="mt-8 text-center text-xs text-black/50 dark:text-white/50">No GIFs found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onSelect(gif)}
                aria-label={gif.description || "Send GIF"}
                className="overflow-hidden rounded-lg bg-black/5 transition-opacity hover:opacity-80 dark:bg-white/5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- an animated GIPHY GIF preview, next/image can't preserve GIF animation */}
                <img src={gif.preview_url} alt={gif.description} className="h-24 w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
