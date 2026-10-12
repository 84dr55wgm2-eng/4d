import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingSpec, DistrictPlan, Opening } from '../../core/types';
import type { MaterialLibrary } from './Materials';

/**
 * Pascal-style semantic construction for a street district: walls carry their openings, floors are
 * slabs, rooms are rects inside a building. One plan produces three consistent outputs:
 *   render   – PBR geometry grouped by material (metre UVs);
 *   collide  – walls with real door gaps, closed shop fronts, slabs (camera + actor);
 *   navigate – ground, accessible room floors and the bottom 2.4 m of every obstacle (Recast input).
 */
export interface DistrictBuild {
  render: THREE.Group;
  collide: THREE.BufferGeometry;
  navigate: THREE.BufferGeometry;
  /** interior rooms in world space, for relations and the creator */
  rooms: { id: string; buildingId: string; name: string; kind: string; corners: THREE.Vector3[]; floorY: number; ceilingY: number; tubes: THREE.Vector3[]; yaw: number; door?: { position: THREE.Vector3; yaw: number; width: number } }[];
}

type Sink = { add(mat: string, g: THREE.BufferGeometry): void };
const NAV_TOP = 2.4;

// ---------------------------------------------------------------- primitives with metre UVs
function metricBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order: px nx py ny pz nz, 4 vertices each
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}

/** Wall panel in local XY (x along wall, y up), outer face at z=0, thickness toward -z. */
function wallPanel(width: number, height: number, thick: number, holes: { x0: number; y0: number; x1: number; y1: number }[]) {
  const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(width, 0), new THREE.Vector2(width, height), new THREE.Vector2(0, height)]);
  for (const h of holes) {
    const x0 = Math.max(0.05, h.x0), x1 = Math.min(width - 0.05, h.x1), y0 = Math.max(0, h.y0), y1 = Math.min(height - 0.05, h.y1);
    if (x1 - x0 < 0.1 || y1 - y0 < 0.1) continue;
    if (y0 <= 0.001) {
      // door / shop front reaching the floor: notch the outline instead of a hole touching the edge
      continue;
    }
    s.holes.push(new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)]));
  }
  // floor-level openings: rebuild the outline with notches
  const floorHoles = holes.filter((h) => h.y0 <= 0.001).sort((a, b) => a.x0 - b.x0);
  if (floorHoles.length) {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    for (const h of floorHoles) {
      const x0 = Math.max(0.05, h.x0), x1 = Math.min(width - 0.05, h.x1), y1 = Math.min(height - 0.05, h.y1);
      pts.push(new THREE.Vector2(x0, 0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, 0));
    }
    pts.push(new THREE.Vector2(width, 0), new THREE.Vector2(width, height), new THREE.Vector2(0, height));
    const notched = new THREE.Shape(pts);
    notched.holes = s.holes;
    return extrude(notched, thick);
  }
  return extrude(s, thick);
}

function extrude(shape: THREE.Shape, thick: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -thick);
  return g;
}

// ---------------------------------------------------------------- builder
export function buildDistrict(plan: DistrictPlan, mats: MaterialLibrary): DistrictBuild {
  const byMat = new Map<string, THREE.BufferGeometry[]>();
  const collide: THREE.BufferGeometry[] = [];
  const navigate: THREE.BufferGeometry[] = [];
  const sink: Sink = { add: (m, g) => { let a = byMat.get(m); if (!a) byMat.set(m, (a = [])); a.push(g); } };
  const out: DistrictBuild = { render: new THREE.Group(), collide: null!, navigate: null!, rooms: [] };
  out.render.name = 'district';

  buildStreet(plan, sink, collide, navigate);
  for (const b of plan.buildings) buildBuilding(b, sink, collide, navigate, out, mats);

  for (const [key, geos] of byMat) {
    if (key === '__none') { geos.forEach((g) => g.dispose()); continue; }
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeVertexNormals();
    let mat: THREE.Material;
    if (key.startsWith('sign|')) {
      const [, text, sub, c0, c1, aspect] = key.split('|');
      mat = mats.sign(text, sub || undefined, [c0, c1], +aspect);
    } else if (key.includes('#')) {
      const [name, tint] = key.split('#');
      mat = mats.get(name, tint.split(',').map(Number) as [number, number, number]);
    } else mat = mats.get(key);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !key.startsWith('glass');
    mesh.receiveShadow = true;
    mesh.name = key;
    // aoMap needs uv1 in three r15x+; reuse uv
    merged.setAttribute('uv1', merged.getAttribute('uv'));
    out.render.add(mesh);
  }
  const strip = (gs: THREE.BufferGeometry[]) => {
    const flat = gs.map((g) => { const n = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k); return n; });
    const m = mergeGeometries(flat, false)!;
    flat.forEach((g) => g.dispose());
    // index for BVH / Recast
    const idx = new Uint32Array(m.getAttribute('position').count).map((_, i) => i);
    m.setIndex(new THREE.BufferAttribute(idx, 1));
    return m;
  };
  out.collide = strip(collide);
  out.navigate = strip(navigate);
  collide.forEach((g) => g.dispose());
  navigate.forEach((g) => g.dispose());
  return out;
}

function place(g: THREE.BufferGeometry, m: THREE.Matrix4) { g.applyMatrix4(m); return g; }

function buildStreet(plan: DistrictPlan, sink: Sink, collide: THREE.BufferGeometry[], navigate: THREE.BufferGeometry[]) {
  const { length: L, carriageway: cw, sidewalk: sw, drain } = plan.street;
  const half = cw / 2, dw = drain ? 0.7 : 0;
  // carriageway (asphalt), slight camber is omitted: navmesh and feet stay exact
  const road = metricBox(L, 0.1, cw); road.translate(0, -0.05, 0);
  sink.add('asphalt', road.clone()); collide.push(road.clone()); navigate.push(road);
  for (const side of [-1, 1]) {
    // covered drain: concrete slabs flush with the shoulder
    if (drain) {
      const d = metricBox(L, 0.16, dw); d.translate(0, 0.0, side * (half + dw / 2));
      sink.add('drain_slab', d.clone()); collide.push(d.clone()); navigate.push(d);
      // kerb lip toward the road
      const k = metricBox(L, 0.2, 0.12); k.translate(0, 0.0, side * (half + 0.06));
      sink.add('kerb', k);
    }
    // shoulder / walkway: worn pavers near buildings, laterite at the drain edge
    const p = metricBox(L, 0.16, sw - 1.1); p.translate(0, 0.0, side * (half + dw + 1.1 + (sw - 1.1) / 2));
    sink.add('pavers', p.clone()); collide.push(p.clone()); navigate.push(p);
    const dirt = metricBox(L, 0.14, 1.1); dirt.translate(0, -0.01, side * (half + dw + 0.55));
    sink.add('laterite', dirt.clone()); collide.push(dirt.clone()); navigate.push(dirt);
  }
  // overhead wires: sagging spans pole to pole, plus service drops to the facades (the visual signature of the street)
  const poles = (plan as DistrictPlan & { poles?: [number, number, number][] }).poles ?? [];
  const sag = (a: THREE.Vector3, b: THREE.Vector3, drop: number, r: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -drop * 4 * t * (1 - t), 0))); }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 5, false);
    sink.add('cable', g);
  };
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = new THREE.Vector3(...poles[i]), b = new THREE.Vector3(...poles[i + 1]);
    for (const [dy, dz, d] of [[8.05, -0.55, 0.7], [8.05, 0.0, 0.75], [8.05, 0.55, 0.7], [6.9, 0.2, 0.9]] as const)
      sag(a.clone().add(new THREE.Vector3(0, dy, dz)), b.clone().add(new THREE.Vector3(0, dy, dz)), d, 0.012);
  }
  for (const p of poles) for (const side of [-1, 1]) {
    // service drop across the street and to the near facade
    const from = new THREE.Vector3(p[0], p[1] + 6.9, p[2]);
    const to = new THREE.Vector3(p[0] + side * 2.5, 5.2, side === 1 ? 7.45 : -7.45);
    sag(from, to, 0.35, 0.009);
  }
  // back-lots ground so the scene never ends in a void behind buildings
  const back = metricBox(L + 30, 0.1, 50); back.translate(0, -0.1, 0);
  sink.add('laterite', back);
}

function buildBuilding(b: BuildingSpec, sink: Sink, collide: THREE.BufferGeometry[], navigate: THREE.BufferGeometry[], out: DistrictBuild, mats: MaterialLibrary) {
  const M = new THREE.Matrix4().compose(new THREE.Vector3(...b.front), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(b.yaw)), new THREE.Vector3(1, 1, 1));
  const W = b.width, D = b.depth, FH = b.floorHeight, T = 0.22;
  // white_plaster_02 albedo is ~0.53: lift the paint factor so painted render reads at real-world brightness
  const paint = `plaster#${b.style.paint.map((c) => +(c * 1.45).toFixed(3)).join(',')}`;
  const base = `plaster_base#${(b.style.base ?? [0.42, 0.4, 0.38]).join(',')}`;
  const H = b.floors * FH;
  const accessible = new Set(b.rooms.map((r) => r.id));
  const add = (mat: string, g: THREE.BufferGeometry, opts: { collide?: boolean; nav?: boolean } = {}) => {
    place(g, M);
    if (opts.collide) collide.push(g.clone());
    if (opts.nav) { const n = g.clone(); clipBelow(n, NAV_TOP); navigate.push(n); }
    sink.add(mat, g);
  };

  // walls: front (z=0, x∈[-W/2,W/2]), back (z=-D), left (x=-W/2), right (x=+W/2)
  const walls: { side: Opening['wall']; len: number; m: THREE.Matrix4 }[] = [
    { side: 'front', len: W, m: new THREE.Matrix4().makeTranslation(-W / 2, 0, 0) },
    { side: 'back', len: W, m: new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(W / 2, 0, -D)) },
    { side: 'left', len: D, m: new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-W / 2, 0, -D)) },
    { side: 'right', len: D, m: new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(W / 2, 0, 0)) },
  ];
  for (let f = 0; f < b.floors; f++) {
    const y0 = f * FH;
    for (const w of walls) {
      const ops = b.openings.filter((o) => o.wall === w.side && o.level === f);
      const holes = ops.map((o) => ({ x0: o.offset - o.width / 2 + w.len / 2, x1: o.offset + o.width / 2 + w.len / 2, y0: o.kind === 'window' ? (o.sill ?? 0.9) : 0, y1: (o.kind === 'window' ? (o.sill ?? 0.9) : 0) + o.height }));
      const g = wallPanel(w.len, FH, T, holes);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, y0, 0).multiply(w.m));
      add(f === 0 ? paint : paint, g, { collide: true, nav: f === 0 });
      for (const o of ops) buildOpening(o, w.len, y0, w.m, b, add, accessible.size > 0);
    }
    // floor slab edge (drip band) + slab
    const slab = metricBox(W + 0.24, 0.24, D + 0.24); slab.translate(0, y0 + FH - 0.02 + 0.12 - 0.12, -D / 2);
    add('concrete', slab, { collide: true });
  }
  // plinth band (darker, splash-stained)
  for (const w of walls) {
    const g = metricBox(w.len, 0.5, 0.05); g.translate(w.len / 2, 0.25, 0.025);
    g.applyMatrix4(w.m);
    const ops = b.openings.filter((o) => o.wall === w.side && o.level === 0 && o.kind !== 'window');
    if (ops.length) { // split plinth around floor openings
      let x = 0;
      for (const o of [...ops].sort((a, c) => a.offset - c.offset)) {
        const x1 = o.offset - o.width / 2 + w.len / 2;
        if (x1 - x > 0.1) { const s = metricBox(x1 - x, 0.5, 0.05); s.translate(x + (x1 - x) / 2, 0.25, 0.025); s.applyMatrix4(w.m); add(base, s); }
        x = o.offset + o.width / 2 + w.len / 2;
      }
      if (w.len - x > 0.1) { const s = metricBox(w.len - x, 0.5, 0.05); s.translate(x + (w.len - x) / 2, 0.25, 0.025); s.applyMatrix4(w.m); add(base, s); }
      g.dispose();
    } else add(base, g);
  }
  // roof: parapet + slab, or corrugated sheet
  if (b.style.roof === 'parapet') {
    for (const w of walls) { const p = metricBox(w.len, 0.95, 0.18); p.translate(w.len / 2, H + 0.475, -0.09); p.applyMatrix4(w.m); add(paint, p); }
    const coping = metricBox(W + 0.1, 0.06, 0.3); coping.translate(0, H + 0.98, 0.0); add('concrete', coping);
    // roof-top water tank on a steel stand (very common), placed toward the back
    const stand = metricBox(1.4, 1.2, 1.4); stand.translate(W / 2 - 1.3, H + 0.6, -D + 1.5); add('steel_rusty', stand);
    const tank = new THREE.CylinderGeometry(0.7, 0.7, 1.5, 24, 1); remapCylUV(tank, 0.7, 1.5); tank.translate(W / 2 - 1.3, H + 1.95, -D + 1.5); add('tank_plastic', tank);
  } else {
    const sheet = metricBox(W + 0.6, 0.05, D + 0.8); sheet.rotateX(THREE.MathUtils.degToRad(-8)); sheet.translate(0, H + 0.55, -D / 2); add('roof_metal', sheet);
  }
  // balconies on upper floors (front), with balustrade
  if (b.style.balcony) for (let f = 1; f < b.floors; f++) {
    const y0 = f * FH, bw = Math.min(W - 1.2, 6), bd = 1.1;
    const slab = metricBox(bw, 0.16, bd); slab.translate(0, y0 + 0.08, bd / 2); add('concrete', slab);
    const rail = metricBox(bw, 0.08, 0.1); rail.translate(0, y0 + 1.0, bd - 0.05); add(paint, rail);
    for (let x = -bw / 2 + 0.1; x <= bw / 2 - 0.1; x += 0.22) { const p = metricBox(0.07, 0.84, 0.07); p.translate(x, y0 + 0.58, bd - 0.05); add('concrete', p); }
    for (const sx of [-1, 1]) { const r = metricBox(0.1, 0.08, bd); r.translate(sx * (bw / 2 - 0.05), y0 + 1.0, bd / 2); add(paint, r); }
  }
  // signs
  for (const s of b.signs) {
    const y = s.level * FH + (s.level === 0 ? FH - 0.15 : FH * 0.55);
    if (s.kind === 'blade') {
      const g = metricBox(0.06, 0.9, 1.4); g.translate(W / 2 - 0.4, y - 0.4, 0.75);
      add(`sign|${s.text}|${s.sub ?? ''}|${s.colors[0]}|${s.colors[1]}|1.56`, g);
      continue;
    }
    const sw = Math.min(W - 0.6, 7), sh = s.kind === 'painted' ? 0.9 : 1.1;
    const g = new THREE.PlaneGeometry(sw, sh); g.translate(0, y - sh / 2, s.kind === 'painted' ? 0.012 : 0.09);
    add(`sign|${s.text}|${s.sub ?? ''}|${s.colors[0]}|${s.colors[1]}|${(sw / sh).toFixed(2)}`, g);
    if (s.kind === 'board') { const back = metricBox(sw + 0.08, sh + 0.08, 0.06); back.translate(0, y - sh / 2, 0.05); add('steel_painted', back); }
  }
  // AC unit on a side of the upper floor + satellite dish on the parapet
  if (b.floors > 1) {
    const ac = metricBox(0.8, 0.55, 0.32); ac.translate(-W / 2 + 0.9, FH + 0.8, 0.18); add('ac_unit', ac);
    const dish = new THREE.SphereGeometry(0.45, 18, 8, 0, Math.PI * 2, 0, 0.6); dish.rotateX(-Math.PI / 2.4); dish.translate(-W / 2 + 0.8, H + 1.3, -0.3); add('steel_painted', dish);
  }

  // rooms: interior lining, tiled floor, ceiling, fixtures, light
  for (const r of b.rooms) {
    const [x0, z0, x1, z1] = r.rect, y0 = r.level * FH;
    const floor = metricBox(x1 - x0, 0.06, z1 - z0); floor.translate((x0 + x1) / 2, y0 + 0.03, (z0 + z1) / 2); add('floor_tile', floor, { nav: true, collide: true });
    const ceil = new THREE.PlaneGeometry(x1 - x0, z1 - z0); ceil.rotateX(Math.PI / 2); ceil.translate((x0 + x1) / 2, y0 + FH - 0.25, (z0 + z1) / 2); add('ceiling', ceil);
    const lining: [number, number, number, number, number][] = [[x0, z1, x1, z1, Math.PI], [x0, z0, x1, z0, 0], [x0, z0, x0, z1, Math.PI / 2], [x1, z0, x1, z1, -Math.PI / 2]];
    for (const [ax, az, bx, bz, ry] of lining) {
      const len = Math.hypot(bx - ax, bz - az);
      const lower = new THREE.PlaneGeometry(len, 1.1); lower.translate(0, 0.55 + y0 + 0.06, 0); lower.rotateY(ry); lower.translate((ax + bx) / 2 + Math.sin(ry) * 0.012, 0, (az + bz) / 2 + Math.cos(ry) * 0.012);
      // the front lining would cover the door; interior dado only on side/back walls
      if (az === z1 && bz === z1) { lower.dispose(); continue; }
      add('interior_dado', lower);
    }
    // period notices on the cybercafé walls (canvas-painted, fictional wording)
    if (r.kind === 'cybercafe') {
      const notices: [number, number, number, number, string, string, string, string][] = [
        [(x0 + x1) / 2 - 2.2, z0, 0, 1.6, 'BROWSING ₦150 / HR', 'Night browsing 10pm–6am ₦500 • Printing ₦20', '#fdf6e3', '#0d3b66'],
        [(x0 + x1) / 2 + 2.0, z0, 0, 1.3, 'NO FOOD • NO DRINKS', 'Pay before you browse — Management', '#ffffff', '#b00020'],
        [x0, (z0 + z1) / 2, Math.PI / 2, 1.4, 'E-MAIL • CHAT • SCAN', 'CV typing • Lamination • Passport photos', '#ffd23f', '#3a0ca3'],
        [x1, (z0 + z1) / 2 + 1.5, -Math.PI / 2, 1.3, 'NEPA OFF = GEN ON', 'Generator surcharge ₦50 / hr', '#fff4d6', '#202060'],
      ];
      for (const [nx, nz, ry, w, text, sub, c0, c1] of notices) {
        const h = w * 0.62;
        const g = new THREE.PlaneGeometry(w, h); g.translate(0, y0 + 1.95, 0); g.rotateY(ry);
        g.translate(nx + Math.sin(ry) * 0.03, 0, nz + Math.cos(ry) * 0.03);
        add(`sign|${text}|${sub}|${c0}|${c1}|${(w / h).toFixed(2)}`, g);
      }
    }
    // fluorescent tubes on the ceiling, real light is runtime-owned (toggle)
    const tubes: THREE.Vector3[] = [];
    for (let x = x0 + 1.5; x < x1 - 0.8; x += 2.6) for (let z = z0 + 1.6; z < z1 - 0.8; z += 2.8) tubes.push(new THREE.Vector3(x, y0 + FH - 0.29, z));
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => new THREE.Vector3(x, y0, z).applyMatrix4(M));
    const doorOp = b.openings.find((o) => o.kind === 'door' && o.level === r.level && o.wall === 'front' && o.offset - o.width / 2 >= x0 - 0.01 && o.offset + o.width / 2 <= x1 + 0.01);
    out.rooms.push({ id: r.id, buildingId: b.id, name: r.name, kind: r.kind, corners, floorY: y0 + 0.06, ceilingY: y0 + FH - 0.25,
      tubes: tubes.map((t) => t.clone().applyMatrix4(M)), yaw: b.yaw,
      door: doorOp ? { position: new THREE.Vector3(doorOp.offset, y0, 0).applyMatrix4(M), yaw: b.yaw, width: doorOp.width } : undefined });
  }
  // non-accessible ground floor volume: invisible closed block behind the front wall, so nobody walks into a shop
  if (!b.rooms.some((r) => r.level === 0)) {
    const block = metricBox(W - 0.5, FH, D - 0.5); block.translate(0, FH / 2, -D / 2);
    place(block, M);
    collide.push(block.clone()); const n = block.clone(); clipBelow(n, NAV_TOP); navigate.push(n); block.dispose();
  }
}

/** Openings: frames, shutters, louvres, burglar bars, awnings, recessed shop interiors. */
function buildOpening(o: Opening, wallLen: number, y0: number, wm: THREE.Matrix4, b: BuildingSpec, add: (m: string, g: THREE.BufferGeometry, o?: { collide?: boolean; nav?: boolean }) => void, hasRooms: boolean) {
  const cx = o.offset + wallLen / 2;
  const put = (mat: string, g: THREE.BufferGeometry, opts?: { collide?: boolean; nav?: boolean }) => { g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, y0, 0).multiply(wm)); add(mat, g, opts); };
  const sill = o.kind === 'window' ? (o.sill ?? 0.9) : 0;
  const top = sill + o.height;
  const frameMat = o.kind === 'window' ? 'frame_aluminium' : 'steel_painted';
  // frame
  const fw = 0.07;
  for (const [x, y, w, h] of [[cx - o.width / 2 + fw / 2, sill + o.height / 2, fw, o.height], [cx + o.width / 2 - fw / 2, sill + o.height / 2, fw, o.height], [cx, top - fw / 2, o.width, fw]] as const) {
    const g = metricBox(w, h, 0.12); g.translate(x, y, -0.08); put(frameMat, g);
  }
  if (o.kind === 'window') {
    const s = metricBox(o.width + 0.16, 0.06, 0.2); s.translate(cx, sill - 0.03, 0.02); put('concrete', s);
    if (b.style.louvres) {
      // jalousie (louvre) glass blades in aluminium carriers
      const n = Math.max(4, Math.floor(o.height / 0.1));
      for (let i = 0; i < n; i++) {
        const blade = metricBox(o.width - 0.14, 0.1, 0.006);
        blade.rotateX(THREE.MathUtils.degToRad(-28));
        blade.translate(cx, sill + 0.07 + i * (o.height - 0.1) / n, -0.12);
        put('glass_louvre', blade);
      }
    } else {
      const pane = new THREE.PlaneGeometry(o.width - 0.14, o.height - 0.14); pane.translate(cx, sill + o.height / 2, -0.1); put('glass_louvre', pane);
    }
    // dark interior behind glass so windows read as rooms, not holes into the sky
    const back = new THREE.PlaneGeometry(o.width, o.height); back.translate(cx, sill + o.height / 2, -0.6); put('interior_dark', back);
    if (b.style.bars) {
      for (let x = cx - o.width / 2 + 0.12; x < cx + o.width / 2 - 0.06; x += 0.13) { const r = metricBox(0.018, o.height - 0.06, 0.018); r.translate(x, sill + o.height / 2, 0.06); put('steel_dark', r); }
      for (const y of [sill + 0.15, sill + o.height / 2, top - 0.15]) { const r = metricBox(o.width - 0.08, 0.03, 0.03); r.translate(cx, y, 0.06); put('steel_dark', r); }
    }
    return;
  }
  if (o.kind === 'shopfront') {
    // roll-up shutter housing + shutter two-thirds up, recessed shop interior with shelves
    const housing = metricBox(o.width + 0.1, 0.32, 0.32); housing.translate(cx, top + 0.12, 0.06); put('shutter', housing);
    const shut = metricBox(o.width - 0.1, 0.75, 0.04); shut.translate(cx, top - 0.38, -0.02); put('shutter', shut);
    const depth = 2.2;
    const floor = metricBox(o.width, 0.05, depth); floor.translate(cx, 0.025, -depth / 2); put('floor_tile', floor);
    const back = metricBox(o.width, o.height, 0.05); back.translate(cx, o.height / 2, -depth); put('interior_wall', back);
    for (const sx of [-1, 1]) { const side = metricBox(0.05, o.height, depth); side.translate(cx + sx * (o.width / 2 - 0.03), o.height / 2, -depth / 2); put('interior_wall', side); }
    const ceil = metricBox(o.width, 0.05, depth); ceil.translate(cx, o.height, -depth / 2); put('ceiling', ceil);
    for (const y of [0.5, 1.1, 1.7]) { const shelf = metricBox(o.width - 0.3, 0.04, 0.4); shelf.translate(cx, y, -depth + 0.25); put('wood_shelf', shelf); }
    // goods on shelves (varied boxes give the read of stocked provisions without fake objects up close)
    for (const y of [0.52, 1.12, 1.72]) for (let x = cx - o.width / 2 + 0.3; x < cx + o.width / 2 - 0.3; x += 0.32) {
      const hgt = 0.12 + ((x * 7.3 + y * 3.1) % 1 + 1) % 1 * 0.18; const g = metricBox(0.26, hgt, 0.28); g.translate(x, y + 0.02 + hgt / 2, -depth + 0.25);
      put(`goods${Math.floor(((x * 13.7 + y * 5.3) % 4 + 4) % 4)}`, g);
    }
    // the shop is not walkable: invisible counter line just inside the opening
    const stop = metricBox(o.width, NAV_TOP, 0.2); stop.translate(cx, NAV_TOP / 2, -0.3);
    stop.applyMatrix4(new THREE.Matrix4().makeTranslation(0, y0, 0).multiply(wm));
    add('__none', stop, { collide: true, nav: true });
  }
  if (o.kind === 'door' && !hasRooms) {
    // closed steel door for inaccessible buildings
    const d = metricBox(o.width - 0.1, o.height - 0.05, 0.05); d.translate(cx, o.height / 2, -0.12); put('steel_painted', d, { collide: true, nav: true });
  }
  if (o.level === 0) {
    // corrugated awning on two brackets (classic shopfront shade)
    const aw = o.width + 0.8;
    const sheet = metricBox(aw, 0.03, 1.5); sheet.rotateX(THREE.MathUtils.degToRad(14)); sheet.translate(cx, top + 0.42, 0.72); put('roof_metal', sheet);
    for (const sx of [-1, 1]) { const br = metricBox(0.05, 0.05, 1.5); br.rotateX(THREE.MathUtils.degToRad(14)); br.translate(cx + sx * (aw / 2 - 0.2), top + 0.38, 0.72); put('steel_rusty', br); }
    // step at the threshold
    // threshold: from the street step through the wall reveal to the interior floor (no gap under the doorway)
    const step = metricBox(o.width + 0.3, 0.12, 0.8); step.translate(cx, 0.06, 0.05); put('concrete', step, { collide: true, nav: true });
  }
}

/** Keep only geometry below `top` (Recast input stays at walking height). */
function clipBelow(g: THREE.BufferGeometry, top: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > top) p.setY(i, top);
  p.needsUpdate = true;
}

function remapCylUV(g: THREE.BufferGeometry, r: number, h: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * h);
}
