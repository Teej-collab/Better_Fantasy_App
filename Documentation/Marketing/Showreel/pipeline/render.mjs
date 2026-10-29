// node render.mjs <h|v> <fps> <outdir> [times=comma list for preview]
import { chromium } from "playwright";
import fs from "node:fs";
const [fmt = "h", fps = "60", out = "frames_h", times] = process.argv.slice(2);
const [W, H] = fmt === "h" ? [1920, 1080] : [1080, 1920];
const b = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
const page = await b.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
await page.goto(`http://127.0.0.1:8811/comp.html?fmt=${fmt}`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 120000 });
fs.mkdirSync(out, { recursive: true });
const dur = await page.evaluate(() => 0) || 0;
const list = times ? times.split(",").map(Number) : null;
const DUR = await page.evaluate(() => window.EDL.duration);
const total = list ? list.length : Math.round(DUR * +fps);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const g = list ? list[i] : i / +fps;
  await page.evaluate((g) => window.render(g), g);
  await page.screenshot({ path: list ? `${out}/p_${String(g).replace(".", "_")}.jpg` : `${out}/f_${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 94 });
  if (i % 300 === 0) console.log(i, "/", total, ((Date.now() - t0) / 1000).toFixed(0) + "s");
}
await b.close();
