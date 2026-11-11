"use client";

import { useEffect, useState } from "react";
import { ANTON } from "@/components/elite/Elite";
import { createShareLink, FORMAT_SIZE, type ShareFormat, type ShareRef } from "@/lib/share";

const FORMATS: { key: ShareFormat; label: string; hint: string }[] = [
  { key: "post", label: "Post", hint: "For group chats." },
  { key: "story", label: "Story", hint: "Full screen, for stories." },
  { key: "wide", label: "Wide", hint: "Wide, for X and Discord." },
];

/**
 * Share a designed card (2026-11-10, the share overhaul): makes the
 * public link (backend app/routers/share.py) and offers the card image
 * (app/s/[token]/image) to the device's own share sheet, a download, the
 * league chat, or a copied link. The web couldn't share images before.
 * The app's twin is mobile/src/components/ShareSheet.tsx.
 */
export function ShareButton({ shareRef, title, label = "Share ↗", className = "" }: { shareRef: ShareRef; title: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`min-h-9 self-end rounded-lg px-2 text-sm font-bold text-[#f5f4ec]/70 hover:text-[#39ff14] ${className}`}
      >
        {label}
      </button>
      {open && <ShareDialog shareRef={shareRef} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ shareRef, title, onClose }: { shareRef: ShareRef; title: string; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [format, setFormat] = useState<ShareFormat>("post");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    createShareLink(shareRef).then(
      (t) => live && setToken(t),
      (e) => live && setError(e instanceof Error ? e.message : "Couldn't make a share link."),
    );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
    // One link per dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = token ? `${window.location.origin}/s/${token}` : null;
  const imageUrl = token ? `/s/${token}/image?f=${format}` : null;
  const { width, height } = FORMAT_SIZE[format];
  // Fetched ahead, so Share runs straight from the tap: Safari drops a
  // share sheet that waits on a download first.
  const [file, setFile] = useState<{ url: string; file: File } | null>(null);

  useEffect(() => {
    if (!imageUrl) return;
    let live = true;
    fetch(imageUrl)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => live && blob && setFile({ url: imageUrl, file: new File([blob], `the-weekend-${format}.png`, { type: "image/png" }) }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [imageUrl, format]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await action();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function imageFile(): Promise<File> {
    if (file?.url === imageUrl) return file.file;
    const res = await fetch(imageUrl!);
    if (!res.ok) throw new Error("Couldn't load the card.");
    return new File([await res.blob()], `the-weekend-${format}.png`, { type: "image/png" });
  }

  // The phone's own share sheet with the image attached where the
  // browser allows it, else just the link.
  async function shareOut() {
    const image = await imageFile();
    if (navigator.canShare?.({ files: [image] })) {
      await navigator.share({ files: [image], title, text: `${title} ${link}` });
    } else if (navigator.share) {
      await navigator.share({ title, text: title, url: link! });
    } else {
      await download();
    }
  }

  async function download() {
    const image = await imageFile();
    const url = URL.createObjectURL(image);
    const a = document.createElement("a");
    a.href = url;
    a.download = image.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("Saved.");
  }

  const btn = "flex min-h-11 flex-1 items-center justify-center rounded-xl border px-3 text-sm font-bold disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${title}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-[22px] border border-[#39ff14]/40 bg-[#0b0f14] p-5 text-[#f5f4ec] shadow-[0_0_34px_rgba(57,255,20,.15)] sm:rounded-[22px]"
      >
        <div className="flex items-center justify-between">
          <h2 className={`${ANTON} text-2xl uppercase tracking-wide text-[#39ff14]`} style={{ textShadow: "0 0 8px rgba(57,255,20,.7)" }}>
            Share
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#141a22] hover:bg-white/5">
            <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="mx-auto flex w-full items-center justify-center overflow-hidden rounded-[18px] bg-[#141a22]" style={{ aspectRatio: `${width} / ${height}`, maxHeight: format === "story" ? 440 : undefined, maxWidth: format === "story" ? 248 : undefined }}>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own image route, already the right size
            <img src={imageUrl} alt={title} width={width} height={height} className="h-full w-full object-contain" />
          ) : (
            !error && <span className="text-sm text-[#f5f4ec]/50">Making the card…</span>
          )}
        </div>

        <div role="radiogroup" aria-label="Format" className="grid grid-cols-3 gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={format === f.key}
              onClick={() => setFormat(f.key)}
              className={`min-h-10 rounded-xl border text-sm font-bold ${
                format === f.key ? "border-[#39ff14] bg-[#0f1a12] text-[#39ff14]" : "border-white/10 bg-[#10151c] text-[#f5f4ec]/80 hover:border-[#39ff14]/50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#f5f4ec]/55">{FORMATS.find((f) => f.key === format)!.hint} Anyone with the link can see it, no sign-in needed.</p>

        {error && <p role="alert" className="text-sm font-semibold text-red-400">{error}</p>}
        {note && <p className="text-sm font-semibold text-[#39ff14]">{note}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!link || busy !== null}
            onClick={() =>
              void run("chat", async () => {
                const res = await fetch("/api/backend/chat/league/share", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ body: `${title} ${link}` }),
                });
                if (!res.ok) throw new Error("Couldn't post it to the league chat.");
                setNote("Posted to the league chat.");
              })
            }
            className={`${btn} border-[#39ff14] bg-[#0f1a12] text-[#39ff14]`}
          >
            League chat
          </button>
          <button type="button" disabled={!link || busy !== null} onClick={() => void run("out", shareOut)} className={`${btn} border-white/15 hover:bg-white/5`}>
            Share
          </button>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!link || busy !== null} onClick={() => void run("save", download)} className={`${btn} border-white/15 hover:bg-white/5`}>
            Download
          </button>
          <button
            type="button"
            disabled={!link || busy !== null}
            onClick={() =>
              void run("copy", async () => {
                await navigator.clipboard.writeText(link!);
                setNote("Link copied.");
              })
            }
            className={`${btn} border-white/15 hover:bg-white/5`}
          >
            Copy link
          </button>
        </div>
      </div>
    </div>
  );
}
