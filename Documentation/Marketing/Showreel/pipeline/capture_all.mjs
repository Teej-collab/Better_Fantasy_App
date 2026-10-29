// node capture_all.mjs <h|v> [only=a,b,...]
import { open, startCast, demo } from "./cap.mjs";
const fmt = process.argv[2] ?? "h";
const only = process.argv[3]?.split(",");
const H = fmt === "h";
const VP = H ? { w: 1280, h: 720, dsf: 1.5 } : { w: 432, h: 768, dsf: 2.5, mobile: true };
const OUT = H ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
const BASE = "http://127.0.0.1:3100";
const dir = (n) => `clips/${fmt}_${n}`;
const want = (n) => !only || only.includes(n);
const hideChrome = `.wl-skip-intro, .safe-pt.safe-px.absolute.top-0.left-0 { opacity: 0 !important; }`;
async function smoothScroll(page, to, ms) {
  await page.evaluate(([to, ms]) => new Promise((res) => {
    const from = window.scrollY, t0 = performance.now();
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const tick = () => { const p = Math.min(1, (performance.now() - t0) / ms); window.scrollTo(0, from + (to - from) * ease(p)); p < 1 ? requestAnimationFrame(tick) : res(); };
    requestAnimationFrame(tick);
  }), [to, ms]);
}
const wait = (page, ms) => page.waitForTimeout(ms);
// Full-page stills bake a fixed bottom nav into the middle of the page — hide it for stills only.
const hideFixedBottom = (page) => page.evaluate(() => { for (const el of document.querySelectorAll("body *")) { const cs = getComputedStyle(el); if (cs.position === "fixed" && parseFloat(cs.bottom) <= 1 && el.getBoundingClientRect().top > innerHeight / 2) el.style.display = "none"; } });

if (want("intro")) {
  const { browser, page } = await open({ ...VP, signed: false, introSeen: false });
  await page.addInitScript((css) => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }), hideChrome);
  const castP = page.goto(BASE + "/", { waitUntil: "commit" });
  const cast = await startCast(page, dir("intro"), OUT);
  await castP; await wait(page, 9000); console.log("intro", await cast.stop());
  await browser.close();
}
if (want("room")) {
  const { browser, page } = await open(VP);
  await page.goto(BASE + "/weekend"); await wait(page, 4000);
  await page.screenshot({ path: `${dir("room")}_still.png` }).catch(() => {});
  const cast = await startCast(page, dir("room"), OUT); await wait(page, 7000); console.log("room", await cast.stop());
  await browser.close();
}
if (want("home")) {
  await demo("/__demo/step/0");
  const { browser, page } = await open(VP);
  await page.goto(BASE + "/"); await wait(page, 6000);
  const cast = await startCast(page, dir("home"), OUT);
  await wait(page, 1500);
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await smoothScroll(page, Math.min(total, H ? 2600 : 5200), 14000);
  await wait(page, 800); console.log("home", await cast.stop(), total);
  await browser.close();
}
if (want("stills")) {
  await demo("/__demo/step/0");
  const { browser, page } = await open({ ...VP, dsf: H ? 3 : 3 });
  for (const [u, n] of [["/", "home"], ["/matchups/4000", "matchup"], ["/power-rankings", "power"]]) {
    await page.goto(BASE + u); await wait(page, 6000);
    await hideFixedBottom(page);
    await page.screenshot({ path: `stills/${fmt}_${n}.png`, fullPage: true });
  }
  await demo("/__demo/step/2");
  await page.goto(BASE + "/matchups/4000"); await wait(page, 6000);
  await hideFixedBottom(page);
  await page.screenshot({ path: `stills/${fmt}_matchup2.png`, fullPage: true });
  await demo("/__demo/step/0");
  await browser.close();
}
if (want("matchup")) {
  await demo("/__demo/step/1");
  const { browser, page } = await open(VP);
  await page.goto(BASE + "/matchups/4000"); await wait(page, 6000);
  const cast = await startCast(page, dir("matchup"), OUT);
  await wait(page, 1500);
  await demo("/__demo/step/2");
  await page.clock.runFor(46000);
  await wait(page, 5000); console.log("matchup", await cast.stop());
  await browser.close(); await demo("/__demo/step/0");
}
if (want("gamecast")) {
  await demo("/__demo/step/0");
  const tall = H ? { ...VP, h: 1300 } : VP;
  const { browser, page } = await open(tall);
  await page.goto(BASE + "/gamecast/401800401"); await wait(page, 6000);
  if (!H) await page.evaluate(() => window.scrollTo(0, 330));
  const cast = await startCast(page, dir("gamecast"), H ? { w: 1920, h: 1950 } : OUT);
  await wait(page, 1500); await demo("/__demo/step/1");
  await wait(page, 3000); await demo("/__demo/step/2");
  await wait(page, 2500); await page.clock.runFor(15500);
  if (!H) { await wait(page, 1200); await smoothScroll(page, 1500, 2500); }
  await wait(page, 3500); console.log("gamecast", await cast.stop());
  await browser.close(); await demo("/__demo/step/0");
}
if (want("chat")) {
  await demo("/__demo/step/2");
  const { browser, page } = await open(VP);
  await page.goto(BASE + "/chat?conversation=1"); await wait(page, 6000);
  const cast = await startCast(page, dir("chat"), OUT);
  await wait(page, 1200); await demo("/__demo/chat/msg/0");
  await wait(page, 1300); await demo("/__demo/chat/typing/2");
  await wait(page, 1600); await demo("/__demo/chat/msg/1");
  await wait(page, 2500); console.log("chat", await cast.stop());
  await browser.close(); await demo("/__demo/step/0");
}
