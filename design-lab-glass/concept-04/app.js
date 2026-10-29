/* ==========================================================================
   NEON ORBIT — app.js
   Vanilla JS hash router + view renderers + mock data. No framework, no build.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
     Mock data (anchored to design-lab/shared/mock-data.md)
     ------------------------------------------------------------------ */

  const TEAMS = [
    { id: "blitz", name: "Blitzkrieg Bop", owner: "Marcus", w: 5, l: 1, pf: 812.4, streak: "W4" },
    { id: "turf", name: "Turf Kings", owner: "Tyler", w: 4, l: 2, pf: 798.6, streak: "W2", isUser: true },
    { id: "airyard", name: "Air Yard Sale", owner: "Priya", w: 4, l: 2, pf: 790.4, streak: "W1" },
    { id: "bandits", name: "Gridiron Bandits", owner: "Sam", w: 4, l: 2, pf: 781.2, streak: "L1" },
    { id: "zoom", name: "Legion of Zoom", owner: "Devon", w: 3, l: 3, pf: 774.0, streak: "W1" },
    { id: "poppins", name: "Hail Mary Poppins", owner: "Ava", w: 3, l: 3, pf: 766.9, streak: "L2" },
    { id: "rejects", name: "Red Zone Rejects", owner: "Liam", w: 3, l: 3, pf: 758.0, streak: "W1" },
    { id: "scaries", name: "Sunday Scaries", owner: "Jordan", w: 2, l: 4, pf: 744.7, streak: "L1" },
    { id: "rooski", name: "Fumble Rooski", owner: "Ben", w: 2, l: 4, pf: 730.5, streak: "L3" },
    { id: "potatoes", name: "Couch Potatoes", owner: "Nora", w: 1, l: 5, pf: 702.1, streak: "L4" },
  ];

  const PLAYERS = {
    herbert: { name: "Justin Herbert", team: "LAC", pos: "QB", proj: 21.4, actual: 18.2, status: "live",
      trend: [24.1, 19.8, 26.4, 15.2, 22.0, 18.2], matchup: "vs. DEN · DEN allows 3rd-most QB fantasy pts",
      note: "12/17, 168 yds, 1 TD through three quarters. On pace to clear projection late." },
    bijan: { name: "Bijan Robinson", team: "ATL", pos: "RB", proj: 17.8, actual: 14.6, status: "live",
      trend: [19.2, 22.4, 11.0, 16.8, 20.1, 14.6], matchup: "@ CAR · CAR allows 4.9 YPC to RBs, 2nd-worst",
      note: "14 car, 71 yds through Q3. Coming off a season-best 22.4 last week." },
    henry: { name: "Derrick Henry", team: "BAL", pos: "RB", proj: 0, actual: 0, status: "bye",
      trend: [18.4, 24.2, 12.6, 20.0, 16.4, 0], matchup: "BYE — back Week 8 vs. MIA",
      note: "On bye. Ravens' backfield workload has been all Henry through Week 6." },
    chase: { name: "Ja'Marr Chase", team: "CIN", pos: "WR", proj: 19.2, actual: 27.8, status: "live",
      trend: [16.4, 21.0, 18.8, 30.2, 14.0, 27.8], matchup: "vs. BAL · leading CIN's air raid in a shootout",
      note: "6 rec, 88 yds, 1 TD and still going in a back-and-forth with Baltimore." },
    wilson: { name: "Garrett Wilson", team: "NYJ", pos: "WR", proj: 14.6, actual: 9.4, status: "final",
      trend: [12.8, 17.2, 9.6, 20.4, 11.0, 9.4], matchup: "vs. NE · held to 4 catches on 9 targets",
      note: "Quiet afternoon — Jets trailed most of the game and leaned run-heavy late." },
    kelce: { name: "Travis Kelce", team: "KC", pos: "TE", proj: 13.8, actual: 11.2, status: "live",
      trend: [15.0, 9.4, 18.2, 10.6, 14.8, 11.2], matchup: "vs. BUF · KC trails 17-24 midway through Q3",
      note: "5 rec, 52 yds. Chiefs need to lean on him more to close the gap." },
    odunze: { name: "Rome Odunze", team: "CHI", pos: "WR", proj: 11.4, actual: 13.0, status: "final",
      trend: [8.2, 14.6, 10.0, 9.4, 16.8, 13.0], matchup: "vs. MIN · 2nd-year breakout continuing",
      note: "5 rec, 80 yds. Third straight week over projection out of the FLEX slot." },
    broncosdst: { name: "Broncos", team: "DEN", pos: "DST", proj: 8.0, actual: 6.0, status: "final",
      trend: [12.0, 4.0, 9.0, 14.0, 6.0, 6.0], matchup: "vs. LAC · 2 sacks, 1 INT, 0 TD allowed",
      note: "Solid floor game — pressure on Herbert most of the afternoon." },
    butker: { name: "Harrison Butker", team: "KC", pos: "K", proj: 8.2, actual: 7.0, status: "live",
      trend: [9.0, 6.0, 11.0, 7.0, 8.0, 7.0], matchup: "vs. BUF · 2/2 FG, 1/1 XP so far",
      note: "Chiefs' offense stalling in the red zone — points via field goal today." },
    charbonnet: { name: "Zach Charbonnet", team: "SEA", pos: "RB", proj: 10.2, actual: 6.4, status: "final",
      trend: [8.0, 12.4, 6.0, 9.8, 11.2, 6.4], matchup: "vs. ARI · early-down work behind the starter",
      note: "Bench stash with standalone value if the Seattle backfield shifts." },
    waddle: { name: "Jaylen Waddle", team: "MIA", pos: "WR", proj: 12.8, actual: 15.4, status: "final",
      trend: [9.0, 13.2, 18.0, 10.4, 14.6, 15.4], matchup: "vs. NYJ (last wk) · trending up two straight",
      note: "Bench flex who's outscoring a starter — a decision looming for Tyler." },
    murray: { name: "Kyler Murray", team: "ARI", pos: "QB", proj: 18.0, actual: 20.2, status: "final",
      trend: [14.2, 22.0, 16.8, 19.4, 21.0, 20.2], matchup: "vs. SEA (last wk) · 2 pass TD, 1 rush TD",
      note: "Streaming candidate on Tyler's bench with a juicy Week 8 matchup ahead." },
  };

  const TURF_STARTERS = [
    { id: "herbert", slot: "QB" },
    { id: "bijan", slot: "RB" },
    { id: "henry", slot: "RB" },
    { id: "chase", slot: "WR" },
    { id: "wilson", slot: "WR" },
    { id: "kelce", slot: "TE" },
    { id: "odunze", slot: "FLEX" },
    { id: "broncosdst", slot: "DST" },
    { id: "butker", slot: "K" },
  ];
  const TURF_BENCH = [
    { id: "charbonnet", slot: "BN" },
    { id: "waddle", slot: "BN" },
    { id: "murray", slot: "BN" },
  ];

  const LIVE_GAMES = [
    { away: "BUF", ascore: 24, home: "KC", hscore: 17, q: "Q3", clock: "8:42", note: "BUF ball, 2nd & 6 at KC 34" },
    { away: "DAL", ascore: 10, home: "PHI", hscore: 13, q: "Q2", clock: "3:10", note: "PHI driving" },
    { away: "CIN", ascore: 21, home: "BAL", hscore: 14, q: "Q3", clock: "11:05", note: "Chase 6 rec, 88 yds, 1 TD" },
    { away: "ATL", ascore: 17, home: "CAR", hscore: 13, q: "Q3", clock: "6:22", note: "Bijan 14 car, 71 yds" },
  ];

  const GAMECAST_PLAYS = [
    { t: "Q3 11:05", text: "Ja'Marr Chase 24-yd TD catch from Burrow", sub: "Turf Kings +9.6 pts" },
    { t: "Q3 8:42", text: "Bijan Robinson 11-yd run, 1st down", sub: "Turf Kings +1.1 pts" },
    { t: "Q3 6:10", text: "Garrett Wilson 4-yd catch (final stat line)", sub: "Air Yard Sale +0.4 pts" },
    { t: "Q2 14:20", text: "Travis Kelce 9-yd catch, 3rd down conversion", sub: "Turf Kings +0.9 pts" },
    { t: "Q2 2:05", text: "Harrison Butker 41-yd field goal", sub: "Turf Kings +3.0 pts" },
  ];

  const WAIVERS = [
    { id: "w1", name: "Tank Bigsby", team: "JAX", pos: "RB", pct: "62%", note: "Lead back after starter's ankle scare", claimed: false, faab: 18 },
    { id: "w2", name: "Xavier Legette", team: "CAR", pos: "WR", pct: "41%", note: "Target share climbing 3 weeks straight", claimed: false, faab: 9 },
    { id: "w3", name: "Tyler Allgeier", team: "ATL", pos: "RB", pct: "38%", note: "Handcuff value behind Bijan", claimed: true, faab: 4 },
    { id: "w4", name: "Jaylen Wright", team: "MIA", pos: "RB", pct: "29%", note: "Change-of-pace back trending up", claimed: false, faab: 6 },
    { id: "w5", name: "Cedric Tillman", team: "CLE", pos: "WR", pct: "24%", note: "New WR1 with starter on IR", claimed: false, faab: 7 },
  ];

  const CHAT_LEAGUE = [
    { who: "Marcus", mine: false, text: "Commish's Corner 📌 — waiver processing moved to Wednesday 8pm this week." },
    { who: "Priya", mine: false, text: "anyone else's Bijan not showing live? app says 14 car but no points ticking" },
    { who: "Sam", mine: false, text: "it's updating for me, try refresh" },
    { who: "Tyler", mine: true, text: "Chase just went off, 21 and counting 🔥" },
    { who: "Marcus", mine: false, text: "not surprised, Bengals are airing it out on Baltimore rn" },
    { who: "Priya", mine: false, text: "yeah okay fixed itself, Bijan's showing now. 71 yards on 14 carries not bad" },
    { who: "Jordan", mine: false, text: "meanwhile my Couch Potatoes matchup is already over lol" },
  ];

  const CHAT_DM = [
    { who: "Priya", mine: false, text: "The Sunday Massacre is not looking good for me right now 😬" },
    { who: "Tyler", mine: true, text: "4-2 on the all-time series, sorry not sorry" },
    { who: "Priya", mine: false, text: "it's only Q3, Wilson's about to go off just watch" },
  ];

  const ICONS = {
    home: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 4l8 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    matchup: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 12h4l2-5 4 10 2-5h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    team: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="2"/><path d="M5 20c1-3.8 4-6 7-6s6 2.2 7 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    league: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M9 10v10" stroke="currentColor" stroke-width="2"/></svg>`,
    chat: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H9l-4 4V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    back: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 5 8 12l7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    bolt: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M13 3 5 14h5l-1 7 8-11h-5l1-7Z" fill="currentColor"/></svg>`,
    bell: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 10a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    people: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="10" r="2.4" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c.8-3.2 3-5 6-5s5.2 1.8 6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    trophy: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" stroke="currentColor" stroke-width="1.8"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" stroke="currentColor" stroke-width="1.8"/><path d="M12 13v4M9 20h6M10 17h4v3h-4z" stroke="currentColor" stroke-width="1.8"/></svg>`,
    send: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 12 20 4l-6 16-3-7-7-1Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  };

  /* ------------------------------------------------------------------
     Router
     ------------------------------------------------------------------ */

  const state = { benchOpen: false, chatTab: "league", chatMsgs: { league: CHAT_LEAGUE.slice(), dm: CHAT_DM.slice() }, waivers: WAIVERS.map(w => ({ ...w })), sortKey: "pf" };

  function currentRoute() {
    const hash = location.hash.replace(/^#\//, "");
    return hash || "splash";
  }

  function navigate(route) {
    location.hash = "#/" + route;
  }

  function render() {
    const route = currentRoute();
    const [base, arg] = route.split("/");
    const view = document.getElementById("view");
    const tabbar = document.getElementById("tabbar");
    const cosmic = document.getElementById("cosmic-layer");

    let html = "";
    let showTabs = true;
    let cosmicOn = false;

    switch (base) {
      case "splash":
        html = renderSplash();
        showTabs = false;
        cosmicOn = true;
        break;
      case "home":
        html = renderHome();
        cosmicOn = true;
        break;
      case "matchup":
        html = renderMatchup();
        break;
      case "roster":
        html = renderRoster();
        break;
      case "standings":
        html = renderStandings();
        break;
      case "player":
        html = renderPlayer(arg);
        break;
      case "waivers":
        html = renderWaivers();
        break;
      case "chat":
        html = renderChat();
        break;
      default:
        html = renderSplash();
        showTabs = false;
        cosmicOn = true;
    }

    view.innerHTML = html;
    tabbar.style.display = showTabs ? "flex" : "none";
    cosmic.classList.toggle("is-active", cosmicOn);

    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.route === base);
    });

    window.scrollTo(0, 0);
    wireView(base);
  }

  /* ------------------------------------------------------------------
     Shared fragments
     ------------------------------------------------------------------ */

  function initials(name) {
    return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  }

  function statusChip(status) {
    if (status === "live") return `<span class="chip chip-live"><span class="dot-live"></span>LIVE</span>`;
    if (status === "bye") return `<span class="chip">BYE</span>`;
    return `<span class="chip">FINAL</span>`;
  }

  /* ------------------------------------------------------------------
     Splash
     ------------------------------------------------------------------ */

  function renderSplash() {
    return `
      <div class="splash-screen">
        <div class="splash-top">
          <div class="splash-badge ring-badge">
            <div class="splash-badge-inner">${ICONS.bolt.replace('width="18" height="18"', 'width="30" height="30"')}</div>
          </div>
          <div class="wordmark">THE <span class="accent">WEEKEND</span></div>
          <div class="splash-tag">Every Sunday. Every snap. Every point that matters.</div>
        </div>
        <div class="splash-bottom">
          <div class="league-badge-row"><span class="chip"><span class="dot-live" style="background:var(--neon);box-shadow:0 0 8px rgba(57,255,20,.8)"></span>The Weekend League &middot; Week 7</span></div>
          <button class="btn btn-primary btn-block specular" data-nav="home">Continue as Tyler</button>
          <button class="btn btn-ghost btn-block" data-nav="home">Explore as guest</button>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------
     Home
     ------------------------------------------------------------------ */

  function renderHome() {
    const top3 = TEAMS.slice(0, 3);
    return `
      <div class="screen">
        <div class="topbar glass">
          <div>
            <div class="eyebrow">Week 7 &middot; Sunday</div>
            <div class="h-1">Good afternoon, Tyler</div>
          </div>
          <div class="avatar">TK</div>
        </div>

        <div class="section">
          <div class="section-head">
            <div class="h-2">Your matchup</div>
            <span class="chip chip-live"><span class="dot-live"></span>LIVE &middot; Q3</span>
          </div>
          <div class="card hero-matchup glass tap" data-nav="matchup">
            <div class="hero-teams-row">
              <div class="hero-team is-user">
                <div class="team-mark">TK</div>
                <div class="team-name">Turf Kings</div>
                <div class="hero-score text-neon mono-num">108.4</div>
              </div>
              <div class="hero-vs">
                <div class="eyebrow">Q3 &middot; 11:05</div>
                <div class="body-sm">at Air Yard Sale</div>
              </div>
              <div class="hero-team">
                <div class="team-mark">AY</div>
                <div class="team-name">Air Yard Sale</div>
                <div class="hero-score mono-num">96.1</div>
              </div>
            </div>
            <div class="winprob-track"><div class="winprob-fill" style="width:73%"></div></div>
            <div class="probbar-row"><span>Turf Kings 73%</span><span>Air Yard Sale 27%</span></div>
          </div>
        </div>

        <div class="section">
          <div class="section-head">
            <div class="h-2">League pulse</div>
            <span class="link-more tap" data-nav="standings">Full standings</span>
          </div>
          <div class="card glass">
            <ul>
              ${top3.map((t, i) => standingRowHTML(t, i + 1)).join("")}
            </ul>
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:12px">Quick actions</div>
          <div class="quick-grid">
            <button class="quick-item tap" data-nav="roster">
              <span class="quick-icon">${ICONS.team}</span>
              <span class="quick-label">My Team</span>
            </button>
            <button class="quick-item tap" data-nav="waivers">
              <span class="quick-icon">${ICONS.bolt}</span>
              <span class="quick-label">Waivers</span>
            </button>
            <button class="quick-item tap" data-nav="standings">
              <span class="quick-icon">${ICONS.trophy}</span>
              <span class="quick-label">Standings</span>
            </button>
            <button class="quick-item tap" data-nav="chat">
              <span class="quick-icon">${ICONS.chat}</span>
              <span class="quick-label">Chat</span>
            </button>
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:12px">Around the league</div>
          <div class="card glass" style="display:flex;flex-direction:column;gap:10px">
            ${LIVE_GAMES.map((g) => `
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
                <span class="text-2">${g.away} <b class="text-1" style="color:var(--text-1)">${g.ascore}</b> &ndash; <b style="color:var(--text-1)">${g.hscore}</b> ${g.home}</span>
                <span class="chip" style="font-size:10.5px">${g.q}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function standingRowHTML(t, rank) {
    const streakClass = t.streak.startsWith("W") ? "streak-w" : "streak-l";
    return `
      <li class="standing-row ${t.isUser ? "is-user" : ""} tap" data-nav="standings">
        <span class="rank-num">${rank}</span>
        <span class="team-block">
          <span class="t-name">${t.name}</span>
          <span class="t-owner">${t.owner}</span>
        </span>
        <span class="rec-block">${t.w}-${t.l} <span class="${streakClass}">${t.streak}</span></span>
        <span class="pf-block">${t.pf.toFixed(1)}</span>
      </li>
    `;
  }

  /* ------------------------------------------------------------------
     Matchup / gamecast
     ------------------------------------------------------------------ */

  function renderMatchup() {
    return `
      <div class="screen">
        <div class="topbar glass">
          <div>
            <div class="eyebrow">The Sunday Massacre</div>
            <div class="h-1">Gamecast</div>
          </div>
          <span class="chip chip-live"><span class="dot-live"></span>LIVE</span>
        </div>

        <div class="card glass ring-card gamecast-hero specular">
          <div class="gamecast-live-row">
            <span class="eyebrow">Q3 &middot; 11:05 remaining</span>
            <span class="body-sm">Turf Kings lead all-time 4-2</span>
          </div>
          <div class="hero-teams-row">
            <div class="hero-team is-user">
              <div class="team-mark">TK</div>
              <div class="team-name">Turf Kings</div>
              <div class="hero-score text-neon mono-num">108.4</div>
            </div>
            <div class="hero-vs">
              <div class="eyebrow text-3">VS</div>
            </div>
            <div class="hero-team">
              <div class="team-mark">AY</div>
              <div class="team-name">Air Yard Sale</div>
              <div class="hero-score mono-num">96.1</div>
            </div>
          </div>
          <div class="winprob-track"><div class="winprob-fill" style="width:73%"></div></div>
          <div class="probbar-row"><span>Win probability 73%</span><span>27%</span></div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:8px">Key plays</div>
          <div class="card glass">
            ${GAMECAST_PLAYS.map((p) => `
              <div class="play-item">
                <div class="play-time">${p.t}</div>
                <div class="play-dot"></div>
                <div style="flex:1">
                  <div class="play-text">${p.text}</div>
                  <div class="play-sub">${p.sub}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:8px">Starters, live</div>
          <div class="card glass">
            <div class="mini-compare-row" style="border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:2px">
              <span class="eyebrow" style="text-align:left">Turf Kings</span>
              <span></span>
              <span class="eyebrow" style="text-align:right">Air Yard Sale</span>
            </div>
            ${["herbert", "chase", "kelce"].map((id, i) => {
              const p = PLAYERS[id];
              return `
              <div class="mini-compare-row">
                <span class="mc-name tap" data-nav="player/${id}">${p.name} <span class="mc-pos">${p.pos}</span></span>
                <span class="text-neon mono-num" style="font-weight:700">${p.actual.toFixed(1)}</span>
                <span class="mc-name mono-num" style="text-align:right;color:var(--text-2)">${(p.actual * 0.86).toFixed(1)}</span>
              </div>`;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------
     Roster
     ------------------------------------------------------------------ */

  function playerRowHTML(entry) {
    const p = PLAYERS[entry.id];
    return `
      <li class="player-row tap" data-nav="player/${entry.id}">
        <span class="pos-badge">${entry.slot}</span>
        <span class="p-info">
          <div class="p-name">${p.name}${p.status === "live" ? ' <span class="dot-live" style="display:inline-block;vertical-align:middle;margin-left:4px"></span>' : ""}</div>
          <div class="p-meta">${p.team} &middot; ${p.pos}${p.status === "bye" ? " &middot; BYE" : ""}</div>
        </span>
        <span class="p-pts">
          <div class="actual mono-num">${p.status === "bye" ? "&mdash;" : p.actual.toFixed(1)}</div>
          <div class="proj mono-num">proj ${p.proj.toFixed(1)}</div>
        </span>
      </li>
    `;
  }

  function renderRoster() {
    const user = TEAMS.find((t) => t.isUser);
    return `
      <div class="screen">
        <div class="topbar glass">
          <div>
            <div class="eyebrow">${user.w}-${user.l} &middot; ${user.pf.toFixed(1)} PF</div>
            <div class="h-1">Turf Kings</div>
          </div>
          <div class="avatar">TK</div>
        </div>

        <div class="section">
          <div class="roster-group-label">
            <div class="h-2">Starters</div>
            <span class="body-sm">Week 7</span>
          </div>
          <ul class="card glass">
            ${TURF_STARTERS.map(playerRowHTML).join("")}
          </ul>
        </div>

        <div class="section">
          <div class="card glass" style="padding:6px 10px">
            <button class="bench-toggle" id="bench-toggle-btn">
              <span>Bench (${TURF_BENCH.length})</span>
              <span class="chevron" id="bench-chevron">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </button>
            <div class="bench-list" id="bench-list">
              <ul>
                ${TURF_BENCH.map(playerRowHTML).join("")}
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------
     Standings
     ------------------------------------------------------------------ */

  function renderStandings() {
    const sorted = TEAMS.slice().sort((a, b) => {
      if (state.sortKey === "pf") return b.pf - a.pf;
      return (b.w - b.l) - (a.w - a.l) || b.w - a.w;
    });
    return `
      <div class="screen">
        <div class="topbar glass">
          <div>
            <div class="eyebrow">2026 Season &middot; Week 7</div>
            <div class="h-1">The Weekend League</div>
          </div>
        </div>

        <div class="section">
          <div class="card glass">
            <div class="sortable-head">
              <span></span>
              <span></span>
              <button data-sort="record" class="${state.sortKey === "record" ? "active" : ""}">Record</button>
              <button data-sort="pf" class="${state.sortKey === "pf" ? "active" : ""}">PF</button>
            </div>
            <ul>
              ${sorted.map((t) => standingRowHTML(t, TEAMS.findIndex((x) => x.id === t.id) + 1)).join("")}
            </ul>
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:10px">League records</div>
          <div class="card glass" style="display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;justify-content:space-between">
              <span class="body-sm">Highest single week</span>
              <span style="font-weight:700">Blitzkrieg Bop &middot; 184.6</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span class="body-sm">2026 MVP pace</span>
              <span style="font-weight:700">Marcus (Blitzkrieg Bop)</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span class="body-sm">Biggest blowout ever</span>
              <span style="font-weight:700">187.2 &ndash; 61.4</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------
     Player detail
     ------------------------------------------------------------------ */

  function renderPlayer(id) {
    const p = PLAYERS[id] || PLAYERS.herbert;
    const max = Math.max(...p.trend, 1);
    return `
      <div class="screen">
        <div class="detail-topbar">
          <button class="icon-btn" id="back-btn">${ICONS.back}</button>
          <div class="h-2">Player</div>
        </div>

        <div class="card glass ring-card player-hero specular">
          <div class="player-photo">${initials(p.name)}</div>
          <div class="display-2">${p.name}</div>
          <div class="body-sm">${p.team} &middot; ${p.pos}</div>
          ${statusChip(p.status)}
        </div>

        <div class="section">
          <div class="stat-grid">
            <div class="stat-tile"><div class="val mono-num">${p.status === "bye" ? "&mdash;" : p.actual.toFixed(1)}</div><div class="lbl">Actual</div></div>
            <div class="stat-tile"><div class="val mono-num">${p.proj.toFixed(1)}</div><div class="lbl">Projected</div></div>
            <div class="stat-tile"><div class="val mono-num text-neon">${(p.trend.reduce((a, b) => a + b, 0) / p.trend.length).toFixed(1)}</div><div class="lbl">6-wk avg</div></div>
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:4px">Last 6 weeks</div>
          <div class="card glass">
            <div class="sparkline">
              ${p.trend.map((v, i) => `<div class="spark-bar ${i === p.trend.length - 1 ? "current" : ""}" style="height:${Math.max((v / max) * 100, 6)}%"></div>`).join("")}
            </div>
            <div class="spark-labels">${p.trend.map((_, i) => `<span>W${i + 2}</span>`).join("")}</div>
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:8px">Matchup context</div>
          <div class="card glass" style="display:flex;flex-direction:column;gap:8px">
            <div class="body-sm">${p.matchup}</div>
            <div style="height:1px;background:var(--border)"></div>
            <div style="font-size:13.5px">${p.note}</div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------
     Waivers
     ------------------------------------------------------------------ */

  function renderWaivers() {
    return `
      <div class="screen">
        <div class="detail-topbar">
          <button class="icon-btn" id="back-btn">${ICONS.back}</button>
          <div>
            <div class="eyebrow">FAAB budget: $62 remaining</div>
            <div class="h-1">Waiver Wire</div>
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:8px">Available now</div>
          <div class="card glass">
            ${state.waivers.map((w) => `
              <div class="waiver-row">
                <span class="pos-badge">${w.pos}</span>
                <span class="p-info" style="flex:1">
                  <div class="p-name">${w.name}</div>
                  <div class="p-meta">${w.team} &middot; roster ${w.pct} &middot; ${w.note}</div>
                </span>
                <button class="claim-btn ${w.claimed ? "claimed" : ""}" data-claim="${w.id}">${w.claimed ? "Claimed" : "Claim"}</button>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="section">
          <div class="h-2" style="margin-bottom:8px">This week's processing</div>
          <div class="card glass body-sm">
            Waiver claims process <b style="color:var(--text-1)">Wednesday at 8:00 PM</b>, in FAAB-bid priority order. Pinned by Marcus in league chat.
          </div>
        </div>
      </div>

      <div class="sheet-backdrop" id="claim-sheet-backdrop">
        <div class="sheet glass glass-strong" id="claim-sheet">
          <div class="sheet-handle"></div>
          <div class="h-2" id="claim-sheet-title">Place FAAB bid</div>
          <div class="body-sm" style="margin-top:4px" id="claim-sheet-sub">Tank Bigsby &middot; RB &middot; JAX</div>
          <div class="sheet-row">
            <span class="body-sm">Your bid</span>
            <div class="stepper">
              <button id="bid-minus">&minus;</button>
              <span class="amt mono-num" id="bid-amount">10</span>
              <button id="bid-plus">+</button>
            </div>
          </div>
          <button class="btn btn-primary btn-block" id="confirm-claim">Submit claim</button>
        </div>
      </div>

      <div class="toast glass" id="claim-toast">
        ${ICONS.bolt} <span id="claim-toast-text">Claim submitted</span>
      </div>
    `;
  }

  /* ------------------------------------------------------------------
     Chat
     ------------------------------------------------------------------ */

  function renderChat() {
    const msgs = state.chatMsgs[state.chatTab];
    return `
      <div class="screen" style="padding-bottom: 150px">
        <div class="topbar glass">
          <div>
            <div class="eyebrow">The Weekend League</div>
            <div class="h-1">Chat</div>
          </div>
          <div class="avatar">TK</div>
        </div>

        <div class="seg-toggle">
          <button class="seg-btn ${state.chatTab === "league" ? "active" : ""}" data-chat-tab="league">League</button>
          <button class="seg-btn ${state.chatTab === "dm" ? "active" : ""}" data-chat-tab="dm">Priya (DM)</button>
        </div>

        ${state.chatTab === "league" ? `
        <div class="pinned-note glass">
          ${ICONS.bell}
          <span><b style="color:var(--text-1)">Commish's Corner</b> &middot; Marcus: Waiver processing moved to Wednesday 8pm this week.</span>
        </div>` : ""}

        <div class="chat-scroll" id="chat-scroll">
          ${msgs.map((m) => `
            <div class="msg-row ${m.mine ? "mine" : ""}">
              ${!m.mine ? `<span class="who">${m.who}</span>` : ""}
              <div class="msg-bubble ${m.mine ? "mine" : "other"}">${m.text}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="chat-input-bar glass">
        <input type="text" id="chat-input" placeholder="Message the league..." />
        <button class="send-btn" id="chat-send">${ICONS.send}</button>
      </div>
    `;
  }

  /* ------------------------------------------------------------------
     Interaction wiring per view
     ------------------------------------------------------------------ */

  function wireView(base) {
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => navigate(el.dataset.nav));
    });

    const backBtn = document.getElementById("back-btn");
    if (backBtn) backBtn.addEventListener("click", () => history.back());

    if (base === "roster") {
      const toggle = document.getElementById("bench-toggle-btn");
      const list = document.getElementById("bench-list");
      const chevron = document.getElementById("bench-chevron");
      if (toggle) {
        list.classList.toggle("is-open", state.benchOpen);
        chevron.classList.toggle("is-open", state.benchOpen);
        toggle.addEventListener("click", () => {
          state.benchOpen = !state.benchOpen;
          list.classList.toggle("is-open", state.benchOpen);
          chevron.classList.toggle("is-open", state.benchOpen);
        });
      }
    }

    if (base === "standings") {
      document.querySelectorAll("[data-sort]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.sortKey = btn.dataset.sort;
          render();
        });
      });
    }

    if (base === "waivers") {
      let bidAmount = 10;
      let activeClaimId = null;
      const backdrop = document.getElementById("claim-sheet-backdrop");
      const amountEl = document.getElementById("bid-amount");
      const titleEl = document.getElementById("claim-sheet-title");
      const subEl = document.getElementById("claim-sheet-sub");
      const toast = document.getElementById("claim-toast");
      const toastText = document.getElementById("claim-toast-text");

      document.querySelectorAll("[data-claim]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const w = state.waivers.find((x) => x.id === btn.dataset.claim);
          if (!w || w.claimed) return;
          activeClaimId = w.id;
          bidAmount = w.faab;
          amountEl.textContent = bidAmount;
          titleEl.textContent = "Place FAAB bid";
          subEl.textContent = `${w.name} · ${w.pos} · ${w.team}`;
          backdrop.classList.add("is-open");
        });
      });
      const closeSheet = () => backdrop.classList.remove("is-open");
      backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeSheet(); });
      document.getElementById("bid-minus").addEventListener("click", () => {
        bidAmount = Math.max(1, bidAmount - 1);
        amountEl.textContent = bidAmount;
      });
      document.getElementById("bid-plus").addEventListener("click", () => {
        bidAmount = Math.min(62, bidAmount + 1);
        amountEl.textContent = bidAmount;
      });
      document.getElementById("confirm-claim").addEventListener("click", () => {
        const w = state.waivers.find((x) => x.id === activeClaimId);
        if (w) {
          w.claimed = true;
          w.faab = bidAmount;
        }
        closeSheet();
        toastText.textContent = `Claim submitted — $${bidAmount} bid`;
        toast.classList.add("is-open");
        setTimeout(() => toast.classList.remove("is-open"), 2200);
        const btnEl = document.querySelector(`[data-claim="${activeClaimId}"]`);
        if (btnEl) { btnEl.textContent = "Claimed"; btnEl.classList.add("claimed"); }
      });
    }

    if (base === "chat") {
      document.querySelectorAll("[data-chat-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.chatTab = btn.dataset.chatTab;
          render();
        });
      });
      const input = document.getElementById("chat-input");
      const send = document.getElementById("chat-send");
      const scroll = document.getElementById("chat-scroll");
      const doSend = () => {
        const text = input.value.trim();
        if (!text) return;
        state.chatMsgs[state.chatTab].push({ who: "Tyler", mine: true, text });
        input.value = "";
        render();
        const el = document.getElementById("chat-scroll");
        if (el) el.scrollTop = el.scrollHeight;
      };
      send.addEventListener("click", doSend);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
  }

  /* ------------------------------------------------------------------
     Specular sweep — fine pointers only, respects reduced motion
     ------------------------------------------------------------------ */

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasFinePointer = window.matchMedia("(pointer: fine)").matches;

  if (!prefersReducedMotion && hasFinePointer) {
    document.addEventListener("pointermove", (e) => {
      document.querySelectorAll(".specular").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (e.clientX < rect.left - 40 || e.clientX > rect.right + 40) return;
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        el.style.setProperty("--sweep-x", `${Math.max(-60, Math.min(140, pct))}%`);
      });
    });
  }

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */

  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", () => {
    if (!location.hash) location.hash = "#/splash";
    render();
  });
})();
