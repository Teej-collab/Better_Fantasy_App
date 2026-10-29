// THE ORBIT — app.js
// Vanilla JS hash router + render functions. No build step, no deps.

/* ============================= DATA ============================= */
const ME = { id: 2, name: "Tyler", team: "Turf Kings" };

const TEAMS = [
  { id: 1, name: "Blitzkrieg Bop", owner: "Marcus", w: 5, l: 1, pf: 812.4, streak: "W3" },
  { id: 2, name: "Turf Kings", owner: "Tyler", w: 4, l: 2, pf: 798.6, streak: "W2" },
  { id: 3, name: "Air Yard Sale", owner: "Priya", w: 4, l: 2, pf: 790.4, streak: "L1" },
  { id: 4, name: "Gridiron Bandits", owner: "Sam", w: 4, l: 2, pf: 781.2, streak: "W1" },
  { id: 5, name: "Legion of Zoom", owner: "Devon", w: 3, l: 3, pf: 774.0, streak: "L1" },
  { id: 6, name: "Hail Mary Poppins", owner: "Ava", w: 3, l: 3, pf: 766.9, streak: "W1" },
  { id: 7, name: "Red Zone Rejects", owner: "Liam", w: 3, l: 3, pf: 758.0, streak: "L2" },
  { id: 8, name: "Sunday Scaries", owner: "Jordan", w: 2, l: 4, pf: 744.7, streak: "L1" },
  { id: 9, name: "Fumble Rooski", owner: "Ben", w: 2, l: 4, pf: 730.5, streak: "W1" },
  { id: 10, name: "Couch Potatoes", owner: "Nora", w: 1, l: 5, pf: 702.1, streak: "L3" },
];

const POS_COLOR = { QB: "#ff8a65", RB: "#6ff3e0", WR: "#9ad1ff", TE: "#d8c17a", DST: "#8b8d93", K: "#8b8d93" };

const ROSTER = [
  { slot: "QB", name: "Justin Herbert", team: "LAC", opp: "@DEN", pts: 24.2, proj: 21.1, live: true, id: "herbert" },
  { slot: "RB", name: "Bijan Robinson", team: "ATL", opp: "@CAR", pts: 18.6, proj: 16.4, live: true, id: "bijan" },
  { slot: "RB", name: "Derrick Henry", team: "BAL", opp: "BYE", pts: 0, proj: 0, live: false, id: "henry" },
  { slot: "WR", name: "Ja'Marr Chase", team: "CIN", opp: "vs BAL", pts: 21.1, proj: 17.8, live: true, id: "chase" },
  { slot: "WR", name: "Garrett Wilson", team: "NYJ", opp: "vs MIA", pts: 8.4, proj: 13.2, live: false, id: "wilson" },
  { slot: "TE", name: "Travis Kelce", team: "KC", opp: "@BUF", pts: 12.3, proj: 11.6, live: true, id: "kelce" },
  { slot: "FLEX", name: "Rome Odunze", team: "CHI", opp: "@MIN", pts: 9.9, proj: 10.4, live: false, id: "odunze" },
  { slot: "DST", name: "Broncos D/ST", team: "DEN", opp: "vs LAC", pts: 4.0, proj: 6.5, live: true, id: "broncosdst" },
  { slot: "K", name: "Harrison Butker", team: "KC", opp: "@BUF", pts: 6.0, proj: 8.1, live: true, id: "butker" },
];
const BENCH = [
  { slot: "BE", name: "Zach Charbonnet", team: "SEA", opp: "@LAR", pts: 6.1, proj: 9.8, live: false, id: "charbonnet" },
  { slot: "BE", name: "Jaylen Waddle", team: "MIA", opp: "@NYJ", pts: 11.3, proj: 12.0, live: false, id: "waddle" },
  { slot: "BE", name: "Kyler Murray", team: "ARI", opp: "vs SF", pts: 15.8, proj: 18.2, live: false, id: "murray" },
];
const ALL_PLAYERS = [...ROSTER, ...BENCH];

const OPP_ROSTER = [
  { slot: "QB", name: "Jared Goff", team: "DET", opp: "vs GB", pts: 19.4 },
  { slot: "RB", name: "Kenneth Walker III", team: "SEA", opp: "@LAR", pts: 14.2 },
  { slot: "RB", name: "James Cook", team: "BUF", opp: "vs KC", pts: 11.8 },
  { slot: "WR", name: "DeVonta Smith", team: "PHI", opp: "vs DAL", pts: 13.0 },
  { slot: "WR", name: "Tank Dell", team: "HOU", opp: "@TEN", pts: 7.6 },
  { slot: "TE", name: "Sam LaPorta", team: "DET", opp: "vs GB", pts: 9.1 },
  { slot: "FLEX", name: "Rachaad White", team: "TB", opp: "@ATL", pts: 8.7 },
  { slot: "DST", name: "Eagles D/ST", team: "PHI", opp: "vs DAL", pts: 5.0 },
  { slot: "K", name: "Jake Elliott", team: "PHI", opp: "vs DAL", pts: 7.0 },
];

const MATCHUP = { home: "Turf Kings", away: "Air Yard Sale", homeScore: 108.4, awayScore: 96.1, winProb: 73, quarter: "Q3", rivalry: "The Sunday Massacre", ledger: "4–2" };

const ACTIVITY = [
  { text: "Jordan dropped Zach Charbonnet", time: "4m" },
  { text: "Ava and Sam completed a trade", time: "22m" },
  { text: "Draft grades are live — see who won", time: "1h" },
  { text: "Priya claimed Rachaad White off waivers", time: "3h" },
];

const CHAT_LEAGUE = [
  { sender: "Priya", me: false, text: "anyone else's Bijan not showing live? refresh isn't fixing it" },
  { sender: "Sam", me: false, text: "yeah same, feed's lagging for everyone rn" },
  { sender: "Tyler", me: true, text: "should sort itself out by the next drive" },
  { sender: "Sam", me: false, text: "🔥 Chase just went off, 21 and counting" },
];
const CHAT_ANNOUNCE = [{ sender: "Marcus (Commish)", me: false, text: "Waiver processing moved to Wednesday 8pm this week — Thursday night game.", pinned: true }];

const DRAFT_POOL = [
  { name: "Rachaad White", pos: "RB", team: "TB", adp: 41 },
  { name: "Jordan Addison", pos: "WR", team: "MIN", adp: 44 },
  { name: "David Njoku", pos: "TE", team: "CLE", adp: 58 },
  { name: "Jayden Daniels", pos: "QB", team: "WAS", adp: 62 },
  { name: "Tank Bigsby", pos: "RB", team: "JAX", adp: 71 },
];
let draftPicks = [];
let draftRound = 4, draftPickNum = 4, draftTimer = 47, draftTimerHandle = null;

const GAME = { home: "BUF", away: "KC", homeScore: 24, awayScore: 17, quarter: "Q3", clock: "8:42", possession: "BUF", down: "2nd & 6", yardline: "KC 34", ballPct: 66 };
const PLAYS = [
  { text: "T. Kelce 6-yd reception, 3rd down conversion", fantasy: "+1.6 pts · T. Kelce" },
  { text: "H. Butker 42-yd field goal, GOOD", fantasy: "+3.0 pts · H. Butker" },
  { text: "J. Chase 18-yd catch and run", fantasy: "+2.8 pts · J. Chase" },
];

/* ============================= ICONS ============================= */
const ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
  matchup: '<circle cx="8" cy="8" r="3.4"/><circle cx="16" cy="16" r="3.4"/><path d="M10.4 10.4l3.2 3.2"/>',
  league: '<path d="M7 4h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4Z"/><path d="M12 13v3"/><path d="M9 20h6"/>',
  draft: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  chat: '<path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4v-10Z"/>',
};
function icon(name, cls) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${cls || ""}">${ICONS[name]}</svg>`;
}

/* ============================= ROUTER ============================= */
const routes = {
  "/login": renderLogin,
  "/home": renderHome,
  "/league": renderLeague,
  "/matchup": renderMatchup,
  "/myteam": renderMyTeam,
  "/draft": renderDraft,
  "/gamecast": renderGamecast,
  "/chat": renderChat,
  "/standings": renderStandings,
  "/activity": renderActivity,
  "/profile": renderProfile,
};
const NAV_ITEMS = [
  { key: "/home", label: "Home", icon: "home" },
  { key: "/league", label: "League", icon: "league" },
  { key: "/matchup", label: "Match", icon: "matchup" },
  { key: "/draft", label: "Draft", icon: "draft" },
  { key: "/chat", label: "Chat", icon: "chat" },
];

let entered = false;

function currentPath() {
  const h = location.hash.replace(/^#/, "") || "/login";
  return h.split("?")[0].replace(/\/player\/.*/, "/player");
}

function router() {
  const raw = location.hash.replace(/^#/, "") || "/login";
  const [path] = raw.split("?");
  document.getElementById("shell-nav").style.display = raw === "/login" ? "none" : "flex";
  document.getElementById("shell-header").style.display = raw === "/login" ? "none" : "flex";

  let html, mount;
  if (path.startsWith("/player/")) {
    const id = path.split("/")[2];
    ({ html, mount } = renderPlayer(id));
  } else if (routes[path]) {
    ({ html, mount } = routes[path]());
  } else {
    ({ html, mount } = renderHome());
  }
  const view = document.getElementById("view");
  view.innerHTML = `<div class="view-enter">${html}</div>`;
  if (mount) mount();
  renderDock(path);
  window.scrollTo({ top: 0 });
}

function renderDock(path) {
  const dock = document.getElementById("shell-nav");
  dock.innerHTML = NAV_ITEMS.map((n) => {
    const active = path === n.key;
    return `<a href="#${n.key}" class="${active ? "active" : ""}">${icon(n.icon)}<span class="tick"></span></a>`;
  }).join("");
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("app-shell").insertAdjacentHTML("afterbegin", "");
  router();
  setupTilt();
});

/* ============================= SCREENS ============================= */

function renderLogin() {
  const html = `
  <div class="login-screen">
    <div class="login-mark">THE WEEKEND</div>
    <div class="orbit-ring" aria-hidden="true">
      <div class="ring"></div><div class="ring"></div>
      <div class="core"></div>
      <div class="satellite"></div>
    </div>
    <div>
      <h1 class="login-title">Your league,<br/><span>in orbit.</span></h1>
      <p class="login-sub mt-8">Live scores, your matchup, and the draft room — one connected view of Sunday.</p>
    </div>
    <button class="btn btn-primary btn-block" id="enter-btn" style="max-width:280px">Enter The Weekend</button>
    <a href="#/home" style="font-size:12px;color:var(--text-faint)">Continue as guest</a>
  </div>`;
  return {
    html,
    mount() {
      document.getElementById("enter-btn").addEventListener("click", () => {
        entered = true;
        location.hash = "#/home";
      });
    },
  };
}

function heroMatchupCard() {
  const homeWidth = MATCHUP.winProb;
  return `
  <div class="panel-elevated hero-matchup tilt">
    <div class="hero-top">
      <span class="tag tag-live"><span class="pulse"></span>Live · ${MATCHUP.quarter}</span>
      <span class="tag tag-neutral">${MATCHUP.rivalry}</span>
    </div>
    <div class="hero-teams">
      <div class="hero-team">
        <div class="team-badge">TK</div>
        <div class="team-name">${MATCHUP.home} <span style="color:var(--text-faint)">(you)</span></div>
        <div class="team-score lead">${MATCHUP.homeScore}</div>
      </div>
      <div class="hero-vs">VS</div>
      <div class="hero-team right">
        <div class="team-badge">AY</div>
        <div class="team-name">${MATCHUP.away}</div>
        <div class="team-score">${MATCHUP.awayScore}</div>
      </div>
    </div>
    <div class="hero-meter">
      <div class="meter-track">
        <div class="meter-fill" style="width:${homeWidth}%"></div>
        <div class="meter-fill rest" style="width:${100 - homeWidth}%"></div>
      </div>
      <div class="meter-labels"><span>Win probability</span><span>${homeWidth}%</span></div>
    </div>
    <div class="hero-actions">
      <a href="#/matchup" class="btn btn-ion" style="flex:1">View matchup</a>
      <a href="#/myteam" class="btn" style="flex:1">My lineup</a>
    </div>
  </div>
  <a href="#/gamecast" class="panel" style="display:flex;align-items:center;gap:10px;padding:12px 16px;grid-column:1/-1">
    <span class="tag tag-live"><span class="pulse"></span>Live</span>
    <span style="flex:1;font-size:13px">${GAME.away} @ ${GAME.home} · ${GAME.awayScore}–${GAME.homeScore} · ${GAME.quarter}</span>
    <span style="font-size:12px;color:var(--text-dim)">Gamecast →</span>
  </a>`;
}

function renderHome() {
  const html = `
  <div class="screen-head">
    <div class="eyebrow">Week 7 · Sunday 1:00pm slate</div>
    <h1 class="screen-title">Good afternoon, ${ME.name}</h1>
  </div>
  <div class="home-grid">
    ${heroMatchupCard()}
    <div class="orbit-row">
      <div class="panel mini-panel tilt">
        <div class="label">League Rank</div>
        <div class="val">2 <span style="font-size:12px;color:var(--ion)">▲</span></div>
      </div>
      <div class="panel mini-panel tilt">
        <div class="label">Live Players</div>
        <div class="val">5</div>
      </div>
    </div>
    <div id="home-side-panels">
      <div class="panel" style="padding:16px">
        <div class="kicker-row"><span class="eyebrow">Standings</span><a href="#/standings" class="see-all">Full →</a></div>
        ${TEAMS.slice(0, 3).map((t, i) => standingMiniRow(t, i + 1)).join("")}
      </div>
      <div class="panel" style="padding:16px">
        <div class="kicker-row"><span class="eyebrow">League Activity</span><a href="#/activity" class="see-all">All →</a></div>
        ${ACTIVITY.slice(0, 3).map((a) => `<div class="activity-row"><div style="flex:1"><div style="font-size:12.5px">${a.text}</div></div><div style="font-size:11px;color:var(--text-faint)">${a.time}</div></div>`).join("")}
      </div>
    </div>
  </div>`;
  return { html, mount: () => setupTilt() };
}

function standingMiniRow(t, rank) {
  const me = t.id === ME.id;
  return `<div class="standing-row"><span class="rank-chip ${me ? "me" : ""}">${rank}</span><div style="flex:1;font-size:12.5px;font-weight:${me ? 700 : 500}">${t.name}${me ? " (you)" : ""}</div><div style="font-size:11.5px;color:var(--text-dim)">${t.w}-${t.l}</div></div>`;
}

function renderLeague() {
  const html = `
  <div class="screen-head">
    <div class="eyebrow">League</div>
    <h1 class="screen-title">The Weekend League</h1>
    <p class="screen-sub">10 teams · Est. 2019 · Commissioner: Marcus</p>
  </div>
  <div class="tabs">
    <button class="active">Overview</button>
    <button data-go="/standings">Standings</button>
    <button data-go="/activity">Activity</button>
    <button data-go="/draft">Draft</button>
  </div>
  <div class="panel" style="padding:16px">
    <div class="kicker-row"><span class="eyebrow">Top of the table</span></div>
    ${TEAMS.slice(0, 5).map((t, i) => standingMiniRow(t, i + 1)).join("")}
  </div>
  <div class="section-label">Rivalry spotlight</div>
  <div class="panel tilt" style="padding:16px">
    <div class="flex-between">
      <div><div style="font-weight:700">The Sunday Massacre</div><div style="font-size:12px;color:var(--text-dim)">Turf Kings vs. Air Yard Sale</div></div>
      <div style="font-family:'Space Grotesk';font-weight:700;font-size:20px;color:var(--ion)">4–2</div>
    </div>
  </div>`;
  return {
    html,
    mount() {
      setupTilt();
      document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => (location.hash = "#" + b.dataset.go)));
    },
  };
}

function renderMatchup() {
  const rows = ROSTER.map((h, i) => {
    const a = OPP_ROSTER[i];
    const c = POS_COLOR[h.slot] || POS_COLOR[a.slot] || "#8b8d93";
    return `<div class="lineup-row">
      <div class="lineup-player"><span class="lineup-dot" style="background:${c}"></span><div><div class="player-name-sm">${h.name}</div><div class="player-meta-sm">${h.team} · ${h.opp}</div></div></div>
      <div class="slot-tag">${h.slot}<div class="player-pts" style="margin-top:2px">${h.pts.toFixed(1)}</div></div>
      <div class="lineup-player right"><div style="text-align:right"><div class="player-name-sm">${a.name}</div><div class="player-meta-sm">${a.team} · ${a.opp}</div></div><span class="lineup-dot" style="background:${c}"></span></div>
    </div>`;
  }).join("");
  const html = `
  <div class="screen-head"><div class="eyebrow">Week 7 · Regular Season</div><h1 class="screen-title">Turf Kings vs. Air Yard Sale</h1></div>
  <div class="panel-elevated matchup-hero tilt">
    <span class="tag tag-live"><span class="pulse"></span>Live · ${MATCHUP.quarter}</span>
    <div class="matchup-score-big">
      <span class="num">${MATCHUP.homeScore}</span><span class="vs">VS</span><span class="num dim">${MATCHUP.awayScore}</span>
    </div>
    <div class="meter-track"><div class="meter-fill" style="width:${MATCHUP.winProb}%"></div><div class="meter-fill rest" style="width:${100 - MATCHUP.winProb}%"></div></div>
    <div class="meter-labels"><span>You're favored</span><span>${MATCHUP.winProb}%</span></div>
    <a href="#/gamecast" style="display:inline-block;margin-top:14px;font-size:12px;color:var(--ion)">Watch live Gamecast →</a>
  </div>
  <div class="section-label">Starting lineups — why you're ahead</div>
  <div class="panel" style="padding:0 16px">${rows}</div>
  <div class="section-label">All-time head-to-head</div>
  <div class="panel" style="padding:16px;text-align:center"><div style="font-family:'Space Grotesk';font-size:22px;font-weight:700">${MATCHUP.ledger}</div><div style="font-size:12px;color:var(--text-dim);margin-top:4px">"${MATCHUP.rivalry}"</div></div>`;
  return { html, mount: () => setupTilt() };
}

function rosterRowHtml(p) {
  const c = POS_COLOR[p.slot] || "#8b8d93";
  return `<div class="roster-row" data-player="${p.id}">
    <span class="lineup-dot" style="background:${c};align-self:stretch"></span>
    <div class="roster-headshot"></div>
    <div class="roster-info"><div class="roster-name">${p.name}</div><div class="roster-meta">${p.slot} · ${p.team} · ${p.opp}${p.live ? ' · <span style="color:var(--warm)">live</span>' : ""}</div></div>
    <div class="roster-points"><div class="p">${p.pts.toFixed(1)}</div><div class="proj">proj ${p.proj.toFixed(1)}</div></div>
  </div>`;
}

function renderMyTeam() {
  const html = `
  <div class="screen-head"><div class="eyebrow">My Team</div><h1 class="screen-title">Turf Kings</h1><p class="screen-sub">Week 7 · 98.2 pts so far</p></div>
  <div class="section-label">Starters</div>
  <div class="panel" style="padding:0 14px">${ROSTER.map(rosterRowHtml).join("")}</div>
  <div class="section-label">Bench</div>
  <div class="panel" style="padding:0 14px;opacity:0.9">${BENCH.map(rosterRowHtml).join("")}</div>`;
  return {
    html,
    mount() {
      document.querySelectorAll("[data-player]").forEach((el) => el.addEventListener("click", () => (location.hash = "#/player/" + el.dataset.player)));
    },
  };
}

function renderPlayer(id) {
  const p = ALL_PLAYERS.find((x) => x.id === id) || ROSTER[0];
  const c = POS_COLOR[p.slot] || "#8b8d93";
  const html = `
  <a href="#/myteam" style="font-size:12px;color:var(--text-dim)">&larr; Back to team</a>
  <div class="panel-elevated player-hero tilt" style="margin-top:14px">
    <div class="headshot-lg" style="border-color:${c}"></div>
    <div class="name">${p.name}</div>
    <div class="meta">${p.slot} · ${p.team} · ${p.opp}</div>
    ${p.live ? '<span class="tag tag-live" style="margin-top:10px"><span class="pulse"></span>Live now</span>' : ""}
    <div class="stat-grid">
      <div class="panel stat-cell"><div class="v">${p.pts.toFixed(1)}</div><div class="l">Points</div></div>
      <div class="panel stat-cell"><div class="v">${p.proj.toFixed(1)}</div><div class="l">Projected</div></div>
      <div class="panel stat-cell"><div class="v">62%</div><div class="l">Owned</div></div>
    </div>
  </div>
  <div class="section-label">Season log</div>
  <div class="panel" style="padding:0 16px">
    ${[6, 5, 4, 3].map((w) => `<div class="standing-row"><div style="flex:1;font-size:12.5px">Week ${w}</div><div style="font-size:12.5px;font-weight:600">${(p.proj + (w % 3) * 2.1).toFixed(1)} pts</div></div>`).join("")}
  </div>`;
  return { html, mount: () => setupTilt() };
}

function renderDraft() {
  clearInterval(draftTimerHandle);
  const teamAbbr = ["TK", "BB", "AY", "GB", "LZ"];
  const html = `
  <div class="screen-head"><div class="eyebrow">Draft Room</div><h1 class="screen-title">The Weekend League — 2027</h1></div>
  <div class="panel-elevated draft-clock-panel tilt">
    <div><div class="eyebrow">Round ${draftRound} · Pick ${draftPickNum}</div><div style="margin-top:4px;font-weight:600">Priya is on the clock</div></div>
    <div class="draft-clock-num" id="draft-clock">${draftTimer}s</div>
  </div>
  <div class="section-label">Your queue</div>
  <div class="panel" id="draft-pool" style="padding:0 12px">
    ${DRAFT_POOL.map((p, i) => `<div class="pool-row"><span class="pos-pill" style="background:${POS_COLOR[p.pos]}22;color:${POS_COLOR[p.pos]}">${p.pos}</span><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${p.name}</div><div style="font-size:11px;color:var(--text-dim)">${p.team} · ADP ${p.adp}</div></div><button class="btn btn-ion draft-pick-btn" data-idx="${i}" style="height:34px;padding:0 14px;font-size:12px">Draft</button></div>`).join("")}
  </div>
  <div class="section-label">Your picks so far</div>
  <div class="panel orbit-roster" id="orbit-roster">
    ${draftPicks.length ? draftPicks.map((p) => `<span class="orbit-chip">${p.name}</span>`).join("") : '<span class="empty-note">No picks yet this session.</span>'}
  </div>
  <div id="sting-mount"></div>`;
  return {
    html,
    mount() {
      setupTilt();
      startDraftTimer();
      document.querySelectorAll(".draft-pick-btn").forEach((b) =>
        b.addEventListener("click", () => draftPlayer(parseInt(b.dataset.idx, 10)))
      );
    },
  };
}

function startDraftTimer() {
  draftTimerHandle = setInterval(() => {
    draftTimer -= 1;
    const el = document.getElementById("draft-clock");
    if (el) el.textContent = draftTimer + "s";
    if (draftTimer <= 0) {
      clearInterval(draftTimerHandle);
      draftPlayer(0);
    }
  }, 1000);
}

function draftPlayer(idx) {
  clearInterval(draftTimerHandle);
  const picked = DRAFT_POOL.splice(idx, 1)[0];
  if (!picked) return;
  draftPicks.push(picked);
  draftPickNum += 1;
  if (draftPickNum > 10) { draftPickNum = 1; draftRound += 1; }
  draftTimer = 90;
  showPickSting(picked);
  if (currentPath() === "/draft") setTimeout(() => { if (currentPath() === "/draft") router(); }, 1250);
}

function showPickSting(p) {
  const mount = document.getElementById("sting-mount");
  if (!mount) return;
  mount.innerHTML = `<div class="pick-sting show"><div class="pick-sting-card"><div class="eyebrow" style="color:var(--ion)">You drafted</div><h2 style="font-size:26px;margin-top:6px">${p.name}</h2><div style="color:var(--text-dim);font-size:13px;margin-top:4px">${p.pos} · ${p.team}</div></div></div>`;
}

function renderGamecast() {
  const html = `
  <div class="screen-head"><div class="eyebrow">Gamecast</div><h1 class="screen-title">${GAME.away} @ ${GAME.home}</h1></div>
  <div class="panel-elevated field-wrap tilt">
    <div class="game-scoreline">
      <div><div style="font-size:12px;color:var(--text-dim)">${GAME.away}</div><div class="score">${GAME.awayScore}</div></div>
      <span class="tag tag-live"><span class="pulse"></span>${GAME.quarter} · ${GAME.clock}</span>
      <div style="text-align:right"><div style="font-size:12px;color:var(--text-dim)">${GAME.home}</div><div class="score">${GAME.homeScore}</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-dim);text-align:center;margin-top:4px">${GAME.possession} ball · ${GAME.down} at ${GAME.yardline}</div>
    <div class="field-plane-outer"><div class="field-plane">
      ${Array.from({ length: 9 }).map((_, i) => `<div class="yardline" style="left:${(i + 1) * 10}%"></div>`).join("")}
      <div class="firstdown" style="left:74%"></div>
      <div class="ball" id="ball-marker" style="left:${GAME.ballPct}%"></div>
    </div></div>
    <div class="chip-stream" id="chip-stream"></div>
  </div>
  <div class="section-label">Fantasy impact — your players</div>
  <div class="panel" style="padding:0 16px">
    <div class="standing-row"><div style="flex:1;font-size:12.5px">Travis Kelce · 3rd down conversion</div><div style="font-size:12.5px;font-weight:700;color:var(--ion)">+1.6</div></div>
    <div class="standing-row"><div style="flex:1;font-size:12.5px">Harrison Butker · 42-yd FG, good</div><div style="font-size:12.5px;font-weight:700;color:var(--ion)">+3.0</div></div>
  </div>`;
  return {
    html,
    mount() {
      setupTilt();
      let i = 0;
      const stream = document.getElementById("chip-stream");
      const ball = document.getElementById("ball-marker");
      function pushChip() {
        if (!stream || !document.body.contains(stream)) return;
        const play = PLAYS[i % PLAYS.length];
        const chip = document.createElement("div");
        chip.className = "data-chip";
        chip.innerHTML = `<b>${play.fantasy.split(" · ")[1]}</b> ${play.text}`;
        stream.appendChild(chip);
        setTimeout(() => chip.remove(), 3600);
        if (ball) ball.style.left = Math.min(92, GAME.ballPct + i * 6) + "%";
        i += 1;
      }
      pushChip();
      const iv = setInterval(() => {
        if (!document.body.contains(stream)) return clearInterval(iv);
        pushChip();
      }, 4200);
    },
  };
}

function chatBubbles(list) {
  return list
    .map(
      (m) => `<div class="bubble-row ${m.me ? "me" : ""}"><div class="bubble-av"></div><div><div class="bubble">${!m.me ? `<div class="bubble-sender">${m.sender}</div>` : ""}${m.text}</div></div></div>`
    )
    .join("");
}

function renderChat() {
  const html = `
  <div class="screen-head"><div class="eyebrow">Chat</div><h1 class="screen-title">The Weekend League</h1></div>
  <div class="chat-thread-tabs">
    <button class="btn" data-thread="league" style="height:36px;padding:0 14px;font-size:12px;background:var(--text);color:var(--bg)">League</button>
    <button class="btn" data-thread="commish" style="height:36px;padding:0 14px;font-size:12px">Commish's Corner</button>
  </div>
  <div class="chat-shell panel-elevated" style="padding:14px">
    <div class="pinned-card"><div class="eyebrow">Pinned · Commish's Corner</div><div style="font-size:13px;margin-top:4px">${CHAT_ANNOUNCE[0].text}</div></div>
    <div class="chat-log" id="chat-log">${chatBubbles(CHAT_LEAGUE)}</div>
    <div class="chat-input-row">
      <input id="chat-input" type="text" placeholder="Message the league…" maxlength="240" />
      <button class="send-btn" id="chat-send" aria-label="Send"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 12l18-8-6 8 6 8-18-8Z"/></svg></button>
    </div>
  </div>`;
  return {
    html,
    mount() {
      const log = document.getElementById("chat-log");
      const input = document.getElementById("chat-input");
      function send() {
        const val = input.value.trim();
        if (!val) return;
        CHAT_LEAGUE.push({ sender: ME.name, me: true, text: val });
        log.insertAdjacentHTML("beforeend", chatBubbles([{ sender: ME.name, me: true, text: val }]));
        input.value = "";
        log.scrollTop = log.scrollHeight;
      }
      document.getElementById("chat-send").addEventListener("click", send);
      input.addEventListener("keydown", (e) => e.key === "Enter" && send());
      log.scrollTop = log.scrollHeight;
    },
  };
}

function renderStandings() {
  const rows = [...TEAMS]
    .sort((a, b) => b.w - a.w || b.pf - a.pf)
    .map((t, i) => {
      const me = t.id === ME.id;
      const up = t.streak.startsWith("W");
      return `<div class="standing-row">
        <span class="rank-chip ${me ? "me" : ""}">${i + 1}</span>
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:${me ? 700 : 500}">${t.name}${me ? " (you)" : ""}</div><div style="font-size:11px;color:var(--text-dim)">${t.owner}</div></div>
        <span class="tag ${up ? "tag-ion" : "tag-neutral"}" style="width:34px;justify-content:center">${t.streak}</span>
        <div style="width:56px;text-align:right;font-size:12.5px;font-weight:600">${t.w}-${t.l}</div>
        <div style="width:58px;text-align:right;font-size:12px;color:var(--text-dim)">${t.pf.toFixed(1)}</div>
      </div>`;
    })
    .join("");
  const html = `
  <div class="screen-head"><div class="eyebrow">League</div><h1 class="screen-title">Standings</h1></div>
  <div class="panel standings-panel">${rows}</div>`;
  return { html };
}

function renderActivity() {
  const html = `
  <div class="screen-head"><div class="eyebrow">League</div><h1 class="screen-title">Activity</h1></div>
  <div class="panel" style="padding:0 16px">${ACTIVITY.map((a) => `<div class="activity-row"><div class="lineup-dot" style="background:var(--ion);width:6px;height:6px;border-radius:50%;align-self:center"></div><div style="flex:1;font-size:13px">${a.text}</div><div style="font-size:11px;color:var(--text-faint)">${a.time}</div></div>`).join("")}</div>`;
  return { html };
}

function renderProfile() {
  const html = `
  <div class="screen-head"><div class="eyebrow">Profile</div><h1 class="screen-title">Settings</h1></div>
  <div class="panel profile-hero tilt"><div class="headshot-lg"></div><div><div style="font-weight:700;font-size:16px">${ME.name}</div><div style="font-size:12.5px;color:var(--text-dim)">Turf Kings</div></div></div>
  <div class="section-label">Notifications</div>
  <div class="panel" style="padding:0 16px">
    <div class="toggle-row"><div><div class="l">Game alerts</div><div class="d">Your player scores, red zone</div></div><div class="switch on"><div class="knob"></div></div></div>
    <div class="toggle-row"><div><div class="l">Chat messages</div><div class="d">League chat &amp; DMs</div></div><div class="switch on"><div class="knob"></div></div></div>
    <div class="toggle-row"><div><div class="l">Quiet hours</div><div class="d">10pm–8am</div></div><div class="switch"><div class="knob"></div></div></div>
  </div>
  <div class="section-label">Account</div>
  <div class="panel" style="padding:0 16px">
    <div class="toggle-row"><div class="l">Reduce motion</div><div class="switch" id="motion-switch"><div class="knob"></div></div></div>
  </div>`;
  return {
    html,
    mount() {
      setupTilt();
      document.querySelectorAll(".toggle-row .switch").forEach((s) => s.addEventListener("click", () => s.classList.toggle("on")));
    },
  };
}

/* ============================= TILT INTERACTION ============================= */
function setupTilt() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(hover: none)").matches;
  if (reduceMotion || isTouch) return;
  document.querySelectorAll(".tilt").forEach((el) => {
    if (el.dataset.tiltBound) return;
    el.dataset.tiltBound = "1";
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${px * 6}deg) rotateX(${-py * 6}deg) translateZ(0)`;
    });
    el.addEventListener("pointerleave", () => (el.style.transform = ""));
  });
}
