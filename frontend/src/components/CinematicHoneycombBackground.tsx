"use client";

import { useEffect, useRef, type CSSProperties } from "react";

type Props = {
  /** Multiplies the whole pattern's opacity. 1 is the tuned default;
   *  drop it (e.g. 0.6) anywhere the pattern competes with dense content. */
  intensity?: number;
  /** false draws one still frame, same as reduced motion. */
  animated?: boolean;
  /** Overrides the owner's Settings > Appearance > Background choice
   *  (--honeycomb-color, set on <html> by app/layout.tsx). */
  color?: string;
  /** Where the glow and the breathing wave center, as viewport
   *  percentages. Slightly above center reads best behind page headings. */
  focal?: { x: number; y: number };
  /** Average seconds per breath (dim → bright → dim). Each cell's own
   *  period varies ±35% around this. */
  duration?: number;
};

const DEFAULT_COLOR = "#dc143c";
const SQRT3 = Math.sqrt(3);
// Breathing is slow, so 30fps is visually identical to 60 at half the
// work. The canvas is also capped at 2x density — 3x phones gain
// nothing visible on a line this faint, and it's 44% less to fill.
const FRAME_MS = 1000 / 30;
const MAX_DPR = 2;
// The grid's line alpha at the focal point (it fades toward the edges),
// and a cell's own light at the top of its breath. Every line always
// shows at least GRID_ALPHA, so the pattern never fully disappears.
const GRID_ALPHA = 0.3;
const LIGHT_MAX = 0.75;

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Two sprites, rendered once per color/size: the crisp line with its
// soft glow (drawn once per layout into a static grid, since lines never
// change), and the light inside a cell (drawn every frame, one
// drawImage per cell at that cell's own alpha). The light is inset from
// the edges, so neighboring cells never add up on a shared line — that's
// what lets each cell read as breathing on its own.
function buildSprites(r: number, dpr: number, color: string) {
  const pad = 6;
  const w = SQRT3 * r + pad * 2;
  const h = 2 * r + pad * 2;
  const make = () => {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    return { c, ctx };
  };
  const cx = w / 2;
  const cy = h / 2;

  const line = make();
  line.ctx.strokeStyle = color;
  line.ctx.lineJoin = "round";
  for (const [width, alpha] of [
    [6, 0.06],
    [3, 0.14],
    [1, 1],
  ]) {
    hexPath(line.ctx, cx, cy, r);
    line.ctx.lineWidth = width;
    line.ctx.globalAlpha = alpha;
    line.ctx.stroke();
  }

  // The light coming through the cell: brightest just inside the rim,
  // fading toward the center, so it reads as the edges glowing inward
  // rather than a filled blob.
  const light = make();
  const inner = r * 0.9;
  hexPath(light.ctx, cx, cy, inner);
  const fill = light.ctx.createRadialGradient(cx, cy, 0, cx, cy, inner);
  fill.addColorStop(0, color + "00");
  fill.addColorStop(0.6, color + "10");
  fill.addColorStop(1, color + "38");
  light.ctx.fillStyle = fill;
  light.ctx.fill();
  light.ctx.strokeStyle = color;
  light.ctx.lineJoin = "round";
  for (const [width, alpha] of [
    [4, 0.16],
    [1.2, 0.55],
  ]) {
    hexPath(light.ctx, cx, cy, inner);
    light.ctx.lineWidth = width;
    light.ctx.globalAlpha = alpha;
    light.ctx.stroke();
  }

  return { line: line.c, light: light.c, w, h };
}

// Cheap deterministic per-cell randomness, so a resize doesn't reshuffle
// which cells are in which phase.
function hash(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The breathing honeycomb behind every page — mounted once in
 * RootLayout, same fixed/negative-z/pointer-events:none pattern as
 * .cosmic-ambient (globals.css's .hc-* rules handle the layering).
 *
 * Every cell breathes on its own: a random phase and a period that
 * varies around `duration`, blended with a slow wave that rolls outward
 * from the focal point, so the light drifts across the surface cell by
 * cell instead of the whole screen pulsing together. A radial vignette
 * keeps the focal area strongest and the corners near black.
 *
 * One canvas, one requestAnimationFrame loop capped at 30fps, no React
 * state (it never re-renders). The loop stops when the tab is hidden,
 * when the background is turned off, and under reduced motion (Settings
 * > Appearance > Animations or the OS setting), which draws a single
 * still frame instead.
 */
export function CinematicHoneycombBackground({
  intensity = 1,
  animated = true,
  color,
  focal = { x: 50, y: 40 },
  duration = 6,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focalX = focal.x;
  const focalY = focal.y;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const root = document.documentElement;
    const osReduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    let raf = 0;
    let last = 0;
    let dpr = 1;
    let width = 0;
    let height = 0;
    let sprites: ReturnType<typeof buildSprites> | null = null;
    // The static grid of lines, pre-rendered once per layout.
    const grid = document.createElement("canvas");
    // Per-cell data, flat arrays: x, y, vignette, angular speed, phase,
    // wave offset.
    let cells = new Float32Array(0);
    let count = 0;

    const isOff = () => root.getAttribute("data-honeycomb") === "off";
    const isStill = () => !animated || osReduced.matches || root.classList.contains("motion-reduced");
    const currentColor = () => {
      const c = color ?? getComputedStyle(root).getPropertyValue("--honeycomb-color").trim();
      return /^#[0-9a-fA-F]{6}$/.test(c) ? c : DEFAULT_COLOR;
    };

    function layout() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);

      // Hex size tracks the viewport's long side, clamped, so it's
      // never dense on a phone or huge on a tablet/desktop.
      const r = Math.min(44, Math.max(22, 0.03 * Math.max(window.innerWidth, window.innerHeight)));
      sprites = buildSprites(r, dpr, currentColor());

      const colW = SQRT3 * r;
      const rowH = 1.5 * r;
      const cols = Math.ceil(width / colW) + 2;
      const rows = Math.ceil(height / rowH) + 2;
      const fx = (focalX / 100) * width;
      const fy = (focalY / 100) * height;
      // Vignette reach: the distance from the focal point to the
      // farthest corner, so corners land at ~0 on any aspect ratio.
      const reach = Math.hypot(Math.max(fx, width - fx), Math.max(fy, height - fy));

      count = cols * rows;
      cells = new Float32Array(count * 6);
      let i = 0;
      for (let row = -1; row < rows - 1; row++) {
        for (let col = -1; col < cols - 1; col++) {
          const x = col * colW + (row & 1 ? colW / 2 : 0);
          const y = row * rowH;
          const d = Math.hypot(x - fx, y - fy) / reach;
          const v = Math.max(0, 1 - d);
          const period = duration * (0.65 + 0.7 * hash(col, row));
          cells[i++] = x;
          cells[i++] = y;
          cells[i++] = v * v * (3 - 2 * v);
          cells[i++] = (Math.PI * 2) / (period * 1000);
          cells[i++] = hash(row + 17, col - 5) * Math.PI * 2;
          cells[i++] = d * Math.PI * 2 * 1.4;
        }
      }

      grid.width = canvas!.width;
      grid.height = canvas!.height;
      const g = grid.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let j = 0; j < count * 6; j += 6) {
        if (cells[j + 2] < 0.01) continue;
        g.globalAlpha = cells[j + 2] * GRID_ALPHA;
        g.drawImage(sprites.line, cells[j] - sprites.w / 2, cells[j + 1] - sprites.h / 2, sprites.w, sprites.h);
      }
    }

    function draw(now: number) {
      if (!sprites) return;
      const { light, w, h } = sprites;
      const still = isStill();
      const waveSpeed = (Math.PI * 2) / (duration * 1000 * 1.6);
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.globalAlpha = 1;
      ctx!.drawImage(grid, 0, 0);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = 0; i < count * 6; i += 6) {
        const vignette = cells[i + 2];
        if (vignette < 0.01) continue;
        let breath: number;
        if (still) {
          // A fixed, varied still frame — same design, no movement.
          breath = 0.25 + 0.2 * Math.sin(cells[i + 4]);
        } else {
          const own = 0.5 + 0.5 * Math.sin(now * cells[i + 3] + cells[i + 4]);
          const wave = 0.5 + 0.5 * Math.sin(now * waveSpeed - cells[i + 5]);
          const b = 0.75 * own + 0.25 * wave;
          // Cubing the curve keeps most cells near dark at any moment,
          // so the ones mid-breath stand out individually instead of
          // everything sitting at the same middling brightness.
          breath = b * b * b;
        }
        if (breath < 0.02) continue;
        ctx!.globalAlpha = vignette * LIGHT_MAX * breath;
        ctx!.drawImage(light, cells[i] - w / 2, cells[i + 1] - h / 2, w, h);
      }
      ctx!.globalAlpha = 1;
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
    }

    function restart() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (isOff()) return;
      layout();
      if (isStill()) draw(0);
      else raf = requestAnimationFrame(frame);
    }

    restart();

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(restart, 150);
    };
    window.addEventListener("resize", onResize);
    osReduced.addEventListener("change", restart);
    // Settings > Appearance changes the color, "off", and reduced motion
    // by editing <html>'s style/attributes — pick those up immediately.
    // Other code sets unrelated properties there too (ChatApp's
    // --chat-top-offset, the nav drawer's offsets), so only rebuild when
    // one of the three things this cares about actually changed.
    const settingsKey = () => `${currentColor()}|${isOff()}|${isStill()}`;
    let lastKey = settingsKey();
    const observer = new MutationObserver(() => {
      const key = settingsKey();
      if (key === lastKey) return;
      lastKey = key;
      restart();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["style", "class", "data-honeycomb"] });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      osReduced.removeEventListener("change", restart);
      observer.disconnect();
    };
  }, [animated, color, focalX, focalY, duration]);

  const style = {
    "--hc-intensity": intensity,
    "--hc-x": `${focal.x}%`,
    "--hc-y": `${focal.y}%`,
    "--hc-duration": `${duration}s`,
  } as CSSProperties;

  return (
    <div className="hc-bg" style={style} aria-hidden>
      <canvas ref={canvasRef} className="hc-surface" />
    </div>
  );
}
