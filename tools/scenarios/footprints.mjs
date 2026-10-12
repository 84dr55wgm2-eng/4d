// Measures the normalized bounds of every district asset with the app's own loader (pivot bottom-centre, metres)
// and writes tools/out/footprints.json; tools/prepare/merge_footprints.py stores them in the manifest.
import fs from 'node:fs';
export default async ({ run, log }) => {
  const out = await run(async () => {
    const r = window.studio.registry, res = {};
    for (const a of r.manifest.assets.filter((x) => x.id.startsWith('lagos.'))) {
      try {
        const l = await r.loadGLTF(a.id);
        l.template.updateMatrixWorld(true);
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        l.template.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox, e = o.matrixWorld.elements;
          for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
            const w = e[3] * x + e[7] * y + e[11] * z + e[15];
            const p = [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, (e[2] * x + e[6] * y + e[10] * z + e[14]) / w];
            for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
          }
        });
        res[a.id] = { min: mn.map((v) => +v.toFixed(3)), max: mx.map((v) => +v.toFixed(3)) };
      } catch (e) { res[a.id] = { error: String(e) }; }
    }
    return res;
  });
  fs.writeFileSync('tools/out/footprints.json', JSON.stringify(out, null, 1));
  log('footprints', Object.keys(out).length, Object.entries(out).filter(([, v]) => v.error).map(([k]) => k));
};
