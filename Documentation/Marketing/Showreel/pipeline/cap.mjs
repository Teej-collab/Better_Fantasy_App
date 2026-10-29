import { chromium } from "playwright";
import fs from "node:fs";
export const NOW = Date.parse("2026-09-27T23:42:00Z");
export const MOCK = "http://127.0.0.1:8799";
export async function demo(path) { await fetch(MOCK + path); }
export async function open({ w = 1280, h = 720, dsf = 1.5, signed = true, introSeen = true, mobile = false } = {}) {
  const browser = await chromium.launch({ args: ["--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", `--force-device-scale-factor=${dsf}`] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, colorScheme: "dark", timezoneId: "America/Chicago", isMobile: mobile, hasTouch: mobile });
  if (signed) await ctx.addCookies([{ name: "session", value: "demo", domain: "127.0.0.1", path: "/" }]);
  if (introSeen) await ctx.addInitScript(() => { try { localStorage.setItem("wl_intro_seen", "1"); } catch {} });
  await ctx.clock.install({ time: NOW });
  // hide any scrollbars / carets for a clean frame
  await ctx.addInitScript(() => {
    const st = document.createElement("style");
    st.textContent = `::-webkit-scrollbar{display:none!important} *{scrollbar-width:none!important;caret-color:transparent!important} nextjs-portal{display:none!important}`;
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st));
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));
  return { browser, ctx, page };
}
// Real-time screencast -> dir/f_<ms>.jpg
export async function startCast(page, dir, { w = 1920, h = 1080 } = {}) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now(); let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const ms = Date.now() - t0;
    fs.writeFileSync(`${dir}/f_${String(ms).padStart(7, "0")}.jpg`, Buffer.from(f.data, "base64")); n++;
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
  return { t0, stop: async () => { await cdp.send("Page.stopScreencast"); return n; }, elapsed: () => Date.now() - t0 };
}
