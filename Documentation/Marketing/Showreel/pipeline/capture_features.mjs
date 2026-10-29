// Feature captures for the v2 reel: chug analyzer + commissioner rule customization.
// node capture_features.mjs <h|v> [chug,commish]
import { open, startCast, demo } from "./cap.mjs";
const fmt = process.argv[2] ?? "h";
const only = process.argv[3]?.split(",");
const H = fmt === "h";
const VP = H ? { w: 1280, h: 720, dsf: 1.5 } : { w: 432, h: 768, dsf: 2.5, mobile: true };
const OUT = H ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
const BASE = "http://127.0.0.1:3100";
const dir = (n) => `clips/${fmt}_${n}`;
const want = (n) => !only || only.includes(n);
const wait = (page, ms) => page.waitForTimeout(ms);
async function smoothScroll(page, to, ms) {
  await page.evaluate(([to, ms]) => new Promise((res) => {
    const from = window.scrollY, t0 = performance.now();
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const tick = () => { const p = Math.min(1, (performance.now() - t0) / ms); window.scrollTo(0, from + (to - from) * ease(p)); p < 1 ? requestAnimationFrame(tick) : res(); };
    requestAnimationFrame(tick);
  }), [to, ms]);
}
// y (document px) of the element whose text starts with `text`, minus an offset
const yOf = (page, text, offset = 80) => page.evaluate(([text, offset]) => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) if (n.textContent.trim().startsWith(text)) break;
  return n ? Math.max(0, n.parentElement.getBoundingClientRect().top + scrollY - offset) : 0;
}, [text, offset]);

if (want("chug")) {
  await demo("/__demo/step/0");
  const { browser, page } = await open(VP);
  await page.goto(BASE + "/chug"); await wait(page, 6000);
  const cast = await startCast(page, dir("chug"), OUT);
  await wait(page, 1200);
  const t_upload = cast.elapsed();
  await page.setInputFiles('input[type="file"]', "marcus-week4-chug.mov");
  await wait(page, 2600 + 2400); // "Analyzing your chug…" -> graded result
  const t_scroll = cast.elapsed();
  await smoothScroll(page, await yOf(page, "Recent Chugs", H ? 60 : 40), 2600);
  await wait(page, 2000);
  await smoothScroll(page, await yOf(page, "Leaderboard", H ? 60 : 40), 2400);
  await wait(page, 1800);
  console.log("chug", await cast.stop(), JSON.stringify({ t_upload, t_scroll }));
  await browser.close();
}
if (want("commish")) {
  const { browser, page } = await open(VP);
  await page.goto(BASE + "/commissioner"); await wait(page, 5000);
  const cast = await startCast(page, dir("commish"), OUT);
  await wait(page, 2600);
  const t_nav = cast.elapsed();
  await page.getByText("Scoring Rules", { exact: true }).first().click();
  await page.waitForSelector("text=Points per stat category");
  await wait(page, 1400);
  // Passing group: QB Tackle 5 -> 15 (this league's real house rule)
  const qb = page.locator("label", { hasText: "QB Tackle" }).locator("input");
  await smoothScroll(page, await yOf(page, "Passing", H ? 120 : 60), 900);
  await wait(page, 500);
  const t_type = cast.elapsed();
  await qb.click({ clickCount: 3 });
  await page.keyboard.type("15", { delay: 220 });
  await wait(page, 1000);
  // Kicking: FG 0.1 per yard + missed-FG penalties by distance
  await smoothScroll(page, await yOf(page, "Kicking", H ? 120 : 60), 1800);
  await wait(page, 1600);
  await smoothScroll(page, await page.evaluate(() => document.documentElement.scrollHeight), 1800);
  await wait(page, 500);
  const t_save = cast.elapsed();
  await page.getByRole("button", { name: /Save scoring rules/ }).click();
  await wait(page, 2200);
  console.log("commish", await cast.stop(), JSON.stringify({ t_nav, t_type, t_save }));
  await browser.close();
}
