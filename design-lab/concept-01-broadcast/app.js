/* THE BOOTH — app.js. Vanilla JS hash-router SPA. No dependencies. */
(() => {
"use strict";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- ICONS (inline SVG, stroke-based, no emoji) ---------------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/></svg>',
  league: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M12 13v3M9 20h6"/></svg>',
  matchup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="8" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 10l4 4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v11H9l-5 4V5Z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 12l18-8-6 8 6 8-18-8Z"/></svg>',
};

/* ---------------- DATA ---------------- */
const TEAMS = [
  { id: "blitz", name: "Blitzkrieg Bop", owner: "Marcus", w: 5, l: 1, pf: 812.4, color: "#FF5A1F" },
  { id: "turf", name: "Turf Kings", owner: "Tyler", w: 4, l: 2, pf: 798.6, color: "#2FD4C8", me: true },
  { id: "air", name: "Air Yard Sale", owner: "Priya", w: 4, l: 2, pf: 790.4, color: "#E8B84B" },
  { id: "bandits", name: "Gridiron Bandits", owner: "Sam", w: 4, l: 2, pf: 781.2, color: "#3FCF6E" },
  { id: "zoom", name: "Legion of Zoom", owner: "Devon", w: 3, l: 3, pf: 774.0, color: "#9A9A9E" },
  { id: "hmp", name: "Hail Mary Poppins", owner: "Ava", w: 3, l: 3, pf: 766.9, color: "#FF5A1F" },
  { id: "rzr", name: "Red Zone Rejects", owner: "Liam", w: 3, l: 3, pf: 758.0, color: "#2FD4C8" },
  { id: "scaries", name: "Sunday Scaries", owner: "Jordan", w: 2, l: 4, pf: 744.7, color: "#E8B84B" },
  { id: "fumble", name: "Fumble Rooski", owner: "Ben", w: 2, l: 4, pf: 730.5, color: "#9A9A9E" },
  { id: "potatoes", name: "Couch Potatoes", owner: "Nora", w: 1, l: 5, pf: 702.1, color: "#FF4D4D" },
];
const standings = () => [...TEAMS].sort((a, b) => b.w - a.w || b.pf - a.pf);

const PLAYERS = {
  herbert: { id: "herbert", name: "Justin Herbert", pos: "QB", team: "LAC", opp: "@DEN", pts: 24.2, proj: 21.4, status: "live", stats: [["CMP/ATT", "22/29"], ["YDS", "268"], ["TD", "2"], ["INT", "0"]] },
  bijan: { id: "bijan", name: "Bijan Robinson", pos: "RB", team: "ATL", opp: "@CAR", pts: 18.6, proj: 15.8, status: "live", stats: [["CAR", "14"], ["YDS", "71"], ["REC", "3"], ["TD", "1"]] },
  henry: { id: "henry", name: "Derrick Henry", pos: "RB", team: "BAL", opp: "BYE", pts: 0, proj: 12.1, status: "bye", stats: [["CAR", "—"], ["YDS", "—"], ["REC", "—"], ["TD", "—"]] },
  chase: { id: "chase", name: "Ja'Marr Chase", pos: "WR", team: "CIN", opp: "vs BAL", pts: 21.1, proj: 16.9, status: "live", stats: [["REC", "6"], ["YDS", "88"], ["TD", "1"], ["TGT", "8"]] },
  wilson: { id: "wilson", name: "Garrett Wilson", pos: "WR", team: "NYJ", opp: "vs MIA", pts: 8.4, proj: 13.2, status: "q", stats: [["REC", "4"], ["YDS", "44"], ["TD", "0"], ["TGT", "6"]] },
  kelce: { id: "kelce", name: "Travis Kelce", pos: "TE", team: "KC", opp: "@BUF", pts: 12.3, proj: 11.0, status: "live", stats: [["REC", "5"], ["YDS", "53"], ["TD", "1"], ["TGT", "6"]] },
  odunze: { id: "odunze", name: "Rome Odunze", pos: "FLEX", team: "CHI", opp: "@MIN", pts: 9.9, proj: 10.4, status: "final", stats: [["REC", "4"], ["YDS", "59"], ["TD", "0"], ["TGT", "5"]] },
  broncos: { id: "broncos", name: "Broncos D/ST", pos: "DST", team: "DEN", opp: "vs LAC", pts: 4.0, proj: 6.5, status: "live", stats: [["SACK", "2"], ["INT", "1"], ["PTS ALLOW", "17"], ["TD", "0"]] },
  butker: { id: "butker", name: "Harrison Butker", pos: "K", team: "KC", opp: "@BUF", pts: 6.0, proj: 7.2, status: "live", stats: [["FG", "2/2"], ["LONG", "48"], ["XP", "0/0"], ["PTS", "6"]] },
  charbonnet: { id: "charbonnet", name: "Zach Charbonnet", pos: "RB", team: "SEA", opp: "@LAR", pts: 6.1, proj: 8.0, status: "final", stats: [["CAR", "9"], ["YDS", "38"], ["REC", "2"], ["TD", "0"]] },
  waddle: { id: "waddle", name: "Jaylen Waddle", pos: "WR", team: "MIA", opp: "@NYJ", pts: 11.3, proj: 12.0, status: "live", stats: [["REC", "5"], ["YDS", "61"], ["TD", "0"], ["TGT", "7"]] },
  murray: { id: "murray", name: "Kyler Murray", pos: "QB", team: "ARI", opp: "vs SF", pts: 15.8, proj: 17.5, status: "final", stats: [["CMP/ATT", "19/27"], ["YDS", "231"], ["TD", "1"], ["INT", "0"]] },
};

const STARTERS = ["herbert", "bijan", "henry", "chase", "wilson", "kelce", "odunze", "broncos", "butker"];
const BENCH = ["charbonnet", "waddle", "murray"];

const gamecast = {
  away: { abbr: "KC", score: 17 }, home: { abbr: "BUF", score: 24 },
  q: "Q3", clock: "8:42", possession: "BUF", down: "2nd & 6", yardline: "KC 34", redzone: false,
  plays: [
    { t: "8:42", d: "2nd & 6 at KC 34", desc: "J. Allen pass complete to K. Coleman for 9 yards.", type: "" },
    { t: "9:10", d: "1st & 10 at KC 43", desc: "J. Cook rush for 9 yards.", type: "" },
    { t: "10:02", d: "3rd & 4 at BUF 48", desc: "J. Allen pass complete to D. Kincaid for 14 yards. BIG PLAY.", type: "big" },
    { t: "13:44", d: "TOUCHDOWN", desc: "H. Butker 48 yard field goal is GOOD.", type: "scoring" },
  ],
  fantasyImpact: [
    { name: "Travis Kelce", note: "5-yd reception, 3rd down conversion", delta: "+1.6" },
    { name: "Harrison Butker", note: "42-yd field goal, good", delta: "+3.0" },
  ],
};

const CHAT_SEED = [
  { who: "MARCUS", pin: true, text: "Waiver processing moved to Wednesday 8pm this week — Thursday night game." },
  { who: "PRIYA", text: "anyone else's Bijan not showing live? refresh isn't fixing it for me" },
  { who: "SAM", text: "yeah same, feed's lagging for everyone rn" },
  { who: "ME", me: true, text: "should sort itself out by the next drive, happens most Sundays" },
  { who: "SAM", text: "🔥 Chase just went off, 21 and counting" },
];

const ACTIVITY = [
  { t: "4m", text: "Jordan dropped Zach Charbonnet" },
  { t: "22m", text: "Ava and Sam completed a trade" },
  { t: "1h", text: "Draft grades are live — see who won" },
  { t: "3h", text: "Marcus posted in Commish's Corner" },
];

const DRAFT_ORDER = ["blitz", "turf", "air", "bandits", "zoom", "hmp", "rzr", "scaries"];
const DRAFT_POOL = ["A. St. Brown", "T. Etienne", "D. Achane", "M. Nabers", "B. Thomas", "J. Jacobs", "D. Moore", "T. Higgins", "R. Stevenson", "C. Lamb"];

/* ---------------- STATE ---------------- */
const state = {
  chat: [...CHAT_SEED],
  draftPickIndex: 12,
  draftClock: 90,
  homeScore: 1084, // tenths, for flip demo (108.4)
};

/* ---------------- helpers ---------------- */
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function teamById(id) { return TEAMS.find((t) => t.id === id); }
function wrapDigits(str) { return [...String(str)].map((c) => `<span class="digit">${c}</span>`).join(""); }
function playerRow(p, opts = {}) {
  const statusTag = p.status === "live" ? '<span class="badge-pill" style="background:rgba(255,90,31,.15);color:var(--live)">LIVE</span>'
    : p.status === "q" ? '<span class="badge-pill" style="background:rgba(232,184,75,.15);color:var(--gold)">Q</span>'
    : p.status === "bye" ? '<span class="badge-pill" style="background:rgba(154,154,158,.15);color:var(--text-dim)">BYE</span>' : "";
  return `<button class="row row-btn player-row" data-nav="player/${p.id}">
    <span class="pos-chip">${p.pos}</span>
    <span class="avatar">${esc(p.team)}</span>
    <span style="flex:1;min-width:0">
      <span class="player-name" style="display:block">${esc(p.name)}</span>
      <span class="player-meta">${esc(p.team)} ${esc(p.opp)} ${statusTag ? "· " + statusTag : ""}</span>
    </span>
    ${opts.hidePts ? "" : `<span style="text-align:right"><span class="player-pts tabular">${p.pts.toFixed(1)}</span><span class="player-proj tabular" style="display:block">PROJ ${p.proj.toFixed(1)}</span></span>`}
  </button>`;
}

/* ---------------- ROUTES ---------------- */
const routes = {
  login: renderLogin,
  home: renderHome,
  league: renderLeague,
  matchup: renderMatchup,
  myteam: renderMyTeam,
  player: renderPlayer,
  draft: renderDraft,
  gamecast: renderGamecast,
  chat: renderChat,
  standings: renderStandings,
  activity: renderActivity,
  profile: renderProfile,
};

function renderLogin() {
  return `
  <div class="corner-brackets"><span class="tl"></span><span class="tr"></span><span class="bl"></span><span class="br"></span></div>
  <div class="login-wrap">
    <div class="eyebrow live" style="margin-bottom:14px"><span class="live-dot" style="display:inline-block;margin-right:6px"></span>WEEK 7 · LIVE NOW</div>
    <h1 class="login-word">THE <span class="stroke">WEEKEND</span></h1>
    <p class="login-tag">This isn't just managing a fantasy team. This is where your league lives on Sunday.</p>
    <div class="login-actions">
      <button class="btn btn-live btn-block" data-nav="home">ENTER THE BOOTH</button>
      <button class="btn btn-outline btn-block" data-nav="home">SIGN IN WITH DISCORD</button>
    </div>
  </div>`;
}

function renderHome() {
  const me = teamById("turf");
  const opp = teamById("air");
  return `
  <div class="page">
    <div class="section" style="display:flex;align-items:baseline;justify-content:space-between">
      <div><div class="eyebrow">Good afternoon</div><h1 class="h1">TYLER</h1></div>
      <button class="icon-btn" data-nav="activity" aria-label="Activity">${ICONS.bell}</button>
    </div>

    <div class="section">
      <div class="section-head"><span class="eyebrow live"><span class="live-dot" style="display:inline-block;margin-right:6px"></span>YOUR MATCHUP</span><a class="link-more" data-nav="matchup">FULL VIEW →</a></div>
      <div class="block scorebox diagonal-cut" data-nav="matchup" style="cursor:pointer">
        <div class="scorebox-head"><span class="live-tag"><span class="live-dot"></span>LIVE · Q3 8:42</span><span class="badge-pill badge-stat">73% WIN</span></div>
        <div class="score-grid">
          <div class="score-team">
            <span class="team-chip"><span class="swatch" style="background:${me.color}"></span>${esc(me.name)}</span>
            <span class="score-num tabular" id="home-hero-score">${wrapDigits("108.4")}</span>
            <span class="score-proj">PROJ 121.7</span>
          </div>
          <span class="score-vs">VS</span>
          <div class="score-team right">
            <span class="team-chip"><span class="swatch" style="background:${opp.color}"></span>${esc(opp.name)}</span>
            <span class="score-num tabular" style="color:var(--text-dim)">96.1</span>
            <span class="score-proj">PROJ 108.9</span>
          </div>
        </div>
        <div class="winprob"><div class="winprob-label"><span>WIN PROB</span><span>73 / 27</span></div><div class="winprob-bar"><div class="winprob-fill" style="width:73%"></div></div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><span class="eyebrow live">ON AIR NOW</span><a class="link-more" data-nav="gamecast">GAMECAST →</a></div>
      <div class="block">
        <button class="row row-btn" data-nav="gamecast">
          <span class="live-dot"></span>
          <span style="flex:1"><b style="font-family:var(--font-display);font-weight:800">KC 17 – BUF 24</b><span class="player-meta" style="display:block">Q3 8:42 · BUF ball, 2nd &amp; 6</span></span>
          <span class="badge-pill" style="background:rgba(232,184,75,.15);color:var(--gold)">FANTASY IMPACT</span>
        </button>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><span class="eyebrow">STANDINGS</span><a class="link-more" data-nav="standings">FULL →</a></div>
      <div class="block">
        ${standings().slice(0, 3).map((t, i) => `<div class="stand-row ${t.me ? "stand-me" : ""}"><span class="stand-rank">${i + 1}</span><span><span class="stand-name">${esc(t.name)}</span></span><span class="stand-record tabular">${t.w}-${t.l}</span><span class="stand-pf tabular">${t.pf.toFixed(1)}</span></div>`).join("")}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><span class="eyebrow">LEAGUE ACTIVITY</span><a class="link-more" data-nav="activity">ALL →</a></div>
      <div class="block">${ACTIVITY.slice(0, 3).map((a) => `<div class="row"><span style="flex:1;font-size:13px">${esc(a.text)}</span><span class="player-meta">${a.t}</span></div>`).join("")}</div>
    </div>
  </div>`;
}

function renderLeague() {
  return `
  <div class="page">
    <h1 class="h1">LEAGUE</h1>
    <p class="sub">The Weekend League · 10 teams · 2026</p>
    <div class="section" style="margin-top:20px">
      <div class="eyebrow" style="margin-bottom:10px">STANDINGS</div>
      <div class="block">${standings().map((t, i) => `<div class="stand-row ${t.me ? "stand-me" : ""}"><span class="stand-rank">${i + 1}</span><span><span class="stand-name">${esc(t.name)}</span><span class="stand-owner" style="display:block">${esc(t.owner)}</span></span><span class="stand-record tabular">${t.w}-${t.l}</span><span class="stand-pf tabular">${t.pf.toFixed(1)}</span></div>`).join("")}</div>
    </div>
    <div class="grid-2 section">
      <button class="block row-btn" style="padding:16px" data-nav="draft"><span class="eyebrow">DRAFT</span><div class="h2" style="margin-top:6px">Class of '26</div><span class="player-meta">Grades live</span></button>
      <button class="block row-btn" style="padding:16px" data-nav="activity"><span class="eyebrow">ACTIVITY</span><div class="h2" style="margin-top:6px">4 new</div><span class="player-meta">Trades, waivers</span></button>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:10px">ALL-TIME RECORDS</div>
      <div class="block">
        <div class="row"><span style="flex:1">Highest single-week score</span><b class="tabular">184.6</b></div>
        <div class="row"><span style="flex:1">Biggest blowout</span><b class="tabular">187.2–61.4</b></div>
        <div class="row"><span style="flex:1">2026 MVP pace</span><b>Marcus</b></div>
      </div>
    </div>
  </div>`;
}

function renderMatchup() {
  const me = teamById("turf"), opp = teamById("air");
  const rows = STARTERS.map((id) => {
    const p = PLAYERS[id];
    return `<div class="row" style="display:grid;grid-template-columns:1fr 44px 1fr;gap:8px;align-items:center">
      <button class="row-btn" data-nav="player/${id}" style="text-align:left;display:flex;gap:6px;align-items:center;min-width:0"><span class="player-name tabular" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span></button>
      <span class="pos-chip" style="margin:0 auto">${p.pos}</span>
      <span style="text-align:right;font-size:13px;font-weight:700" class="tabular">${p.pts.toFixed(1)}</span>
    </div>`;
  }).join("");
  return `
  <div class="page">
    <button class="icon-btn" data-nav="home" aria-label="Back">${ICONS.back}</button>
    <div class="section" style="margin-top:14px">
      <div class="block scorebox">
        <div class="scorebox-head"><span class="live-tag"><span class="live-dot"></span>LIVE · Q3 8:42</span><span class="badge-pill badge-gold">RIVALRY: SUNDAY MASSACRE</span></div>
        <div class="score-grid">
          <div class="score-team"><span class="team-chip"><span class="swatch" style="background:${me.color}"></span>${esc(me.name)}</span><span class="score-num tabular">108.4</span><span class="score-proj">PROJ 121.7 · 4-2</span></div>
          <span class="score-vs">VS</span>
          <div class="score-team right"><span class="team-chip"><span class="swatch" style="background:${opp.color}"></span>${esc(opp.name)}</span><span class="score-num tabular" style="color:var(--text-dim)">96.1</span><span class="score-proj">PROJ 108.9 · 4-2</span></div>
        </div>
        <div class="winprob"><div class="winprob-label"><span>WIN PROB</span><span>73 / 27</span></div><div class="winprob-bar"><div class="winprob-fill" style="width:73%"></div></div></div>
      </div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">STARTING LINEUPS — WHY YOU'RE AHEAD</div>
      <div class="block">${rows}</div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">ALL-TIME HEAD-TO-HEAD</div>
      <div class="block row" style="justify-content:space-between"><span>${esc(me.name)} <b class="tabular">4</b> – <b class="tabular">2</b> ${esc(opp.name)}</span><span class="player-meta">Last met Wk 11, 2025</span></div>
    </div>
  </div>`;
}

function renderMyTeam() {
  return `
  <div class="page">
    <h1 class="h1">MY TEAM</h1>
    <p class="sub">Turf Kings · Week 7 · 98.2 pts so far</p>
    <div class="section" style="margin-top:16px">
      <div class="eyebrow" style="color:var(--live);margin-bottom:8px">STARTERS</div>
      <div class="block">${STARTERS.map((id) => playerRow(PLAYERS[id])).join("")}</div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">BENCH</div>
      <div class="block" style="opacity:.85">${BENCH.map((id) => playerRow(PLAYERS[id])).join("")}</div>
    </div>
  </div>`;
}

function renderPlayer(id) {
  const p = PLAYERS[id] || PLAYERS.herbert;
  return `
  <div class="page">
    <button class="icon-btn" data-nav="myteam" aria-label="Back">${ICONS.back}</button>
    <div class="player-hero">
      <span class="avatar">${esc(p.team)}</span>
      <div>
        <div class="eyebrow">${esc(p.pos)} · ${esc(p.team)} · ${esc(p.opp)}</div>
        <h1 class="h1" style="font-size:26px">${esc(p.name)}</h1>
      </div>
    </div>
    <div class="section">
      <div class="block scorebox" style="padding:14px">
        <div class="scorebox-head"><span class="live-tag"><span class="live-dot"></span>LIVE</span><span class="score-num tabular" style="font-size:32px">${p.pts.toFixed(1)}</span></div>
        <div class="score-proj">PROJECTED ${p.proj.toFixed(1)}</div>
      </div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">BOX SCORE</div>
      <div class="stat-grid">${p.stats.map(([l, v]) => `<div class="stat-cell"><div class="v tabular">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">RECENT PLAYS</div>
      <div class="block play-item scoring"><div class="pt">Q3 8:42</div>${esc(p.name)} involved in a scoring drive.</div>
    </div>
  </div>`;
}

function renderDraft() {
  const picked = DRAFT_ORDER.slice(0, state.draftPickIndex % DRAFT_ORDER.length === 0 ? DRAFT_ORDER.length : state.draftPickIndex);
  const onClockTeam = teamById(DRAFT_ORDER[state.draftPickIndex % DRAFT_ORDER.length]);
  const round = Math.floor(state.draftPickIndex / DRAFT_ORDER.length) + 1;
  const pickInRound = (state.draftPickIndex % DRAFT_ORDER.length) + 1;
  return `
  <div class="page">
    <h1 class="h1">DRAFT ROOM</h1>
    <p class="sub">The Weekend League · Class of 2026 · Snake, 15 rounds</p>
    <div class="section" style="margin-top:16px">
      <div class="otc-block">
        <div class="otc-eyebrow">ROUND ${round} · PICK ${pickInRound} · ON THE CLOCK</div>
        <div class="otc-team">${esc(onClockTeam.name)}</div>
        <div class="otc-clock tabular" id="draft-clock">${state.draftClock}</div>
      </div>
    </div>
    <div class="grid-3-desktop">
      <div>
        <div class="eyebrow" style="margin-bottom:8px">AVAILABLE PLAYERS</div>
        <div class="block">${DRAFT_POOL.map((n) => `<div class="pool-row"><span style="flex:1;font-size:13px;font-weight:600">${esc(n)}</span><button class="btn btn-live" style="min-height:34px;padding:6px 12px;font-size:11px" data-draft-pick="${esc(n)}">DRAFT</button></div>`).join("")}</div>
      </div>
      <div>
        <div class="eyebrow" style="margin-bottom:8px">DRAFT ORDER</div>
        <div class="block">${DRAFT_ORDER.map((id, i) => `<div class="row" style="${i === state.draftPickIndex % DRAFT_ORDER.length ? "background:rgba(255,90,31,.08);border-left:3px solid var(--live)" : ""}"><span class="tabular" style="width:20px;color:var(--text-dim)">${i + 1}</span><span style="flex:1;font-size:13px">${esc(teamById(id).name)}</span></div>`).join("")}</div>
      </div>
      <div>
        <div class="eyebrow" style="margin-bottom:8px">RECENT PICKS</div>
        <div class="block" id="recent-picks">${renderRecentPicks()}</div>
      </div>
    </div>
  </div>
  <div class="pick-flash" id="pick-flash"><b id="pick-flash-name"></b><span id="pick-flash-meta"></span></div>`;
}
const draftLog = [];
function renderRecentPicks() {
  if (draftLog.length === 0) return `<div class="empty">Picks will appear here as the draft goes on.</div>`;
  return [...draftLog].reverse().slice(0, 8).map((d) => `<div class="row"><span class="tabular" style="width:34px;color:var(--text-dim)">#${d.num}</span><span style="flex:1;font-size:13px">${esc(d.team)}</span><b style="font-size:12px">${esc(d.player)}</b></div>`).join("");
}

function renderGamecast() {
  const g = gamecast;
  const ballPct = 55;
  return `
  <div class="page">
    <button class="icon-btn" data-nav="home" aria-label="Back">${ICONS.back}</button>
    <div class="section" style="margin-top:14px">
      <div class="block scorebox" style="padding:14px">
        <div class="scorebox-head"><span class="live-tag"><span class="live-dot"></span>LIVE</span><span class="eyebrow">${g.q} · ${g.clock}</span></div>
        <div class="score-grid">
          <div class="score-team"><span class="team-chip">${g.away.abbr}</span><span class="score-num tabular">${g.away.score}</span></div>
          <span class="score-vs">AT</span>
          <div class="score-team right"><span class="team-chip">${g.home.abbr}</span><span class="score-num tabular">${g.home.score}</span></div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:6px">${g.possession} BALL · ${g.down} · ${g.yardline}</div>
      <div class="field-wrap">
        <div class="field">
          <div class="field-endzone" style="left:0"></div>
          <div class="field-endzone" style="right:0"></div>
          <div class="firstdown-line" style="left:68%"></div>
          <div class="ball" style="left:${ballPct}%"></div>
        </div>
        <div class="drive-info"><span>Drive: 4 plays, 31 yds</span><span>1st down at ${g.yardline}</span></div>
      </div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">FANTASY IMPACT — YOUR PLAYERS</div>
      <div class="block">${g.fantasyImpact.map((f) => `<div class="row"><span style="flex:1"><b style="font-size:13px">${esc(f.name)}</b><span class="player-meta" style="display:block">${esc(f.note)}</span></span><b class="tabular" style="color:var(--win)">${f.delta}</b></div>`).join("")}</div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">PLAY-BY-PLAY</div>
      <div class="block">${g.plays.map((p) => `<div class="play-item ${p.type}"><div class="pt">${p.t} · ${esc(p.d)}</div>${esc(p.desc)}</div>`).join("")}</div>
    </div>
  </div>`;
}

function renderChatMessages() {
  return state.chat.map((m) => `<div class="msg ${m.me ? "me" : ""} ${m.pin ? "pin" : ""}">${m.pin ? '<div class="who" style="color:var(--gold)">COMMISH\'S CORNER</div>' : m.me ? "" : `<div class="who">${esc(m.who)}</div>`}<div class="bubble">${esc(m.text)}</div></div>`).join("");
}
function renderChat() {
  return `
  <div class="chat-wrap">
    <div style="padding:12px 16px;border-bottom:1px solid var(--line)"><span class="eyebrow">LEAGUE CHAT</span><span class="sub" style="display:block">The Weekend League · 10 members</span></div>
    <div class="chat-log" id="chat-log">${renderChatMessages()}</div>
    <form class="chat-input-row" id="chat-form"><input id="chat-input" placeholder="Message the league…" maxlength="240" aria-label="Message"><button class="btn btn-live" type="submit" aria-label="Send">${ICONS.send}</button></form>
  </div>`;
}

function renderStandings() {
  return `
  <div class="page">
    <h1 class="h1">STANDINGS</h1>
    <p class="sub">Week 7 · Regular season</p>
    <div class="block section" style="margin-top:16px">
      ${standings().map((t, i) => `<div class="stand-row ${t.me ? "stand-me" : ""}">
        <span class="stand-rank">${i + 1}</span>
        <span><span class="stand-name">${esc(t.name)}</span><span class="stand-owner" style="display:block">${esc(t.owner)}</span></span>
        <span class="stand-record tabular">${t.w}-${t.l}</span>
        <span class="stand-pf tabular">${t.pf.toFixed(1)}</span>
      </div>`).join("")}
      ${`<div style="padding:6px 14px;border-top:2px dashed var(--live)"><span class="eyebrow" style="font-size:10px">PLAYOFF LINE — TOP 6</span></div>`}
    </div>
  </div>`;
}

function renderActivity() {
  return `
  <div class="page">
    <h1 class="h1">LEAGUE ACTIVITY</h1>
    <div class="block section" style="margin-top:16px">${ACTIVITY.concat([{ t: "1d", text: "Kyler Murray added by Turf Kings (bench)" }, { t: "2d", text: "Priya renamed team to Air Yard Sale" }]).map((a) => `<div class="row"><span style="flex:1;font-size:13px">${esc(a.text)}</span><span class="player-meta">${a.t}</span></div>`).join("")}</div>
  </div>`;
}

function renderProfile() {
  return `
  <div class="page">
    <h1 class="h1">PROFILE</h1>
    <div class="section" style="margin-top:16px;display:flex;align-items:center;gap:12px">
      <span class="avatar" style="width:56px;height:56px;font-size:16px">TY</span>
      <div><div style="font-weight:800;font-size:16px">Tyler</div><div class="player-meta">Turf Kings · Owner</div></div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">NOTIFICATIONS</div>
      <div class="block">
        <div class="toggle-row"><span>Game alerts</span><button class="toggle on" data-toggle aria-label="Game alerts"><span class="knob"></span></button></div>
        <div class="toggle-row"><span>Chat messages</span><button class="toggle on" data-toggle aria-label="Chat messages"><span class="knob"></span></button></div>
        <div class="toggle-row"><span>Quiet hours</span><button class="toggle" data-toggle aria-label="Quiet hours"><span class="knob"></span></button></div>
      </div>
    </div>
    <div class="section">
      <div class="eyebrow" style="margin-bottom:8px">ACCOUNT</div>
      <div class="block"><div class="row">Discord connected</div><button class="row row-btn" data-nav="login" style="color:var(--live);font-weight:700">Sign out</button></div>
    </div>
  </div>`;
}

/* ---------------- NAV bar (bottom + desktop) ---------------- */
const NAV_ITEMS = [
  { key: "home", icon: "home", label: "Home" },
  { key: "league", icon: "league", label: "League" },
  { key: "matchup", icon: "matchup", label: "Matchup" },
  { key: "chat", icon: "chat", label: "Chat", badge: true },
  { key: "more", icon: "more", label: "More" },
];
function buildChrome() {
  el("#bottomnav").innerHTML = NAV_ITEMS.map((n) => `<button class="bn-item" data-nav="${n.key === "more" ? "profile" : n.key}" data-navkey="${n.key}">${ICONS[n.icon]}${n.badge ? '<span class="badge"></span>' : ""}<span>${n.label}</span></button>`).join("");
  el("#desktop-nav").innerHTML = NAV_ITEMS.map((n) => `<a href="#/${n.key === "more" ? "profile" : n.key}" data-navkey="${n.key}">${n.label}</a>`).join("")
    + `<a href="#/myteam" data-navkey="myteam">My Team</a><a href="#/draft" data-navkey="draft">Draft</a><a href="#/gamecast" data-navkey="gamecast">Gamecast</a><a href="#/standings" data-navkey="standings">Standings</a>`;
}
function buildTicker() {
  const items = [
    `<span class="ticker-item"><span class="t-live">LIVE</span> KC <b>17</b>–<b>24</b> BUF · Q3</span>`,
    `<span class="ticker-item">DAL <b>10</b>–<b>13</b> PHI · Q2</span>`,
    `<span class="ticker-item"><span class="t-live">LIVE</span> CIN <b>21</b>–<b>14</b> BAL · Q3</span>`,
    `<span class="ticker-item">ATL @ CAR · Q3</span>`,
    `<span class="ticker-item" style="color:var(--gold)">★ Blitzkrieg Bop leads the league, 5-1</span>`,
  ];
  const html = items.join("");
  el("#ticker-track").innerHTML = html + html;
}

/* ---------------- router ---------------- */
function setActiveNav(routeKey) {
  els("[data-navkey]").forEach((a) => a.classList.toggle("active", a.dataset.navkey === routeKey || (routeKey === "myteam" && a.dataset.navkey === "myteam")));
}
function navigate(hash, skipWipe) {
  const wipe = el("#wipe");
  if (!skipWipe && !reduceMotion()) {
    wipe.classList.remove("run"); void wipe.offsetWidth; wipe.classList.add("run");
  }
  location.hash = hash;
}
function render() {
  const raw = location.hash.replace(/^#\/?/, "") || "home";
  const [key, arg] = raw.split("/");
  const fn = routes[key] || renderHome;
  const showChrome = key !== "login";
  el("#ticker-wrap").style.display = showChrome ? "flex" : "none";
  el("#topnav").style.display = showChrome ? "flex" : "none";
  el("#bottomnav").style.display = showChrome ? "" : "none";
  document.body.style.setProperty("--nav-h-active", showChrome ? "" : "0px");
  el("#view").innerHTML = fn(arg);
  setActiveNav(key === "player" ? "myteam" : key);
  wireView(key);
  el("#view").scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}
function wireView(key) {
  if (key === "draft") {
    startDraftClock();
    els("[data-draft-pick]").forEach((b) => b.addEventListener("click", () => doDraftPick(b.dataset.draftPick)));
  }
  if (key === "chat") {
    const form = el("#chat-form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = el("#chat-input");
      const text = input.value.trim();
      if (!text) return;
      state.chat.push({ who: "ME", me: true, text });
      el("#chat-log").innerHTML = renderChatMessages();
      el("#chat-log").scrollTop = el("#chat-log").scrollHeight;
      input.value = "";
    });
    const log = el("#chat-log");
    if (log) log.scrollTop = log.scrollHeight;
  }
  if (key === "home") animateHeroScore();
}

let draftTimer = null;
function startDraftClock() {
  clearInterval(draftTimer);
  draftTimer = setInterval(() => {
    if (location.hash.replace(/^#\/?/, "") !== "draft") { clearInterval(draftTimer); return; }
    state.draftClock -= 1;
    const clockEl = el("#draft-clock");
    if (clockEl) clockEl.textContent = state.draftClock;
    if (state.draftClock <= 0) { doDraftPick(DRAFT_POOL[Math.floor(Math.random() * DRAFT_POOL.length)]); }
  }, 1000);
}
function doDraftPick(playerName) {
  const team = teamById(DRAFT_ORDER[state.draftPickIndex % DRAFT_ORDER.length]);
  draftLog.push({ num: state.draftPickIndex + 1, team: team.name, player: playerName });
  const idx = DRAFT_POOL.indexOf(playerName);
  if (idx > -1) DRAFT_POOL.splice(idx, 1);
  state.draftPickIndex += 1;
  state.draftClock = 90;
  const flash = el("#pick-flash");
  if (flash) {
    el("#pick-flash-name").textContent = playerName;
    el("#pick-flash-meta").textContent = team.name.toUpperCase() + " SELECTS";
    flash.classList.remove("show"); void flash.offsetWidth; flash.classList.add("show");
  }
  setTimeout(() => { if (location.hash.replace(/^#\/?/, "") === "draft") render(); }, reduceMotion() ? 50 : 550);
}

function animateHeroScore() {
  const scoreEl = el("#home-hero-score");
  if (!scoreEl) return;
  setTimeout(() => {
    const target = el("#home-hero-score");
    if (!target) return;
    state.homeScore += 3;
    target.innerHTML = wrapDigits((state.homeScore / 10).toFixed(1));
    if (!reduceMotion()) {
      target.querySelectorAll(".digit").forEach((d) => d.classList.add("flip"));
    }
  }, 2200);
}

/* ---------------- init ---------------- */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-nav]");
  if (!t) return;
  e.preventDefault();
  navigate("#/" + t.dataset.nav);
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-toggle]");
  if (!t) return;
  t.classList.toggle("on");
});
window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  buildChrome();
  buildTicker();
  if (!reduceMotion()) el("#ticker-track").classList.add("animate");
  if (!location.hash) location.hash = "#/login";
  render();
});
})();
