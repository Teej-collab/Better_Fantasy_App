// 9:16 edit decision list (recomposed from mobile-layout captures) — 120 BPM grid (beat = 0.5s, bar = 2s).
window.makeEDL = ({ W, H, clamp, lerp, ease, easeOut, easeIn }) => {
  const TD = 4591; // gamecast clip events (ms)
  const shake = (g, t, amp, dur) => { const k = clamp((g - t) / dur); if (k <= 0 || k >= 1) return [0, 0]; const a = amp * (1 - k) * (1 - k); return [a * Math.sin(g * 91.7), a * Math.cos(g * 73.3)]; };
  const cam = (x0, y0, w0, x1, y1, w1, e = ease) => (p) => ({ x: lerp(x0, x1, e(p)), y: lerp(y0, y1, e(p)), w: lerp(w0, w1, e(p)) });
  const shots = [
    { t0: 1.4, t1: 8.0, src: { clip: "v_intro", ms: (g) => (g - 0.96) * 1000 }, cam: cam(540, 960, 1080, 540, 880, 930),
      filter: (p, g) => `brightness(${clamp((g - 1.4) / 0.6)})` },
    { t0: 8.0, t1: 12.0, src: { clip: "v_home", ms: (g) => (g - 8.0 + 0.2) * 1000 },
      panel: (p) => ({ rx: lerp(20, 8, ease(p)), ry: lerp(22, 9, ease(p)), rz: lerp(-3, -1, ease(p)), s: lerp(0.74, 0.86, ease(p)), tx: lerp(-60, 0, ease(p)) }) },
    { t0: 12.0, t1: 16.0, src: { clip: "v_home", ms: (g) => (g - 12.0 + 4.6) * 1000 },
      panel: (p) => ({ rx: lerp(18, 7, ease(p)), ry: lerp(-20, -8, ease(p)), rz: lerp(3, 1, ease(p)), s: lerp(0.74, 0.86, ease(p)), tx: lerp(40, 0, ease(p)) }) },
    { t0: 16.0, t1: 18.0, src: { clip: "v_home", ms: (g) => (g - 16.0) * 650 }, cam: cam(420, 400, 640, 620, 400, 600, (x) => x),
      filter: (p) => `brightness(${lerp(0.55, 0.4, p)}) blur(${lerp(1.5, 3, p)}px)` },
    { t0: 18.0, t1: 20.0, src: { still: "v_home.png" }, cam: cam(648, 3548, 1296, 648, 3548, 1180) },
    { t0: 20.0, t1: 22.0, src: { still: "v_matchup.png" }, cam: cam(648, 1320, 1296, 648, 1330, 1180, easeOut) },
    { t0: 22.0, t1: 27.0, src: { clip: "v_gamecast", ms: (g) => (g - 25.0) * 1000 + TD },
      cam: (p, g) => {
        const pre = clamp((g - 22) / 3), post = easeOut(clamp((g - 25) / 0.35));
        const w = g < 25 ? lerp(1080, 1000, ease(pre)) : lerp(1000, 820, post);
        const [sx, sy] = shake(g, 25.0, 18, 0.45);
        return { x: 540, y: g < 25 ? lerp(960, 900, ease(pre)) : lerp(900, 720, post), w, sx, sy };
      } },
    { t0: 27.0, t1: 30.0, src: { clip: "v_gamecast", ms: (g) => (g - 27.0) * 1000 + 17000 }, cam: cam(540, 960, 1080, 540, 900, 1000) },
    { t0: 30.0, t1: 30.5, src: { still: "v_matchup.png" }, cam: cam(648, 1300, 1296, 648, 1300, 1280) },
    { t0: 30.5, t1: 32.0, src: { still: "v_matchup2.png" }, cam: (p, g) => { const [sx, sy] = shake(g, 30.5, 12, 0.3); return { x: 648, y: 1300, w: lerp(1280, 1150, easeOut(p)), sx, sy }; } },
    { t0: 32.0, t1: 38.0, src: { clip: "v_chat", ms: (g) => (g - 32.0) * 1000 + 600 },
      panel: (p) => ({ rx: lerp(5, 2, ease(p)), ry: lerp(-10, -4, ease(p)), rz: 0, s: lerp(0.98, 1.04, ease(p)) }) },
    { t0: 38.0, t1: 40.0, src: { still: "v_home.png" }, cam: cam(648, 5690, 1296, 648, 5690, 1200) },
    { t0: 40.0, t1: 42.0, src: { still: "v_home.png" }, cam: cam(648, 4600, 1296, 648, 4860, 1296, (x) => x) },
    { t0: 42.0, t1: 44.0, src: { still: "v_matchup.png" }, cam: cam(648, 6640, 1296, 648, 6650, 1150) },
    { t0: 44.0, t1: 46.5, src: { still: "v_matchup2.png" }, cam: cam(420, 1560, 640, 900, 1560, 600, (x) => x) },
    { t0: 46.5, t1: 49.0, src: { clip: "v_home", ms: (g) => (g - 46.5) * 560 }, cam: cam(540, 840, 1080, 540, 860, 1000) },
    { t0: 49.0, t1: 51.5, src: { clip: "v_chat", ms: () => 99999 }, cam: cam(600, 1270, 980, 620, 1250, 860) },
    { t0: 51.5, t1: 53.5, src: { clip: "v_gamecast", ms: () => 99999 }, cam: cam(540, 680, 1080, 540, 680, 940),
      filter: (p) => `brightness(${lerp(1, 0.55, easeIn(p))}) blur(${lerp(0, 4, easeIn(p))}px)` },
  ];
  const stills = ["v_home.png", "v_matchup.png", "v_matchup2.png"];

  const flashAt = (g, t, dur, color) => { const k = (g - t) / dur; return k >= 0 && k < 1 ? `rgba(${color},${(1 - k) * (1 - k)})` : null; };
  const flash = (g) =>
    flashAt(g, 7.9, 0.55, "200,255,210") || flashAt(g, 16.0, 0.22, "255,255,255") || flashAt(g, 25.0, 0.3, "255,255,255") ||
    flashAt(g, 30.5, 0.18, "255,255,255") || flashAt(g, 32.0, 0.16, "255,40,70") || flashAt(g, 44.0, 0.4, "0,0,0") || "transparent";
  const bg = (g) => {
    const pulse = g < 1.4 ? 0.06 + 0.05 * Math.pow(Math.max(0, Math.sin(g * Math.PI * 2 * 1.0)), 8) : 0.1;
    return `radial-gradient(ellipse at 50% 55%, rgba(255,23,68,${pulse}) 0%, rgba(20,0,6,.6) 45%, #000 80%)`;
  };
  const overlay = (g) => (g >= 8 && g < 16) ? "radial-gradient(ellipse at 50% 110%, rgba(255,23,68,.18), transparent 60%)" : "";

  const slam = (g, t0, t1, text, size) => {
    if (g < t0 || g >= t1) return "";
    const k = clamp((g - t0) / 0.18), out = clamp((g - (t1 - 0.25)) / 0.25);
    const sc = lerp(1.35, 1.0, easeOut(k)), op = k * (1 - out);
    const track = lerp(0.3, 0.06, easeOut(clamp((g - t0) / 1.6)));
    return `<div class="title" style="top:${H / 2 - size * 1.15}px;font-size:${size}px;line-height:1.0;opacity:${op};transform:scale(${sc});letter-spacing:${track}em;text-shadow:0 0 30px rgba(255,23,68,.9),0 0 80px rgba(255,23,68,.6),0 6px 30px rgba(0,0,0,.8)">${text}</div>`;
  };
  const lowerThird = (g, t0, t1, text, x, y, size) => {
    if (g < t0 || g >= t1) return "";
    const k = easeOut(clamp((g - t0) / 0.35)), out = clamp((g - (t1 - 0.3)) / 0.3);
    const shade = `<div style="position:absolute;inset:0;opacity:${k * (1 - out)};background:linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.55) 22%, transparent 45%)"></div>`;
    return shade + `<div class="lower" style="left:${x}px;top:${y}px;font-size:${size}px;opacity:${1 - out}">
      <span class="bar" style="width:${size * 3.2}px;transform:scaleX(${k})"></span>
      <span style="display:inline-block;line-height:1.05;clip-path:inset(0 ${100 - k * 100}% 0 0);text-shadow:0 4px 24px rgba(0,0,0,.9)">${text}</span></div>`;
  };
  const endCard = (g) => {
    if (g < 53.5) return "";
    const fade = 1 - clamp((g - 59.2) / 1.0);
    // neon ignition flicker
    const tt = g - 53.7;
    const flick = tt < 0 ? 0 : tt < 0.9 ? ([0.15, 0.9, 0.1, 0.6, 1, 0.35, 1, 1, 0.8, 1][Math.floor(tt / 0.09)] ?? 1) : 1;
    const sc = lerp(1.06, 1.0, easeOut(clamp(tt / 5.5)));
    const tag = clamp((g - 55.0) / 0.8), tag2 = clamp((g - 55.5) / 0.8);
    const sub = clamp((g - 56.4) / 0.9);
    return `<div style="position:absolute;inset:0;opacity:${fade}">
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%, rgba(255,23,68,${0.18 * flick}) 0%, rgba(255,23,68,${0.04 * flick}) 30%, transparent 60%)"></div>
      <div class="title" style="letter-spacing:.14em;color:#fff;text-shadow:0 0 6px rgba(255,255,255,.8),0 0 28px rgba(255,23,68,.9),0 0 70px rgba(255,23,68,.6),0 0 140px rgba(255,23,68,.35);top:${H * 0.33}px;text-align:center;font-size:170px;line-height:1.0;opacity:${flick};transform:scale(${sc})">THE<br>WEEKEND</div>
      <div class="title" style="top:${H * 0.52}px;font-size:58px;letter-spacing:.28em;color:#fff;line-height:1.5">
        <span style="opacity:${tag};display:inline-block;transform:translateY(${lerp(14, 0, easeOut(tag))}px)">YOUR LEAGUE.</span><br>
        <span style="opacity:${tag2};display:inline-block;transform:translateY(${lerp(14, 0, easeOut(tag2))}px);color:#ff1744;text-shadow:0 0 24px rgba(255,23,68,.7)">YOUR SUNDAY.</span></div>
    </div>`;
  };
  const text = (g) =>
    slam(g, 16.0, 18.0, "GAME<br>DAY", 250) +
    lowerThird(g, 28.1, 30.0, "EVERY POINT<br>MATTERS", 70, 1480, 96) +
    lowerThird(g, 32.35, 34.4, "YOUR LEAGUE.<br>LIVE.", 70, 1480, 96) +
    endCard(g);
  return { shots, stills, flash, bg, overlay, text, duration: 60.5 };
};
