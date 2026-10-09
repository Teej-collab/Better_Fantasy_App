"use client";

import { useEffect, useRef, useState } from "react";

// Every color choice (2026-10), same as the app (mobile/src/lib/colorChoice.ts):
// Default · Multi · a few curated colors · Custom (the browser's color
// picker) · Off where a setting has it. "multi" means something per
// setting; the backend accepts it for all of them.
export const MULTI = "multi";
export const MULTI_COLORS = ["#ec4899", "#0ea5e9", "#39ff14", "#a855f7", "#facc15"];
export const COLOR_PRESETS = [
  { name: "Green", hex: "#39ff14" },
  { name: "Blue", hex: "#0ea5e9" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Gold", hex: "#facc15" },
  { name: "Purple", hex: "#a855f7" },
];
export const MULTI_GRADIENT = `conic-gradient(${[...MULTI_COLORS, MULTI_COLORS[0]].join(", ")})`;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX.test(value);
}

// Dragging in the browser's picker fires continuously; save once it settles.
const CUSTOM_SAVE_DELAY_MS = 500;

const optionClass = (on: boolean) =>
  `flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
    on ? "border-black dark:border-white" : "border-transparent"
  }`;

export function ColorChoices(props: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  defaultColor: string;
  defaultLabel?: string;
  // Presets to leave out (e.g. the one Default already is).
  without?: string[];
  offOption?: boolean;
  className?: string;
}) {
  const current = props.value?.toLowerCase() ?? null;
  const presets = COLOR_PRESETS.filter((p) => !props.without?.includes(p.hex));
  const isPreset = presets.some((p) => p.hex === current);
  const [custom, setCustom] = useState<string | null>(null);
  const customShown = custom ?? (isHexColor(current) && !isPreset ? current : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function pick(value: string | null) {
    if (timer.current) clearTimeout(timer.current);
    setCustom(null);
    props.onChange(value);
  }

  function pickCustom(hex: string) {
    const value = hex.toLowerCase();
    if (!isHexColor(value)) return;
    setCustom(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => props.onChange(value), CUSTOM_SAVE_DELAY_MS);
  }

  return (
    <div className={props.className ?? "flex flex-wrap gap-2"} role="radiogroup" aria-label={props.label}>
      <ChoiceButton on={current === null && !custom} onClick={() => pick(null)} swatch={{ backgroundColor: props.defaultColor }} name={props.defaultLabel ?? "Default"} />
      <ChoiceButton on={current === MULTI && !custom} onClick={() => pick(MULTI)} swatch={{ background: MULTI_GRADIENT }} name="Multi" />
      {presets.map((p) => (
        <ChoiceButton key={p.hex} on={current === p.hex && !custom} onClick={() => pick(p.hex)} swatch={{ backgroundColor: p.hex }} name={p.name} />
      ))}
      <label className={`${optionClass(!!customShown)} cursor-pointer`}>
        <span
          className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-black/20 dark:border-white/30"
          style={{ backgroundColor: customShown ?? "transparent" }}
          aria-hidden
        >
          {!customShown && <span className="text-base leading-none text-black/50 dark:text-white/60">+</span>}
        </span>
        <span className="text-[10px] text-black/50 dark:text-white/50">Custom</span>
        <input
          type="color"
          className="sr-only"
          aria-label={`${props.label}: custom color`}
          value={customShown ?? "#ffffff"}
          onChange={(e) => pickCustom(e.target.value)}
        />
      </label>
      {props.offOption && (
        <ChoiceButton on={current === "off"} onClick={() => pick("off")} swatch={{ border: "1px solid rgba(127,127,127,0.5)" }} name="Off">
          <span className="text-sm text-black/40 dark:text-white/50">✕</span>
        </ChoiceButton>
      )}
    </div>
  );
}

function ChoiceButton(props: { on: boolean; onClick: () => void; swatch: React.CSSProperties; name: string; children?: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={props.on} onClick={props.onClick} className={optionClass(props.on)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full" style={props.swatch} aria-hidden>
        {props.children}
      </span>
      <span className="max-w-[4.5rem] text-[10px] text-black/50 dark:text-white/50">{props.name}</span>
    </button>
  );
}
