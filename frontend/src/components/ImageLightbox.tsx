"use client";

import { useEffect, useState } from "react";

/**
 * A photo full screen. Click it to see it at full size and scroll
 * around; click again to fit it back to the screen. Esc, ✕, or a click
 * on the backdrop closes it. On a phone browser, pinch zoom works too.
 */
export function ImageLightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return <Lightbox key={src} src={src} onClose={onClose} />;
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onClick={onClose}
      className={`fixed inset-0 z-[100] bg-black/95 ${zoomed ? "overflow-auto" : "flex items-center justify-center p-4"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded Blob URL at its natural size, not a build-time asset */}
      <img
        src={src}
        alt="Attached screenshot"
        onClick={(e) => {
          e.stopPropagation();
          setZoomed((z) => !z);
        }}
        className={zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close photo"
        className="fixed top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        ✕
      </button>
    </div>
  );
}
