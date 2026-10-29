// 16:9 edit decision list — 120 BPM grid (beat = 0.5s, bar = 2s).
window.makeEDL = ({ W, H, clamp, lerp, ease, easeOut, easeIn }) => {
  const TD = 4664, IMPACT = 9356; // gamecast clip events (ms)
  const shake = (g, t, amp, dur) => { const k = clamp((g - t) / dur); if (k <= 0 || k >= 1) return [0, 0]; const a = amp * (1 - k) * (1 - k); return [a * Math.sin(g * 91.7), a * Math.cos(g * 73.3)]; };
  const cam = (x0, y0, w0, x1, y1, w1, e = ease) => (p) => ({ x: lerp(x0, x1, e(p)), y: lerp(y0, y1, e(p)), w: lerp(w0, w1, e(p)) });
  const shots = [
    // 1 ANTICIPATION — the app's real front door: WELCOME / TO / THE / WEEKEND League
    { t0: 1.4, t1: 8.0, src: { clip: "h_intro", ms: (g) => (g - 1.0) * 1000 }, cam: cam(960, 540, 1920, 960, 470, 1680),
      filter: (p, g) => `brightness(${clamp((g - 1.4) / 0.6)})` },
    // 2 THE WORLD — /weekend
    { t0: 8.0, t1: 12.0, src: { clip: "h_home", ms: (g) => (g - 8.0 + 0.2) * 1000 },
      panel: (p) => ({ rx: lerp(20, 8, ease(p)), ry: lerp(22, 9, ease(p)), rz: lerp(-3, -1, ease(p)), s: lerp(0.74, 0.86, ease(p)), tx: lerp(-60, 0, ease(p)) }) },
    // 3 home as a physical object
    { t0: 12.0, t1: 16.0, src: { clip: "h_home", ms: (g) => (g - 12.0 + 4.6) * 1000 },
      panel: (p) => ({ rx: lerp(22, 9, ease(p)), ry: lerp(-24, -10, ease(p)), rz: lerp(3, 1, ease(p)), s: lerp(0.78, 0.9, ease(p)), tx: lerp(60, 0, ease(p)) }) },
    // 4 GAME DAY — live ticker macro behind the title
    { t0: 16.0, t1: 18.0, src: { clip: "h_home", ms: (g) => (g - 16.0) * 650 }, cam: cam(820, 232, 900, 1100, 232, 820, (x) => x),
      filter: (p) => `brightness(${lerp(0.55, 0.4, p)}) blur(${lerp(1.5, 3, p)}px)` },
    // 5 Your Week hero card
    { t0: 18.0, t1: 20.0, src: { still: "h_home.png" }, cam: cam(1920, 3530, 3450, 1920, 3500, 3050) },
    // 6 matchup header — The Grudge, win probability
    { t0: 20.0, t1: 21.0, src: { still: "h_matchup.png" }, cam: cam(1920, 1290, 3250, 1920, 1300, 3000, easeOut) },
    // 7 lineup detail: Mahomes / Allen, Gibbs / Henry
    { t0: 21.0, t1: 22.0, src: { still: "h_matchup.png" }, cam: cam(1920, 2050, 3150, 1920, 2380, 3050, (x) => x) },
    // 8 GAMECAST — red zone -> TOUCHDOWN (TD lands on 25.0)
    { t0: 22.0, t1: 27.0, src: { clip: "h_gamecast", ms: (g) => (g - 25.0) * 1000 + TD },
      cam: (p, g) => {
        const pre = clamp((g - 22) / 3), post = easeOut(clamp((g - 25) / 0.35)), drift = clamp((g - 25.35) / 1.65);
        const w = g < 25 ? lerp(1750, 1480, ease(pre)) : lerp(1480, 1180, post) - 40 * drift;
        const [sx, sy] = shake(g, 25.0, 22, 0.45);
        return { x: g < 25 ? 960 : lerp(960, 900, post), y: g < 25 ? 720 : lerp(720, 660, post), w, sx, sy };
      } },
    // 9 Fantasy Impact — your players, live (refresh lands on 28.0)
    { t0: 27.0, t1: 30.0, src: { clip: "h_gamecast", ms: (g) => (g - 28.0) * 1000 + IMPACT }, cam: cam(1200, 1170, 1380, 1180, 1195, 1260) },
    // 10 the matchup flips
    { t0: 30.0, t1: 30.5, src: { still: "h_matchup.png" }, cam: cam(1920, 1300, 3350, 1920, 1300, 3350) },
    { t0: 30.5, t1: 32.0, src: { still: "h_matchup2.png" }, cam: (p, g) => { const [sx, sy] = shake(g, 30.5, 14, 0.3); return { x: 1920, y: 1300, w: lerp(3350, 3150, easeOut(p)), sx, sy }; } },
    // 11 THE LEAGUE — chat, live
    { t0: 32.0, t1: 38.0, src: { clip: "h_chat", ms: (g) => (g - 32.0) * 1000 + 600 },
      panel: (p) => ({ rx: lerp(6, 2, ease(p)), ry: lerp(-14, -5, ease(p)), rz: 0, s: lerp(0.98, 1.04, ease(p)), h: lerp(0.98, 1.04, ease(p)), tx: 220 }),
      cam: cam(1330, 560, 1250, 1330, 640, 1100) },
    // 12 AI weekly recap
    { t0: 38.0, t1: 40.0, src: { still: "h_home.png" }, cam: cam(1920, 5300, 3100, 1920, 5320, 2850) },
    // 13 weekly awards
    { t0: 40.0, t1: 42.0, src: { still: "h_home.png" }, cam: cam(1500, 4520, 3000, 2300, 4520, 2800, (x) => x) },
    // 14 rivalry: all-time head-to-head
    { t0: 42.0, t1: 44.0, src: { still: "h_matchup.png" }, cam: cam(1920, 6640, 2300, 1920, 6660, 2050) },
    // 15 DETAIL — win probability
    { t0: 44.0, t1: 46.5, src: { still: "h_matchup2.png" }, cam: cam(900, 1590, 1500, 1500, 1590, 1350, (x) => x) },
    // 16 DETAIL — Jeffrey's Rule chug countdown (league culture)
    { t0: 46.5, t1: 49.0, src: { clip: "h_home", ms: (g) => (g - 46.5) * 560 }, cam: cam(958, 490, 1560, 958, 500, 1500) },
    // 17 DETAIL — the reaction
    { t0: 49.0, t1: 51.5, src: { clip: "h_chat", ms: () => 99999 }, cam: cam(1480, 820, 860, 1480, 830, 720) },
    // 18 DETAIL — your players' faces
    { t0: 51.5, t1: 53.5, src: { clip: "h_gamecast", ms: () => 99999 }, cam: cam(1300, 1230, 1000, 1300, 1230, 820),
      filter: (p) => `brightness(${lerp(1, 0.55, easeIn(p))}) blur(${lerp(0, 4, easeIn(p))}px)` },
  ];
  const stills = ["h_home.png", "h_matchup.png", "h_matchup2.png"];

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
    return `<div class="title" style="top:${H / 2 - size * 0.62}px;font-size:${size}px;opacity:${op};transform:scale(${sc});letter-spacing:${track}em;text-shadow:0 0 30px rgba(255,23,68,.9),0 0 80px rgba(255,23,68,.6),0 6px 30px rgba(0,0,0,.8)">${text}</div>`;
  };
  const lowerThird = (g, t0, t1, text, x, y, size) => {
    if (g < t0 || g >= t1) return "";
    const k = easeOut(clamp((g - t0) / 0.35)), out = clamp((g - (t1 - 0.3)) / 0.3);
    const shade = `<div style="position:absolute;inset:0;opacity:${k * (1 - out)};background:linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.55) 22%, transparent 45%)"></div>`;
    return shade + `<div class="lower" style="left:${x}px;top:${y}px;font-size:${size}px;opacity:${1 - out}">
      <span class="bar" style="width:${size * 3.2}px;transform:scaleX(${k})"></span>
      <span style="display:inline-block;clip-path:inset(0 ${100 - k * 100}% 0 0);text-shadow:0 4px 24px rgba(0,0,0,.9)">${text}</span></div>`;
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
      <div class="title" style="letter-spacing:.14em;color:#fff;text-shadow:0 0 6px rgba(255,255,255,.8),0 0 28px rgba(255,23,68,.9),0 0 70px rgba(255,23,68,.6),0 0 140px rgba(255,23,68,.35);top:${H * 0.30}px;text-align:center;font-size:200px;opacity:${flick};transform:scale(${sc})">THE WEEKEND</div>
      <div class="title" style="top:${H * 0.60}px;font-size:54px;letter-spacing:.32em;color:#fff">
        <span style="opacity:${tag};display:inline-block;transform:translateY(${lerp(14, 0, easeOut(tag))}px)">YOUR LEAGUE.</span>
        <span style="opacity:${tag2};display:inline-block;transform:translateY(${lerp(14, 0, easeOut(tag2))}px);color:#ff1744;text-shadow:0 0 24px rgba(255,23,68,.7)">&nbsp;YOUR SUNDAY.</span></div>
    </div>`;
  };
  const text = (g) =>
    slam(g, 16.0, 18.0, "GAME DAY", 230) +
    lowerThird(g, 28.1, 30.0, "EVERY POINT MATTERS", 120, 850, 84) +
    lowerThird(g, 32.35, 34.4, "YOUR LEAGUE. LIVE.", 120, 850, 84) +
    endCard(g);
  return { shots, stills, flash, bg, overlay, text, duration: 60.5 };
};
