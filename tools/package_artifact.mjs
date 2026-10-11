// Package dist/ for claude.ai Artifact hosting:
//  - one HTML page with the bundle + CSS inlined (the page itself is the only document)
//  - remote assets downloaded and served alongside (the Artifact frame blocks other hosts)
//  - files over the per-file cap split into <file>.part0..N + content/parts.json
// Usage: ARTIFACT=1 PAGES_BASE=./ npx vite build && node tools/package_artifact.mjs dist <outDir>
import fs from 'node:fs';
import path from 'node:path';

const [dist = 'dist', out = 'artifact'] = process.argv.slice(2);
const CAP = 14 * 1024 * 1024;
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(dist, out, { recursive: true });

// 1. page
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const js = html.match(/src="\.\/(assets\/index-[^"]+\.js)"/)[1];
const css = html.match(/href="\.\/(assets\/index-[^"]+\.css)"/)[1];
const code = fs.readFileSync(path.join(dist, js), 'utf8').replaceAll('</script', '<\\/script');
const style = fs.readFileSync(path.join(dist, css), 'utf8');
const page = `<title>Cinematic World Studio</title>
<meta name="color-scheme" content="dark">
<style>${style}</style>
<canvas id="viewport" tabindex="0"></canvas>
<div id="root"></div>
<script type="module">${code}</script>
`;
fs.rmSync(path.join(out, 'index.html'));
fs.writeFileSync(path.join(out, 'studio.html'), page);
fs.rmSync(path.join(out, js));
fs.rmSync(path.join(out, css));
// bundle-relative helper files resolve against the page once the bundle is inlined
for (const f of fs.readdirSync(path.join(out, 'assets'))) fs.renameSync(path.join(out, 'assets', f), path.join(out, f));
fs.rmSync(path.join(out, 'assets'), { recursive: true });

// 2. remote assets -> local files
const manPath = path.join(out, 'content/manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
fs.mkdirSync(path.join(out, 'content/remote'), { recursive: true });
for (const a of man.assets) {
  if (!/^https?:/.test(a.url)) continue;
  const local = `content/remote/${a.id}.${a.format}`;
  const dst = path.join(out, local);
  if (!fs.existsSync(dst)) {
    const res = await fetch(a.url);
    if (!res.ok) throw new Error(`${a.id}: HTTP ${res.status}`);
    fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  }
  a.url = local;
}
fs.writeFileSync(manPath, JSON.stringify(man, null, 1));

// 3. split oversize files
const parts = {};
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(out)) {
  const size = fs.statSync(f).size;
  if (size <= CAP) continue;
  const buf = fs.readFileSync(f);
  const n = Math.ceil(size / CAP);
  for (let i = 0; i < n; i++) fs.writeFileSync(`${f}.part${i}`, buf.subarray(i * CAP, Math.min(size, (i + 1) * CAP)));
  fs.rmSync(f);
  parts[path.relative(out, f).replaceAll('\\', '/')] = { count: n, bytes: size };
}
fs.writeFileSync(path.join(out, 'content/parts.json'), JSON.stringify(parts, null, 1));
const files = walk(out);
console.log(`${files.length} files, ${(files.reduce((a, f) => a + fs.statSync(f).size, 0) / 1e6).toFixed(1)} MB; split:`, Object.keys(parts));
