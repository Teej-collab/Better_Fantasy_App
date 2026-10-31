"use client";

import { useState } from "react";

// Long text cut to three lines, with a link to open the rest (the Fight
// Card's stories, the Chug Board's roasts).
export function ReadMore({ text, more, less = "Show less", className = "" }: { text: string; more: string; less?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <div className="flex flex-col items-start gap-1">
      <p className={`${className} ${long && !open ? "line-clamp-3" : ""}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-8 text-[13px] font-semibold text-[#39ff14] hover:underline">
          {open ? less : more}
        </button>
      )}
    </div>
  );
}
