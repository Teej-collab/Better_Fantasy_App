// v2 edit decision list, shared by both formats (branches on W > H).
// 120 BPM grid (beat = 0.5s, bar = 2s). Framing rule for v2: full-screen
// shots only, gentle drift (<= ~5%), no macro crops.
window.makeEDL = ({ W, H, clamp, lerp, ease, easeOut, easeIn }) => {
  const HZ = W > H;
  const F = HZ ? "h" : "v";
  // clip event times (ms), detected from the captures
  const EV = HZ
    ? { intro: 1.0, TD: 4664, IMPACT: 9356, CHUG: 3895, TYPE: 5790, SAVED: 13019 }
    : { intro: 0.96, TD: 4591, IMPACT: 17000, CHUG: 3893, TYPE: 5697, SAVED: 12945 };
  const FW = HZ ? 1920 : 1080, FH = HZ ? 1080 : 1920; // clip frame size
  const SW = HZ ? 3840 : 1296;                       // still width (3x)
  const shake = (g, t, amp, dur) => { const k = clamp((g - t) / dur); if (k <= 0 || k >= 1) return [0, 0]; const a = amp * (1 - k) * (1 - k); return [a * Math.sin(g * 91.7), a * Math.cos(g * 73.3)]; };
  const cam = (x0, y0, w0, x1, y1, w1, e = ease) => (p) => ({ x: lerp(x0, x1, e(p)), y: lerp(y0, y1, e(p)), w: lerp(w0, w1, e(p)) });
  // full frame with a gentle push (drift = fraction of width removed by the end)
  const full = (drift = 0.04, cx = FW / 2, cy = FH / 2) => cam(cx, cy, FW, cx, cy, FW * (1 - drift));
  const stillFull = (cy, drift = 0.04) => cam(SW / 2, cy, SW, SW / 2, cy, SW * (1 - drift));
  const clip = (name) => `${F}_${name}`;

  const shots = [
    // 1 ANTICIPATION — the real front door
    { t0: 1.4, t1: 8.0, src: { clip: clip("intro"), ms: (g) => (g - EV.intro) * 1000 }, cam: full(0.06),
      filter: (p, g) => `brightness(${clamp((g - 1.4) / 0.6)})` },
    // 2 THE WORLD — home dashboard, the whole screen, floating
    { t0: 8.0, t1: 12.0, src: { clip: clip("home"), ms: (g) => (g - 8.0 + 0.2) * 1000 },
      panel: (p) => ({ rx: lerp(10, 4, ease(p)), ry: lerp(-12, -4, ease(p)), rz: lerp(1.5, 0.5, ease(p)), s: lerp(0.88, 0.95, ease(p)) }) },
    // 3 GAME DAY
    { t0: 12.0, t1: 14.0, src: { clip: clip("home"), ms: (g) => (g - 12.0) * 1000 + 4400 }, cam: full(0.03),
      filter: (p) => `brightness(${lerp(0.5, 0.38, p)}) blur(${lerp(2, 4, p)}px)` },
    // 4 the matchup
    { t0: 14.0, t1: 16.0, src: { still: `${F}_matchup.png` }, cam: stillFull(HZ ? 1080 : 1152, 0.04) },
    // 5 GAMECAST — red zone, then the TD lands on 19.0
    { t0: 16.0, t1: 21.0, src: { clip: clip("gamecast"), ms: (g) => (g - 19.0) * 1000 + EV.TD },
      cam: (p, g) => { const [sx, sy] = shake(g, 19.0, 16, 0.4); return { x: FW / 2, y: FH / 2, w: FW * lerp(1, 0.96, ease(p)), sx, sy }; } },
    // 6 FANTASY IMPACT — pan (not zoom) down to your players
    HZ
      ? { t0: 21.0, t1: 24.0, src: { clip: "h_gamecast", ms: (g) => (g - 22.5) * 1000 + EV.IMPACT },
          cam: (p, g) => ({ x: 960, y: lerp(540, 1410, ease(clamp((g - 21.0) / 1.3))), w: 1920 }) }
      : { t0: 21.0, t1: 24.0, src: { clip: "v_gamecast", ms: (g) => (g - 21.0) * 1000 + EV.IMPACT }, cam: full(0.02) },
    // 7 the matchup flips
    { t0: 24.0, t1: 24.5, src: { still: `${F}_matchup.png` }, cam: stillFull(HZ ? 1080 : 1152, 0.0) },
    { t0: 24.5, t1: 26.0, src: { still: `${F}_matchup2.png` },
      cam: (p, g) => { const [sx, sy] = shake(g, 24.5, 12, 0.3); return { x: SW / 2, y: HZ ? 1080 : 1152, w: SW * lerp(1, 0.96, easeOut(p)), sx, sy }; } },
    // 8 THE LEAGUE — chat, live
    { t0: 26.0, t1: 32.0, src: { clip: clip("chat"), ms: (g) => (g - 26.0) * 1000 + 600 },
      panel: (p) => ({ rx: lerp(5, 2, ease(p)), ry: lerp(-8, -3, ease(p)), rz: 0, s: lerp(0.92, 0.97, ease(p)) }) },
    // 9 CHUG ANALYZER — upload, AI grade lands on 36.0, then the feed + leaderboard
    { t0: 32.0, t1: 44.0, src: { clip: clip("chug"), ms: (g) => (g < 40 ? (g - 36.0) * 1000 + EV.CHUG : EV.CHUG + 4000 + (g - 40) * 1500) },
      cam: full(0.04) },
    // 10 RULE CUSTOMIZATION — commissioner hub -> scoring rules edit -> save (Saved lands on 52.0)
    { t0: 44.0, t1: 47.0, src: { clip: clip("commish"), ms: (g) => (g - 44.0) * 1000 + 450 }, cam: full(0.03) },
    { t0: 47.0, t1: 50.5, src: { clip: clip("commish"), ms: (g) => (g - 48.5) * 1000 + EV.TYPE }, cam: full(0.03) },
    { t0: 50.5, t1: 54.0, src: { clip: clip("commish"), ms: (g) => (g - 52.0) * 1000 + EV.SAVED }, cam: full(0.03) },
    // 11 AI recap + weekly awards
    { t0: 54.0, t1: 56.0, src: { still: `${F}_home.png` }, cam: stillFull(HZ ? 4770 : 5300, 0.04) },
    // 12 montage on the beat (every feature, full frame)
    { t0: 56.0, t1: 56.5, src: { clip: clip("gamecast"), ms: () => EV.TD + 300 }, cam: full(0) },
    { t0: 56.5, t1: 57.0, src: { clip: clip("chug"), ms: () => EV.CHUG + 600 }, cam: full(0) },
    { t0: 57.0, t1: 57.5, src: { clip: clip("commish"), ms: () => EV.SAVED + 400 }, cam: full(0) },
    { t0: 57.5, t1: 58.0, src: { clip: clip("chat"), ms: () => 99999 }, cam: full(0),
      filter: (p) => `brightness(${lerp(1, 0.3, easeIn(p))})` },
  ];
  const stills = [`${F}_home.png`, `${F}_matchup.png`, `${F}_matchup2.png`];

  const flashAt = (g, t, dur, color) => { const k = (g - t) / dur; return k >= 0 && k < 1 ? `rgba(${color},${(1 - k) * (1 - k)})` : null; };
  const flash = (g) =>
    flashAt(g, 7.9, 0.55, "200,255,210") || flashAt(g, 12.0, 0.22, "255,255,255") || flashAt(g, 19.0, 0.3, "255,255,255") ||
    flashAt(g, 24.5, 0.18, "255,255,255") || flashAt(g, 26.0, 0.16, "255,40,70") || flashAt(g, 32.0, 0.2, "255,170,40") ||
    flashAt(g, 36.0, 0.25, "255,200,80") || flashAt(g, 44.0, 0.2, "255,40,70") || flashAt(g, 52.0, 0.2, "120,255,140") ||
    flashAt(g, 56.0, 0.1, "255,255,255") || flashAt(g, 56.5, 0.1, "255,255,255") || flashAt(g, 57.0, 0.1, "255,255,255") || "transparent";
  const bg = (g) => {
    const pulse = g < 1.4 ? 0.06 + 0.05 * Math.pow(Math.max(0, Math.sin(g * Math.PI * 2 * 1.0)), 8) : 0.1;
    return `radial-gradient(ellipse at 50% 55%, rgba(255,23,68,${pulse}) 0%, rgba(20,0,6,.6) 45%, #000 80%)`;
  };
  const overlay = (g) => ((g >= 8 && g < 12) || (g >= 26 && g < 32) ? "radial-gradient(ellipse at 50% 110%, rgba(255,23,68,.18), transparent 60%)" : "");

  const slam = (g, t0, t1, text, size) => {
    if (g < t0 || g >= t1) return "";
    const k = clamp((g - t0) / 0.18), out = clamp((g - (t1 - 0.25)) / 0.25);
    const sc = lerp(1.35, 1.0, easeOut(k)), op = k * (1 - out);
    const track = lerp(0.3, 0.06, easeOut(clamp((g - t0) / 1.6)));
    const lines = text.split("<br>").length;
    return `<div class="title" style="top:${H / 2 - size * 0.62 * lines}px;font-size:${size}px;line-height:1.0;opacity:${op};transform:scale(${sc});letter-spacing:${track}em;text-shadow:0 0 30px rgba(255,23,68,.9),0 0 80px rgba(255,23,68,.6),0 6px 30px rgba(0,0,0,.8)">${text}</div>`;
  };
  // lower third with its own shade so it never fights the UI underneath
  const lowerThird = (g, t0, t1, text, sub = "", top = false) => {
    if (g < t0 || g >= t1) return "";
    const k = easeOut(clamp((g - t0) / 0.35)), out = clamp((g - (t1 - 0.3)) / 0.3);
    const size = HZ ? 78 : 88, x = HZ ? 110 : 64, y = top ? (HZ ? 70 : 150) : HZ ? (sub ? 790 : 830) : 1420;
    const shade = `<div style="position:absolute;inset:0;opacity:${k * (1 - out)};background:linear-gradient(to ${top ? "bottom" : "top"}, rgba(0,0,0,.88) 0%, rgba(0,0,0,.6) ${HZ ? 26 : 22}%, transparent ${HZ ? 48 : 40}%)"></div>`;
    const subHtml = sub ? `<span style="display:block;margin-top:14px;font-family:'IBM Plex Sans',sans-serif;font-weight:500;font-size:${Math.round(size * 0.36)}px;letter-spacing:.03em;color:rgba(255,255,255,.82)">${sub}</span>` : "";
    return shade + `<div class="lower" style="left:${x}px;top:${y}px;font-size:${size}px;opacity:${1 - out};white-space:normal;max-width:${W - 2 * x}px">
      <span class="bar" style="width:${size * 3.2}px;transform:scaleX(${k})"></span>
      <span style="display:inline-block;line-height:1.02;clip-path:inset(0 ${100 - k * 100}% 0 0);text-shadow:0 4px 24px rgba(0,0,0,.9)">${text}${subHtml}</span></div>`;
  };
  const endCard = (g) => {
    if (g < 58.0) return "";
    const fade = 1 - clamp((g - 63.7) / 1.0);
    const tt = g - 58.2;
    const flick = tt < 0 ? 0 : tt < 0.9 ? ([0.15, 0.9, 0.1, 0.6, 1, 0.35, 1, 1, 0.8, 1][Math.floor(tt / 0.09)] ?? 1) : 1;
    const sc = lerp(1.06, 1.0, easeOut(clamp(tt / 5.5)));
    const tag = clamp((g - 59.5) / 0.8), tag2 = clamp((g - 60.0) / 0.8);
    const wm = HZ ? "THE WEEKEND" : "THE<br>WEEKEND";
    return `<div style="position:absolute;inset:0;opacity:${fade}">
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%, rgba(255,23,68,${0.18 * flick}) 0%, rgba(255,23,68,${0.04 * flick}) 30%, transparent 60%)"></div>
      <div class="title" style="top:${H * (HZ ? 0.30 : 0.33)}px;font-size:${HZ ? 200 : 170}px;line-height:1.0;letter-spacing:.14em;color:#fff;opacity:${flick};transform:scale(${sc});text-shadow:0 0 6px rgba(255,255,255,.8),0 0 28px rgba(255,23,68,.9),0 0 70px rgba(255,23,68,.6),0 0 140px rgba(255,23,68,.35)">${wm}</div>
      <div class="title" style="top:${H * (HZ ? 0.60 : 0.52)}px;font-size:${HZ ? 54 : 58}px;letter-spacing:.3em;color:#fff;line-height:1.5">
        <span style="opacity:${tag};display:inline-block;transform:translateY(${lerp(14, 0, easeOut(tag))}px)">YOUR LEAGUE.</span>${HZ ? "&nbsp;" : "<br>"}<span style="opacity:${tag2};display:inline-block;transform:translateY(${lerp(14, 0, easeOut(tag2))}px);color:#ff1744;text-shadow:0 0 24px rgba(255,23,68,.7)">YOUR RULES.</span></div>
    </div>`;
  };
  const br = HZ ? " " : "<br>";
  const text = (g) =>
    slam(g, 12.0, 14.0, HZ ? "GAME DAY" : "GAME<br>DAY", HZ ? 230 : 250) +
    lowerThird(g, 22.6, 24.0, `EVERY POINT${br}MATTERS`) +
    lowerThird(g, 26.35, 28.6, `YOUR LEAGUE.${br}LIVE.`) +
    lowerThird(g, 32.2, 35.4, `SCORE ZERO?${br}YOU CHUG.`, "Jeffrey's Rule, built into the app", true) +
    lowerThird(g, 36.2, 39.4, `AI-GRADED${br}CHUGS.`, "Upload the video. Get a grade, and a roast.", true) +
    lowerThird(g, 44.2, 46.8, `YOUR LEAGUE.${br}YOUR RULES.`, "Scoring, rosters, keepers, playoffs, trades") +
    lowerThird(g, 48.4, 50.4, `CUSTOM${br}SCORING.`, "QB tackle worth 15? Your call.") +
    endCard(g);
  return { shots, stills, flash, bg, overlay, text, duration: 65.0 };
};
