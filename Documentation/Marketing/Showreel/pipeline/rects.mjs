import { open, demo } from "./cap.mjs";
import fs from "node:fs";
const fmt = process.argv[2] ?? "h";
const VP = fmt === "h" ? { w: 1280, h: 720, dsf: 1 } : { w: 432, h: 768, dsf: 1, mobile: true };
const { browser, page } = await open(VP);
const out = {};
async function card(name, text, up = 0) {
  const r = await page.evaluate(([text, up]) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (n.textContent.trim().startsWith(text)) break;
    if (!n) return null;
    let el = n.parentElement; for (let i = 0; i < up; i++) el = el.parentElement;
    const b = el.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, w: b.width, h: b.height };
  }, [text, up]);
  out[name] = r;
}
await demo("/__demo/step/0");
await page.goto("http://127.0.0.1:3100/"); await page.waitForTimeout(5000);
await card("home_chug", "Jeffrey", 3); await card("home_ticker", "THE WEEKEND LIVE", 2); await card("home_yourweek", "View full matchup", 1);
await card("home_awards", "Week 3 Awards", 1); await card("home_recap", "Week 3 Recap", 2); await card("home_standings", "League Standings", 1); await card("home_power", "Power Rankings", 1); await card("home_activity", "League Activity", 1);
out.home_page = await page.evaluate(() => document.documentElement.scrollHeight);
await page.goto("http://127.0.0.1:3100/matchups/4000"); await page.waitForTimeout(5000);
await card("mu_header", "Win Probability", 2); await card("mu_h2h", "All-time head-to-head", 1); await card("mu_lineups", "Starting Lineups", 1); await card("mu_grudge", "The Grudge", 0);
await card("mu_winprob", "Win Probability", 1);
out.mu_page = await page.evaluate(() => document.documentElement.scrollHeight);
fs.writeFileSync(`rects_${fmt}.json`, JSON.stringify(out, null, 1));
console.log(out);
await browser.close();
