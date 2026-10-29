// Shared data + "sweat index" engine for all 6 Watch Party mockups
// (3 directions x mobile/desktop). Same matchup set, same math
// (mirrors compute_sweat_index() in backend/app/domain/watch_party.py)
// everywhere, so switching between directions is a fair comparison of
// presentation only — not different numbers on different pages.

const WP_OWNERS = {
  "TJ": "tj", "Ryan H.": "ryan-horak", "Grant P.": "grant-pomerenk", "Bailey H.": "bailey-hawn",
  "Clay F.": "clay-felice", "Ian P.": "ian-parkinson", "Lorenzo C.": "lorenzo-cachia", "James H.": "james-hogan",
  "Aaron W.": "aaron-wylie", "Aaron R.": "aaron-roberts", "Tyler D.": "tyler-dailey", "Niko": "niko",
  "Bowmen S.": "bowmen-solari", "Brian T.": "brian-thomas", "Jeffrey H.": "jeffrey-horak",
};

const WP_MATCHUPS = [
  { id: 1, home: "TJ", homeTeam: "Gridiron Mafia", away: "Ryan H.", awayTeam: "Horak's Hogs", hs: 118.4, as: 116.9 },
  { id: 2, home: "Grant P.", homeTeam: "The Forge", away: "Bailey H.", awayTeam: "Bailey's Ballers", hs: 142.8, as: 131.2 },
  { id: 3, home: "Clay F.", homeTeam: "Felice Navidad", away: "Ian P.", awayTeam: "Parkinson's Law", hs: 104.2, as: 101.8 },
  { id: 4, home: "Lorenzo C.", homeTeam: "Cachia Chaos", away: "James H.", awayTeam: "Hogan's Heroes", hs: 135.7, as: 154.4 },
  { id: 5, home: "Aaron W.", homeTeam: "Wylie Coyotes", away: "Aaron R.", awayTeam: "Roberts Rules", hs: 96.3, as: 94.1 },
  { id: 6, home: "Tyler D.", homeTeam: "Dailey Grind", away: "Niko", awayTeam: "Niko's Nightmares", hs: 110.5, as: 88.2 },
];

function wpOwnerImg(name) {
  return `../assets/owners/${WP_OWNERS[name] || "tj"}.jpg`;
}

// Same math as compute_sweat_index(): distance of win probability from
// a coin flip, 0-100, same label tiers.
function wpSweat(hs, as) {
  const diff = hs - as;
  const wp = Math.max(1, Math.min(99, 50 + diff * 2.2));
  const score = Math.round(100 - Math.abs(wp - 50) * 2);
  let label = null;
  if (score >= 85) label = "Down to the wire!";
  else if (score >= 65) label = "Sweating this one";
  else if (score >= 40) label = "Getting interesting";
  return { score, label };
}

function wpCloseMatchups(threshold = 65, limit = 3) {
  return WP_MATCHUPS.map((m) => ({ ...m, sweat: wpSweat(m.hs, m.as) }))
    .filter((m) => m.sweat.score >= threshold)
    .sort((a, b) => b.sweat.score - a.sweat.score)
    .slice(0, limit);
}

function wpAllMatchups() {
  return WP_MATCHUPS.map((m) => ({ ...m, sweat: wpSweat(m.hs, m.as) }));
}

// Simple render-callback registry so each page's own render() runs on
// every tick without this file knowing anything about any page's DOM.
const wpRenderers = [];
function wpOnRender(fn) {
  wpRenderers.push(fn);
}
function wpRenderAll() {
  wpRenderers.forEach((fn) => fn());
}

let wpTimer = null;
function wpTick() {
  const m = WP_MATCHUPS[Math.floor(Math.random() * WP_MATCHUPS.length)];
  const pts = [0.4, 0.8, 1.2, 2.4, 6.0][Math.floor(Math.random() * 5)];
  if (Math.random() > 0.5) m.hs = +(m.hs + pts).toFixed(2);
  else m.as = +(m.as + pts).toFixed(2);
  wpRenderAll();
}
function wpSetLive(on, buttonEl) {
  if (wpTimer) {
    clearInterval(wpTimer);
    wpTimer = null;
  }
  if (on) wpTimer = setInterval(wpTick, 1800);
  if (buttonEl) {
    buttonEl.classList.toggle("on", on);
    buttonEl.textContent = on ? "⏸ Pause the slate" : "▶ Simulate a live slate";
  }
}
function wpForceBlowout() {
  wpSetLive(false, document.querySelector("[data-wp-live-btn]"));
  WP_MATCHUPS[0].hs = 168.2; WP_MATCHUPS[0].as = 92.4;
  WP_MATCHUPS[1].hs = 155.0; WP_MATCHUPS[1].as = 98.1;
  WP_MATCHUPS[2].hs = 141.6; WP_MATCHUPS[2].as = 88.9;
  WP_MATCHUPS[3].hs = 160.4; WP_MATCHUPS[3].as = 99.2;
  WP_MATCHUPS[4].hs = 130.1; WP_MATCHUPS[4].as = 70.3;
  WP_MATCHUPS[5].hs = 145.6; WP_MATCHUPS[5].as = 80.2;
  wpRenderAll();
}
function wpForceWire() {
  wpSetLive(false, document.querySelector("[data-wp-live-btn]"));
  WP_MATCHUPS[0].hs = 118.4; WP_MATCHUPS[0].as = 118.1;
  WP_MATCHUPS[1].hs = 142.8; WP_MATCHUPS[1].as = 141.9;
  WP_MATCHUPS[2].hs = 104.2; WP_MATCHUPS[2].as = 103.8;
  WP_MATCHUPS[3].hs = 135.7; WP_MATCHUPS[3].as = 135.4;
  WP_MATCHUPS[4].hs = 96.3; WP_MATCHUPS[4].as = 96.0;
  WP_MATCHUPS[5].hs = 110.5; WP_MATCHUPS[5].as = 110.9;
  wpRenderAll();
}

// Screen share — one shared on/off state (always "TJ", the mockup's
// own "you") driven from EITHER the top demo control or the in-call
// share button each page's own control bar has, so both ways of
// triggering it in a real app are represented. null = nobody sharing.
let wpShareOwner = null;
function wpSetShare(owner) {
  wpShareOwner = owner;
  document.querySelectorAll("[data-wp-share-btn]").forEach((b) => b.classList.toggle("on", !!owner));
  wpRenderAll();
}
function wpToggleShare() {
  wpSetShare(wpShareOwner ? null : "TJ");
}
function wpShareLabel() {
  return wpShareOwner ? `${wpShareOwner} is sharing their screen` : null;
}

// Reused markup for "someone's screen is up" / "nobody's sharing yet"
// so every page draws the exact same thing rather than 6 near-copies.
// The empty state's own data-wp-share-btn makes tapping it double as
// the "start sharing" call to action, same as most real apps' empty
// states do — handled via delegation below since this HTML is
// injected after DOMContentLoaded (on every render, not just once).
function wpShareCanvasHTML() {
  return `
    <div class="wp-share-canvas">
      <div class="wp-share-tag"><span class="dot"></span>${wpShareLabel()}</div>
      <div class="wp-share-score">BUF 21 · KC 17 · Q3 8:41</div>
      <div class="wp-share-down">3RD &amp; 6 · BAL 42</div>
    </div>`;
}
function wpShareEmptyHTML(hint) {
  return `
    <div class="wp-share-empty" data-wp-share-btn>
      <span class="ic">🖥️</span>
      <span class="t">No one's sharing yet</span>
      <span class="s">${hint || "Tap to share your screen"}</span>
    </div>`;
}

function wpInitControls() {
  const liveBtn = document.querySelector("[data-wp-live-btn]");
  const blowoutBtn = document.querySelector("[data-wp-blowout-btn]");
  const wireBtn = document.querySelector("[data-wp-wire-btn]");
  if (liveBtn) liveBtn.addEventListener("click", () => wpSetLive(!wpTimer, liveBtn));
  if (blowoutBtn) blowoutBtn.addEventListener("click", wpForceBlowout);
  if (wireBtn) wireBtn.addEventListener("click", wpForceWire);
  // Delegated (not bound per-element): the empty-state's own share
  // button is injected fresh on every render(), so a direct listener
  // attached once at init would go stale the first time share toggles.
  document.body.addEventListener("click", (e) => {
    if (e.target.closest("[data-wp-share-btn]")) wpToggleShare();
  });
  wpRenderAll();
  wpSetLive(true, liveBtn);
}

document.addEventListener("DOMContentLoaded", wpInitControls);
