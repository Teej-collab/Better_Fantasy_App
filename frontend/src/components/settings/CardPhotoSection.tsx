"use client";

import { useEffect, useRef, useState } from "react";
import { deleteCardPhotoClient, getMyCardPhotoClient, uploadCardPhotoClient } from "@/lib/api";

// Settings > Player Card Photo (2026-10-31): the picture on your player
// card in the league you're in — each league keeps its own, like the
// Team Logo. The app's twin is CardPhotoPanel in mobile/src/components/
// settings/SettingsSections.tsx.

const CARD_WIDTH = 900;

// Center-crops to the card's 3:4 portrait shape and shrinks it to
// CARD_WIDTH wide as a JPEG, the same as the app's pickCardPhoto.
async function toCardJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const target = 3 / 4;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (sw / sh > target) sw = Math.round(sh * target);
  else sh = Math.round(sw / target);
  const sx = Math.round((bitmap.width - sw) / 2);
  const sy = Math.round((bitmap.height - sh) / 2);
  const width = Math.min(CARD_WIDTH, sw);
  const height = Math.round(width / target);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo"))), "image/jpeg", 0.85)
  );
}

export function CardPhotoSection() {
  const [state, setState] = useState<{ ownerId: number; photoUrl: string | null } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMyCardPhotoClient()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  if (state === null) return null;

  async function run(action: (ownerId: number) => Promise<void>) {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      await action(state.ownerId);
      setState(await getMyCardPhotoClient());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
      <div>
        <h2 className="text-sm font-semibold tracking-wide uppercase">Player Card Photo</h2>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">The picture on your player card in this league. Each league keeps its own.</p>
      </div>
      <div className="flex items-center gap-4">
        {state?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the private bucket, not a static asset.
          <img src={state.photoUrl} alt="Your player card photo" className="h-[88px] w-[66px] rounded-lg object-cover" />
        ) : (
          <span className="flex h-[88px] w-[66px] items-center justify-center rounded-lg border border-dashed border-white/20 text-[11px] text-white/50">
            No photo
          </span>
        )}
        <div className="flex flex-col items-start gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run(async (ownerId) => uploadCardPhotoClient(ownerId, await toCardJpeg(file)));
            }}
          />
          <button
            type="button"
            disabled={busy || state === undefined}
            onClick={() => inputRef.current?.click()}
            className="rounded-full border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "var(--user-accent, var(--wl-accent))" }}
          >
            {busy ? "Saving…" : state?.photoUrl ? "Change photo" : "Choose a photo"}
          </button>
          {state?.photoUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run((ownerId) => deleteCardPhotoClient(ownerId))}
              className="text-xs text-white/50 underline disabled:opacity-50"
            >
              Remove photo
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </section>
  );
}
