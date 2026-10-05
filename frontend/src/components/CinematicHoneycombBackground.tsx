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
  /** Where the lights wander around, as viewport percentages. Slightly
   *  above center reads best behind page headings. */
  focal?: { x: number; y: number };
  /** Sets the pace: each light pulses about once per `duration`
   *  seconds and takes several times that to loop its path. */
  duration?: number;
};

const DEFAULT_COLOR = "#dc143c";
const SQRT3 = Math.sqrt(3);
// The light moves slowly, so 30fps is visually identical to 60 at half
// the work. The canvas is also capped at 2x density — 3x phones gain
// nothing visible on soft light, and it's 44% less to fill.
const FRAME_MS = 1000 / 30;
const MAX_DPR = 2;
// How strong the backlight gets at the center of a light (0-1), and the
// faint light every gap always has, so the grid never fully disappears.
const LIGHT_MAX = 1;
const AMBIENT = 0.035;
// How far the whole grid drifts per second, in px — barely perceptible,
// it just keeps the surface from ever looking frozen.
const DRIFT_PX_PER_S = 4;

// Flat-top hexagon (two horizontal edges), as in the reference look.
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// One cell, rendered once per size: a charcoal plate a few px smaller
// than its slot, so the backlight shows through the gap around it as a
// neon edge. Lit slightly from the top, like a raised tile, and its rim
// turns translucent so light near a bright edge bleeds onto the plate.
function buildCell(r: number, gap: number, dpr: number) {
  const plate = r - gap / SQRT3;
  const w = 2 * r;
  const h = SQRT3 * r;
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const cx = w / 2;
  const cy = h / 2;
  // Flat charcoal, opaque through the middle, going see-through over
  // the outer quarter so a bright edge washes onto the plate beside it.
  hexPath(ctx, cx, cy, plate);
  const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, plate);
  body.addColorStop(0, "rgba(19,19,23,1)");
  body.addColorStop(0.62, "rgba(16,16,19,1)");
  body.addColorStop(0.8, "rgba(13,13,16,0.9)");
  body.addColorStop(0.93, "rgba(11,11,13,0.6)");
  body.addColorStop(1, "rgba(10,10,12,0.3)");
  ctx.fillStyle = body;
  ctx.fill();
  // A faint top-down sheen, so the plates read as raised tiles.
  hexPath(ctx, cx, cy, plate);
  const sheen = ctx.createLinearGradient(0, cy - plate, 0, cy + plate);
  sheen.addColorStop(0, "rgba(255,255,255,0.035)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fill();
  return { c, w, h };
}

// Cheap deterministic per-light randomness, so a resize doesn't reshuffle
// the lights' paths.
function hash(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

type Light = { ax: number; ay: number; fx: number; fy: number; px: number; py: number; pulse: number; phase: number; size: number };

/**
 * The neon hex wall behind every page — mounted once in RootLayout,
 * same fixed/negative-z/pointer-events:none pattern as .cosmic-ambient
 * (globals.css's .hc-* rules handle the layering).
 *
 * Big charcoal hex plates with a red light behind them: the light only
 * shows through the gaps between plates (the neon edges) and bleeds a
 * little onto their rims. A few soft lights wander slowly behind the
 * wall on their own looping paths and pulse, so different edges flare
 * up and fade as a light passes — never the whole screen at once — and
 * the wall itself drifts a few px a second.
 *
 * Per frame that's a handful of radial gradients and one drawImage of
 * the pre-rendered plate sheet: one canvas, one requestAnimationFrame
 * loop capped at 30fps, no React state (it never re-renders). The loop
 * stops when the tab is hidden, when the background is turned off, and
 * under reduced motion (Settings > Appearance > Animations or the OS
 * setting), which draws a single still frame instead.
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
    let r = 0;
    let lightColor = DEFAULT_COLOR;
    let lights: Light[] = [];
    let cell: ReturnType<typeof buildCell> | null = null;
    // Every plate, pre-rendered once per layout — one tile period larger
    // than the screen each way, so drifting it wraps seamlessly.
    const sheet = document.createElement("canvas");

    const isOff = () => root.getAttribute("data-honeycomb") === "off";
    const isStill = () => !animated || osReduced.matches || root.classList.contains("motion-reduced");
    const currentColor = () => {
      const c = color ?? getComputedStyle(root).getPropertyValue("--honeycomb-color").trim();
      return /^#[0-9a-fA-F]{6}$/.test(c) ? c : DEFAULT_COLOR;
    };

    // iOS WebKit keeps a canvas's pixel buffer until garbage collection
    // gets around to it, and counts every one toward a hard per-page
    // canvas memory cap — so each rebuild (resize, color change) would
    // otherwise stack up old buffers. Zeroing the size frees it now.
    function releaseBuffers() {
      if (cell) cell.c.width = cell.c.height = 0;
      cell = null;
      sheet.width = sheet.height = 0;
    }

    function layout() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      lightColor = currentColor();

      // Big plates — about three and a half across a desktop screen,
      // two and a half across a phone — clamped at both ends.
      r = Math.min(200, Math.max(70, 0.12 * Math.max(window.innerWidth, window.innerHeight)));
      const gap = Math.max(3, r * 0.045);
      releaseBuffers();
      cell = buildCell(r, gap, dpr);

      const colStep = 1.5 * r;
      const rowStep = SQRT3 * r;
      sheet.width = Math.ceil((width + 3 * r) * dpr);
      sheet.height = Math.ceil((height + rowStep) * dpr);
      const g = sheet.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil((width + 3 * r) / colStep) + 2;
      const rows = Math.ceil((height + rowStep) / rowStep) + 2;
      for (let col = -1; col < cols; col++) {
        for (let row = -1; row < rows; row++) {
          const x = col * colStep;
          const y = row * rowStep + (col & 1 ? rowStep / 2 : 0);
          g.drawImage(cell.c, x - cell.w / 2, y - cell.h / 2, cell.w, cell.h);
        }
      }

      // Three lights, each on its own slow looping path, biased toward
      // the focal point so the strongest light sits behind page headings.
      const span = duration * 1000;
      lights = [0, 1, 2].map((k) => ({
        ax: 0.3 + 0.25 * hash(k, 1),
        ay: 0.3 + 0.25 * hash(k, 2),
        fx: (Math.PI * 2) / (span * (3.5 + 3 * hash(k, 3))),
        fy: (Math.PI * 2) / (span * (4 + 3 * hash(k, 4))),
        px: hash(k, 5) * Math.PI * 2,
        py: hash(k, 6) * Math.PI * 2,
        pulse: (Math.PI * 2) / (span * (0.9 + 0.6 * hash(k, 7))),
        phase: hash(k, 8) * Math.PI * 2,
        size: r * (2.2 + 1.0 * hash(k, 9)),
      }));
    }

    function draw(now: number) {
      if (!cell) return;
      const t = isStill() ? 0 : now;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);

      // The backlight: a faint wash so every gap shows a little, then
      // each light added on top.
      ctx!.globalCompositeOperation = "source-over";
      ctx!.globalAlpha = AMBIENT;
      ctx!.fillStyle = lightColor;
      ctx!.fillRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "lighter";
      const fx = (focalX / 100) * width;
      const fy = (focalY / 100) * height;
      for (const l of lights) {
        const x = fx + Math.sin(t * l.fx + l.px) * l.ax * width;
        const y = fy + Math.sin(t * l.fy + l.py) * l.ay * height;
        const strength = LIGHT_MAX * (0.55 + 0.45 * Math.sin(t * l.pulse + l.phase));
        const glow = ctx!.createRadialGradient(x, y, 0, x, y, l.size);
        glow.addColorStop(0, lightColor);
        glow.addColorStop(0.3, lightColor + "cc");
        glow.addColorStop(0.65, lightColor + "33");
        glow.addColorStop(1, lightColor + "00");
        ctx!.globalAlpha = strength;
        ctx!.fillStyle = glow;
        ctx!.fillRect(x - l.size, y - l.size, l.size * 2, l.size * 2);
      }

      // The plates over it, drifting diagonally and wrapping by one tile
      // period (3r across, √3·r down) so the seam never shows.
      ctx!.globalCompositeOperation = "source-over";
      ctx!.globalAlpha = 1;
      const drift = (t / 1000) * DRIFT_PX_PER_S;
      const ox = drift % (3 * r);
      const oy = (drift * 0.6) % (SQRT3 * r);
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.drawImage(sheet, -Math.round(ox * dpr), -Math.round(oy * dpr));
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
      if (isOff()) {
        // Turned off — free every canvas buffer, not just the loop.
        releaseBuffers();
        canvas!.width = canvas!.height = 0;
        return;
      }
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
    // Background tabs don't need a running loop.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf && !isOff() && !isStill()) {
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
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
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      releaseBuffers();
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
