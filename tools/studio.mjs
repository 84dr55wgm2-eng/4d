// Drive the real app in headless Chromium and capture frames (ACTION -> CAPTURE -> INSPECT loop).
// Usage: node tools/studio.mjs <scenario.mjs> [outDir] [url]
// A scenario exports `default async ({ page, shot, run, wait, key }) => {}`.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [scenarioPath, outDir = 'tools/out', url = 'http://127.0.0.1:5173/?capture'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
// Pass the proxy as a raw flag: Playwright's `proxy` option adds <-loopback>, which would proxy the local dev server.
const proxyArgs = process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [];
const browser = await chromium.launch({ args: [...proxyArgs, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|swiftshader|Automatic fallback/i.test(m.text())) console.log(`[${m.type()}]`, m.text().slice(0, 240)); });
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 160), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http]', r.status(), r.url().slice(0, 160)); });
page.on('request', (r) => { const u = r.url(); if (!/^(https?:\/\/127\.0\.0\.1|data:|blob:)/.test(u)) console.log('[external]', u.slice(0, 140)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const run = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
/** advance N rendered frames (headless frames are slow; wait on the engine's own counter) */
const frames = async (n) => { const f0 = await run(() => window.studio.engine.frameCount); await page.waitForFunction(([f0, n]) => window.studio.engine.frameCount >= f0 + n, [f0, n], { timeout: 300000 }); };
const shot = async (name) => { const f = path.join(outDir, `${name}.png`); await page.screenshot({ path: f, timeout: 180000 }); log('shot', f); return f; };
/** deterministic: pause realtime loop, simulate N seconds, render one frame, capture */
const step = (sec) => run((s) => { window.studio.engine.paused = true; window.studio.engine.step(s); }, sec);
const capture = async (name) => { await run(() => { window.studio.engine.paused = true; window.studio.engine.renderOnce(); }); return shot(name); };
const key = async (code, down) => run(([c, d]) => window.studio.input.set(c, d), [code, down]);
await page.goto(url);
for (let i = 0; ; i++) {
  const st = await run(() => window.studio ? JSON.stringify({ p: window.studio.ui.phase, l: window.studio.ui.loading.map((x) => `${x.label}:${(x.loaded / 1e6).toFixed(1)}/${(x.total / 1e6).toFixed(1)}`) }) : 'none');
  if (/"p":"(ready|error)"/.test(st)) break;
  if (i % 6 === 0) log(st);
  await wait(5000);
  if (i > 110) throw new Error('boot timeout');
}
const phase = await run(() => window.studio.ui.phase + ' ' + (window.studio.ui.error ?? ''));
log('phase', phase);
if (phase.startsWith('ready')) {
  const scenario = (await import(pathToFileURL(path.resolve(scenarioPath)).href)).default;
  await scenario({ page, shot, run, wait, key, frames, log, step, capture });
} else await shot('error');
await browser.close();
