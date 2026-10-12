// node tools/preview/sheet.mjs out.png file1,file2,...  (dev server must be running)
import { chromium } from 'playwright';
import fs from 'node:fs';
const [out, list] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1300, height: 1000 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://127.0.0.1:5173/tools/preview/assets.html?f=${list}`);
await p.waitForFunction(() => document.title.startsWith('done'), null, { timeout: 280000 });
for (const l of JSON.parse((await p.title()).slice(5))) console.log(l);
const data = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
await b.close();
