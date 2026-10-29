import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
const PORT = 8799;
const log = fs.createWriteStream("mock-requests.log", { flags: "a" });
let mod = null, lastM = 0;
async function maybeReload() {
  const m = fs.statSync("data.mjs").mtimeMs + fs.statSync("demo-state.json").mtimeMs;
  if (m !== lastM) { lastM = m; try { mod = await import(`./data.mjs?t=${Date.now()}`); } catch (e) { console.error("reload failed", e.message); } }
}
await maybeReload();
const sockets = new Set(); // {sock, kind}
function frame(str) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}
function broadcast(kind, obj) { for (const s of sockets) if (s.kind === kind) s.sock.write(frame(JSON.stringify(obj))); }
function setStep(step) { fs.writeFileSync("demo-state.json", JSON.stringify({ step })); }
const server = http.createServer(async (req, res) => {
  await maybeReload();
  // The chug upload posts straight from the browser to this origin (like the real backend) — allow it.
  res.setHeader("access-control-allow-origin", req.headers.origin || "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  // ---- demo controls
  let dm;
  if ((dm = url.pathname.match(/^\/__demo\/step\/(\d+)$/))) {
    setStep(+dm[1]); await maybeReload();
    broadcast("gamecast", { type: "game_state", game: mod.gamecastState() });
    res.end("ok"); return;
  }
  if ((dm = url.pathname.match(/^\/__demo\/chat\/typing\/(\d+)$/))) {
    const t = mod.TEAMS.find((x) => x.id === +dm[1]);
    broadcast("chat", { type: "typing", conversation_id: 1, owner_id: t.id, owner_name: t.owner }); res.end("ok"); return;
  }
  if ((dm = url.pathname.match(/^\/__demo\/chat\/msg\/(\d+)$/))) {
    const m = mod.CHAT_LIVE[+dm[1]]; broadcast("chat", { type: "message", message: { ...m, created_at: new Date(mod.NOW).toISOString() } }); res.end("ok"); return;
  }
  const signedIn = /session=/.test(req.headers.cookie || "");
  for (const [method, re, handler] of mod.routes) {
    if (method !== req.method && method !== "*") continue;
    const m = url.pathname.match(re);
    if (!m) continue;
    const out = await handler({ m, url, body, signedIn, req });
    const status = out?.__status ?? 200;
    log.write(`${status} ${req.method} ${url.pathname}${url.search}\n`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(out?.__status ? out.body ?? {} : out));
    return;
  }
  log.write(`MISS ${req.method} ${url.pathname}${url.search}\n`);
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ detail: "Not Found" }));
});
server.on("upgrade", async (req, sock) => {
  await maybeReload();
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const kind = req.url.includes("gamecast") ? "gamecast" : req.url.includes("chat") ? "chat" : "other";
  const entry = { sock, kind };
  sockets.add(entry);
  log.write(`WS ${req.url}\n`);
  sock.on("data", () => {}); sock.on("error", () => {}); sock.on("close", () => sockets.delete(entry));
  if (kind === "gamecast") sock.write(frame(JSON.stringify({ type: "game_state", game: mod.gamecastState() })));
});
server.listen(PORT, () => console.log("mock on", PORT));
