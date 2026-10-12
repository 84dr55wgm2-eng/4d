// Private conversion service: runs the GTA chain (cw-extract → Blender/Sollumz → package builder) as resumable
// jobs on a machine that holds the game files. Never part of the public site; never exposed without a token.
//
//   CONVERT_TOKEN=… GAME_DIR=/data/gta5 [BLENDER=blender] [PORT=8787] [HOST=127.0.0.1] [ALLOW_ORIGIN=https://…]
//   node tools/gta/service/server.mjs
//
// API (Bearer token):
//   GET    /health                       → what this service can run (game files, keys, Blender, Sollumz)
//   POST   /jobs {kind:'region', bbox:[x0,y0,x1,y1], name, gen9?, maxYmaps?, keepIntermediate?}
//          /jobs {kind:'fixture'}        (test content, no game file)
//   GET    /jobs, /jobs/:id              → state: steps with status, progress lines, error
//   POST   /jobs/:id/resume              → continue from the first unfinished step
//   GET    /jobs/:id/package             → the .cwspkg (private download, for the owner's own browser)
//   DELETE /jobs/:id                     → stop and delete the job's files
// Each step is itself resumable (cw-extract and the converter keep state files), so a restart loses no work.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const TOKEN = process.env.CONVERT_TOKEN;
const GAME = process.env.GAME_DIR ? path.resolve(process.env.GAME_DIR) : null;
const BLENDER = process.env.BLENDER ?? 'blender';
const JOBS = path.resolve(process.env.JOBS_DIR ?? path.join(ROOT, 'tools/gta/work/jobs'));
const CW = path.join(ROOT, 'tools/gta/cw-extract/bin/Release/net8.0/cw-extract');
const PORT = +(process.env.PORT ?? 8787), HOST = process.env.HOST ?? '127.0.0.1';
// the published studio's origin by default (the browser calls this service from the site, with the token)
const ORIGIN = process.env.ALLOW_ORIGIN ?? 'https://84dr55wgm2-eng.github.io';
if (!TOKEN) { console.error('CONVERT_TOKEN is required (the service never runs open)'); process.exit(2); }
fs.mkdirSync(JOBS, { recursive: true });

const STEPS = {
  region: ['keys', 'scan', 'index', 'region', 'extract-maps', 'deps', 'extract-deps', 'convert', 'pack', 'cleanup'],
  fixture: ['fixture', 'pack', 'cleanup'],
};

// ------------------------------------------------------------------ capabilities
function health() {
  const exe = GAME && ['GTA5.exe', 'gta5.exe', 'gta5_enhanced.exe', 'GTA5_Enhanced.exe'].find((f) => fs.existsSync(path.join(GAME, f)));
  const blender = spawnSync(BLENDER, ['--version'], { encoding: 'utf8' });
  const blenderOk = blender.status === 0;
  const sollumz = blenderOk ? spawnSync(BLENDER, ['--background', '--factory-startup', '--python-expr', 'import addon_utils,sys;sys.exit(0 if any(m.__name__.split(".")[-1] in ("sollumz","sollumz_dev") for m in addon_utils.modules()) else 3)'], { encoding: 'utf8' }).status === 0 : false;
  const missing = [];
  if (!GAME) missing.push('GAME_DIR: the GTA V installation directory (read only)');
  else if (!exe) missing.push(`game executable in ${GAME} (GTA5.exe, needed to derive the archive keys)`);
  if (!fs.existsSync(CW)) missing.push('cw-extract binary: run tools/gta/fetch-codewalker.sh && dotnet build -c Release tools/gta/cw-extract');
  if (!blenderOk) missing.push(`Blender >= 4.2 at "${BLENDER}"`);
  else if (!sollumz) missing.push('Sollumz extension installed in that Blender');
  return { ok: missing.length === 0, game: GAME ? { dir: GAME, executable: exe ?? null } : null, cwExtract: fs.existsSync(CW), blender: blenderOk ? blender.stdout.split('\n')[0] : null, sollumz, missing, canRun: { fixture: true, region: missing.length === 0 } };
}

// ------------------------------------------------------------------ jobs
const jobDir = (id) => path.join(JOBS, id);
const load = (id) => JSON.parse(fs.readFileSync(path.join(jobDir(id), 'job.json'), 'utf8'));
function save(job) { const f = path.join(jobDir(job.id), 'job.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(job, null, 1)); fs.renameSync(f + '.tmp', f); }
const running = new Map();

function run(job, step, cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(path.join(jobDir(job.id), `${step}.log`), 'a');
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...opts.env } });
    running.set(job.id, p);
    let last = '';
    p.stdout.on('data', (d) => { fs.writeSync(log, d); const lines = String(d).trim().split('\n'); last = lines.at(-1); job.progress = { step, line: last.slice(0, 400) }; save(job); });
    p.stderr.on('data', (d) => fs.writeSync(log, d));
    p.on('close', (code) => { fs.closeSync(log); running.delete(job.id); code === 0 ? resolve(last) : reject(new Error(`${step} exited with ${code}: ${last.slice(0, 400)} (see ${step}.log)`)); });
    p.on('error', (e) => { fs.closeSync(log); running.delete(job.id); reject(new Error(`${step}: ${e.message}`)); });
  });
}

async function step(job, name) {
  const work = path.join(jobDir(job.id), 'work');
  const pkg = path.join(jobDir(job.id), 'package');
  const cw = (cmd, extra = []) => run(job, name, CW, [cmd, '--game', GAME, '--work', work, ...(job.gen9 ? ['--gen9'] : []), ...extra]);
  switch (name) {
    case 'fixture': return run(job, name, 'node', ['tools/gta/fixtures/build-fixtures.mjs', work]);
    case 'keys': return cw('keys');
    case 'scan': return cw('scan');
    case 'index': return cw('index');
    case 'region': return run(job, name, CW, ['region', '--work', work, '--bbox', job.bbox.join(','), '--max', String(job.maxYmaps ?? 40)]);
    case 'extract-maps': return cw('extract', ['--list', path.join(work, 'region-ymaps.txt')]);
    case 'deps': return run(job, name, 'node', ['tools/gta/service/deps.mjs', work]);
    case 'extract-deps': return cw('extract', ['--list', path.join(work, 'deps.txt')]);
    case 'convert': return run(job, name, BLENDER, ['--background', '--factory-startup', '--python', 'tools/gta/blender/sollumz_to_gltf.py', '--', '--in', path.join(work, 'xml'), '--out', path.join(work, 'gltf')]);
    case 'pack': return run(job, name, 'npx', ['tsx', 'tools/gta/pack/build-package.ts', '--in', work, '--out', pkg, '--id', job.packageId, '--name', job.name, '--source', job.kind === 'fixture' ? 'fixture' : 'gta5', ...(job.kind === 'fixture' ? ['--vehicles', 'fx_car', '--annotations', 'tools/gta/fixtures/annotations.json'] : [])]);
    case 'cleanup':
      // originals and intermediate XML/textures are deleted unless asked to keep them; the package stays
      if (!job.keepIntermediate) for (const d of ['raw', 'xml', 'gltf']) fs.rmSync(path.join(work, d), { recursive: true, force: true });
      for (const f of fs.existsSync(work) ? fs.readdirSync(work) : []) if (f.endsWith('.tmp')) fs.rmSync(path.join(work, f), { force: true });
      return 'cleaned';
    default: throw new Error(`unknown step ${name}`);
  }
}

async function drive(job) {
  if (running.has(job.id)) return;
  job.status = 'running'; job.error = null; save(job);
  for (const s of job.steps) {
    if (s.status === 'done') continue;
    if (job.kind === 'region' && !GAME) { s.status = 'blocked'; job.status = 'blocked'; job.error = { code: 'game_files_missing', message: 'GAME_DIR is not configured on the conversion service' }; save(job); return; }
    s.status = 'running'; s.startedAt = new Date().toISOString(); save(job);
    try { s.result = await step(job, s.name); s.status = 'done'; s.endedAt = new Date().toISOString(); save(job); }
    catch (e) {
      s.status = 'failed'; job.status = 'failed';
      const msg = String(e.message ?? e);
      job.error = { step: s.name, code: /executable not found|FileNotFound/.test(msg) ? 'game_executable_missing' : /Blender|ENOENT.*blender/i.test(msg) ? 'blender_missing' : 'step_failed', message: msg };
      save(job); return;
    }
  }
  job.status = 'done'; job.package = `${job.id}/package.cwspkg`; save(job);
}

// ------------------------------------------------------------------ http
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-private-network': 'true', vary: 'origin' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const body = (req) => new Promise((r) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const authorized = (req) => { const h = req.headers.authorization ?? ''; const a = Buffer.from(h.replace(/^Bearer /, '')), b = Buffer.from(TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://x'), parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] === 'health') return send(res, 200, health());
    if (parts[0] !== 'jobs') return send(res, 404, { error: 'not found' });
    if (req.method === 'GET' && parts.length === 1) return send(res, 200, fs.readdirSync(JOBS).filter((d) => fs.existsSync(path.join(jobDir(d), 'job.json'))).map(load));
    if (req.method === 'POST' && parts.length === 1) {
      const b = await body(req);
      if (!STEPS[b.kind]) return send(res, 400, { error: 'kind must be "region" or "fixture"' });
      if (b.kind === 'region' && !(Array.isArray(b.bbox) && b.bbox.length === 4 && b.bbox.every(Number.isFinite))) return send(res, 400, { error: 'bbox [x0,y0,x1,y1] (GTA world X/Y) required' });
      const id = `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
      fs.mkdirSync(jobDir(id), { recursive: true });
      const job = { id, kind: b.kind, name: b.name ?? (b.kind === 'fixture' ? 'Ville de test (non GTA)' : `GTA V ${b.bbox.join(',')}`), packageId: b.packageId ?? `${b.kind}.${id}`, bbox: b.bbox, gen9: !!b.gen9, maxYmaps: b.maxYmaps, keepIntermediate: !!b.keepIntermediate, createdAt: new Date().toISOString(), status: 'queued', steps: STEPS[b.kind].map((name) => ({ name, status: 'pending' })) };
      save(job); void drive(job);
      return send(res, 202, job);
    }
    const id = parts[1];
    if (!id || !/^job_[a-z0-9_]+$/.test(id) || !fs.existsSync(path.join(jobDir(id), 'job.json'))) return send(res, 404, { error: 'unknown job' });
    if (req.method === 'GET' && parts.length === 2) return send(res, 200, load(id));
    if (req.method === 'POST' && parts[2] === 'resume') { const job = load(id); void drive(job); return send(res, 202, job); }
    if (req.method === 'GET' && parts[2] === 'package') {
      const f = path.join(jobDir(id), 'package.cwspkg');
      if (!fs.existsSync(f)) return send(res, 409, { error: 'package not ready' });
      res.writeHead(200, { 'content-type': 'application/zip', 'access-control-allow-origin': ORIGIN });
      return fs.createReadStream(f).pipe(res);
    }
    if (req.method === 'DELETE' && parts.length === 2) { running.get(id)?.kill(); fs.rmSync(jobDir(id), { recursive: true, force: true }); return send(res, 200, { deleted: id }); }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) { return send(res, 500, { error: String(e?.message ?? e) }); }
}).listen(PORT, HOST, () => {
  console.log(`conversion service on http://${HOST}:${PORT} — jobs in ${JOBS}`);
  // resume jobs interrupted by a restart
  for (const d of fs.readdirSync(JOBS)) { try { const j = load(d); if (j.status === 'running') { j.steps.forEach((s) => { if (s.status === 'running') s.status = 'pending'; }); void drive(j); } } catch { /* not a job */ } }
});
