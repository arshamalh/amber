#!/usr/bin/env node
// Plays the demo in Amber's real UI (headless Chrome, demo/backend.ts) and
// captures it with Chrome's screencast: no screen recording.
//
//   npx vite --config demo/vite.config.ts      (in another terminal)
//   node demo/record.mjs                        → demo/video/public/app.mp4 + scenes.json
//
// Needs Google Chrome and ffmpeg.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = join(here, "video/public");
const frames = join(here, ".frames");
const W = 1280, H = 780, SCALE = 1.5;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
mkdirSync(out, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${join(frames, "profile")}`, "--remote-debugging-port=9339", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tab;
for (let i = 0; i < 40 && !tab; i++) {
  await sleep(250);
  tab = await fetch("http://127.0.0.1:9339/json/new?about:blank", { method: "PUT" }).then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const shots = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) return pending.get(d.id)(d), pending.delete(d.id);
  if (d.method === "Page.screencastFrame") {
    const file = `f${String(shots.length).padStart(5, "0")}.jpg`;
    writeFileSync(join(frames, file), Buffer.from(d.params.data, "base64"));
    shots.push({ file, t: d.params.metadata.timestamp });
    send("Page.screencastFrameAck", { sessionId: d.params.sessionId });
  }
  if (d.method === "Runtime.exceptionThrown") console.error("page error:", d.params.exceptionDetails.exception?.description);
};
await new Promise((r) => (ws.onopen = r));
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

// ---- input, like a person ----------------------------------------------------

let mouse = { x: W * 0.6, y: H * 0.55 };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
async function moveTo(x, y, ms = 650) {
  const from = { ...mouse };
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    mouse = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k };
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouse.x, y: mouse.y });
    await sleep(16);
  }
}
async function click(x, y, ms) {
  await js("document.scrollingElement.scrollTop = 0"); // the app never scrolls as a whole
  await moveTo(x, y, ms);
  await sleep(120);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(70);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
/** Centre (or right end with `end`) of the element a JS expression finds. */
async function at(expr, { end = false, dx = 0, dy = 0 } = {}) {
  const r = await js(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView?.({ block: "nearest" }); document.scrollingElement.scrollTop = 0; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  if (!r) throw new Error(`not found: ${expr}`);
  return { x: (end ? r.x + r.w - 2 : r.x + r.w / 2) + dx, y: r.y + r.h / 2 + dy };
}
const line = (text) => `[...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(${JSON.stringify(text)}))`;
/** The blank line after the line containing `text` (clicking there reveals no markup). */
const blankAfter = (text) => `${line(text)}?.nextElementSibling`;
const button = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
const KEYS = { Enter: [13, "\r"], Escape: [27], End: [35], ArrowDown: [40] };
async function key(name, modifiers = 0) {
  const [code, text] = KEYS[name];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, modifiers, text });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
}
async function type(text, cps = 22) {
  for (const ch of text) {
    if (ch === "\n") await key("Enter");
    else await send("Input.insertText", { text: ch });
    await sleep(1000 / cps + Math.random() * 25);
  }
}

// ---- scenes ------------------------------------------------------------------

const scenes = [];
let t0 = 0;
const scene = async (name) => {
  const now = Date.now() / 1000;
  scenes.push({ name, t: +(now - t0).toFixed(2) });
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await send("Page.navigate", { url: "http://localhost:1488/demo/app.html" });
await sleep(6000); // boot, engine, first render

await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * SCALE, maxHeight: H * SCALE });
t0 = Date.now() / 1000;
await scene("open");
await moveTo(760, 420, 900);
await sleep(1500);

// 1. Write: markup hides itself, maths renders when you leave it.
await scene("write");
await click(...Object.values(await at(line("only approximate it?"), { end: true })));
await key("End");
await sleep(300);
await key("Enter");
await key("Enter");
await type("The catch: n quantum spins need $2^n$ numbers, so the cost explodes.");
await sleep(500);
await click(...Object.values(await at(blankAfter("The catch"), { dx: -200 })), 500);
await sleep(1600);

// 2. Blocks from the / menu.
await scene("slash");
await key("End", 4); // ⌘↓: end of the note
await sleep(400);
await key("Enter");
await key("Enter");
await type("/call", 8);
await sleep(900);
await key("Enter");
await sleep(300);
await type("Classical bits can be copied. Qubits cannot.");
await sleep(400);
await click(...Object.values(await at(blankAfter("only when both controls are set"), { dx: -200 })), 500);
await sleep(1800);

// 3. Link to a page of a PDF.
await scene("pdf");
await moveTo(...Object.values(await at(`document.querySelector('[data-lp-wiki*="Primer"]')`)), 700);
await sleep(400);
await click(mouse.x, mouse.y, 100);
await sleep(3200);
await moveTo(W * 0.78, H * 0.6, 700);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: mouse.x, y: mouse.y, deltaX: 0, deltaY: 260 });
await sleep(1600);

// 4. Writing · Source · Rendered.
await scene("views");
await click(...Object.values(await at(`document.querySelector('.right-pane button[title="Close PDF"]')`)), 600);
await click(...Object.values(await at(button("×"))), 400).catch(() => {});
await sleep(500);
await click(...Object.values(await at(button("Source"))), 700);
await sleep(1800);
await click(...Object.values(await at(button("Rendered"))), 500);
await sleep(3800);
await click(...Object.values(await at(button("Writing"))), 500);
await sleep(900);

// 5. Plain files in your folders.
await scene("files");
await click(...Object.values(await at(`[...document.querySelectorAll('.tree .row')].find((r) => r.textContent.includes('Computation'))`)), 700);
await sleep(500);
await click(...Object.values(await at(`[...document.querySelectorAll('.tree .row')].find((r) => r.textContent.includes('Cellular automata'))`)), 500);
await sleep(2600);
await scene("end");

await send("Page.stopScreencast");
await sleep(300);
const duration = Date.now() / 1000 - t0;
ws.close();
chrome.kill();

// Frames arrive only when something changes: hold each until the next one.
const list = shots.map((s, i) => `file '${s.file}'\nduration ${((shots[i + 1]?.t ?? s.t + 0.5) - s.t).toFixed(4)}`).join("\n");
writeFileSync(join(frames, "list.txt"), `${list}\nfile '${shots.at(-1).file}'\n`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", "fps=30,scale=1920:-2,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow", join(out, "app.mp4")]);
writeFileSync(join(out, "scenes.json"), JSON.stringify({ duration: +duration.toFixed(2), width: 1920, height: Math.round((1920 * H) / W / 2) * 2, scenes }, null, 2));
rmSync(frames, { recursive: true, force: true });
console.log(`recorded ${duration.toFixed(1)}s, ${shots.length} frames → ${join(out, "app.mp4")}`);
