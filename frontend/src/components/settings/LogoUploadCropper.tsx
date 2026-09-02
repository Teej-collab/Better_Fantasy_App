"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const FRAME = 240; // on-screen crop circle diameter, px
const OUTPUT = 512; // exported logo size, px — square, drawn circular by every consumer via rounded-full/CSS clip, not baked into the PNG itself
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

type Stage =
  | { name: "idle" }
  | { name: "cropping"; img: HTMLImageElement; zoom: number; pan: { x: number; y: number } }
  | { name: "saving" }
  | { name: "error"; message: string };

// A from-scratch pan/zoom circular cropper — no library exists in this
// app to build on (confirmed: nothing installed does image cropping),
// and a fixed circular logo only ever needs pan + zoom, not a full
// image editor. Base "cover" fit and every pan/zoom value are computed
// in plain JS (not CSS object-fit) so the live on-screen preview and
// the final exported crop are driven by the exact same numbers —
// nothing to drift between what's shown and what's actually saved.
export function LogoUploadCropper({
  currentLogoUrl,
  onSaved,
}: {
  currentLogoUrl: string | null;
  onSaved: (url: string | null) => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  function baseScale(img: HTMLImageElement) {
    return Math.max(FRAME / img.naturalWidth, FRAME / img.naturalHeight);
  }

  function clampPan(img: HTMLImageElement, zoom: number, pan: { x: number; y: number }) {
    const scale = baseScale(img) * zoom;
    const halfExtentX = Math.max(0, (img.naturalWidth * scale - FRAME) / 2);
    const halfExtentY = Math.max(0, (img.naturalHeight * scale - FRAME) / 2);
    return {
      x: Math.min(halfExtentX, Math.max(-halfExtentX, pan.x)),
      y: Math.min(halfExtentY, Math.max(-halfExtentY, pan.y)),
    };
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !ALLOWED_TYPES.includes(file.type)) {
      setStage({ name: "error", message: "Pick a JPEG, PNG, or WebP image." });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setStage({ name: "cropping", img, zoom: MIN_ZOOM, pan: { x: 0, y: 0 } });
    img.onerror = () => setStage({ name: "error", message: "Couldn't read that image." });
    img.src = objectUrl;
  }

  function onPointerDown(e: React.PointerEvent, current: { pan: { x: number; y: number } }) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: current.pan.x, panY: current.pan.y };
  }

  function onPointerMove(e: React.PointerEvent, s: Extract<Stage, { name: "cropping" }>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const pan = clampPan(s.img, s.zoom, { x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
    setStage({ ...s, pan });
  }

  function onZoomChange(zoom: number, s: Extract<Stage, { name: "cropping" }>) {
    setStage({ ...s, zoom, pan: clampPan(s.img, zoom, s.pan) });
  }

  async function save(s: Extract<Stage, { name: "cropping" }>) {
    setStage({ name: "saving" });
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas isn't supported here");

      // sw/sh: how much of the SOURCE image (natural pixels) is
      // visible inside the FRAME-sized circle on screen, at the
      // current zoom — same `scale` the live preview's CSS transform
      // above uses, so what's drawn here matches what was shown.
      const scale = baseScale(s.img) * s.zoom;
      const sw = FRAME / scale;
      const sh = sw;
      const sourceCenterX = s.img.naturalWidth / 2 - s.pan.x / scale;
      const sourceCenterY = s.img.naturalHeight / 2 - s.pan.y / scale;
      const sx = sourceCenterX - sw / 2;
      const sy = sourceCenterY - sh / 2;

      ctx.drawImage(s.img, sx, sy, sw, sh, 0, 0, OUTPUT, OUTPUT);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't export the cropped image"))), "image/png")
      );

      const uploaded = await upload("logo.png", blob, { access: "public", handleUploadUrl: "/api/settings/logo-upload" });
      onSaved(uploaded.url);
      setStage({ name: "idle" });
    } catch (e) {
      setStage({ name: "error", message: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  function remove() {
    onSaved(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/10 text-sm font-semibold dark:bg-white/10">
          {currentLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL, not a static/known-at-build-time asset next/image can optimize
            <img src={currentLogoUrl} alt="Your team logo" className="h-full w-full object-cover" />
          ) : (
            "No logo"
          )}
        </span>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-fit rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-semibold text-white"
          >
            {currentLogoUrl ? "Change logo" : "Upload a logo"}
          </button>
          {currentLogoUrl && (
            <button type="button" onClick={remove} className="w-fit text-xs text-black/50 hover:underline dark:text-white/50">
              Remove logo
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept={ALLOWED_TYPES.join(",")} className="hidden" onChange={pickFile} />
      </div>

      {stage.name === "error" && <p className="text-xs text-red-500">{stage.message}</p>}

      {stage.name === "cropping" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
          <div
            className="relative touch-none overflow-hidden rounded-full border border-black/10 dark:border-white/10"
            style={{ width: FRAME, height: FRAME, cursor: "grab" }}
            onPointerDown={(e) => onPointerDown(e, stage)}
            onPointerMove={(e) => onPointerMove(e, stage)}
            onPointerUp={() => (dragRef.current = null)}
            onPointerLeave={() => (dragRef.current = null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- an in-memory object URL from the file the user just picked, not a static/known-at-build-time asset next/image can optimize */}
            <img
              src={stage.img.src}
              alt="Crop preview"
              draggable={false}
              className="pointer-events-none absolute top-1/2 left-1/2 max-w-none select-none"
              style={{
                width: stage.img.naturalWidth * baseScale(stage.img) * stage.zoom,
                height: stage.img.naturalHeight * baseScale(stage.img) * stage.zoom,
                transform: `translate(calc(-50% + ${stage.pan.x}px), calc(-50% + ${stage.pan.y}px))`,
              }}
            />
          </div>

          <label className="flex w-full max-w-xs items-center gap-2 text-xs text-black/50 dark:text-white/50">
            Zoom
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={stage.zoom}
              onChange={(e) => onZoomChange(Number(e.target.value), stage)}
              className="flex-1"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStage({ name: "idle" })}
              className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium dark:border-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save(stage)}
              className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Save logo
            </button>
          </div>
        </div>
      )}

      {stage.name === "saving" && <p className="text-xs text-black/50 dark:text-white/50">Uploading…</p>}
    </div>
  );
}
