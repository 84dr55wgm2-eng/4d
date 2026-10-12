import * as THREE from 'three';
import type { Trade } from '../../core/types';
import type { AssetRegistry, LoadedAsset } from '../../assets/AssetRegistry';
import type { DistrictBuild } from './DistrictBuilder';
import { seeded } from './Materials';

/**
 * Stocks shop recesses with authored objects (Poly Haven CC0 shelving and goods) chosen by trade.
 * Everything keeps its real size: shelf levels are measured on the shelving model itself (downward rays), goods
 * are only placed where their real height fits under the next level, and rows are filled using each model's
 * real width. Only shops near the actor/camera are dressed; far ones are released and their models unreferenced.
 */
type Slot = { asset: string; x: number; y: number; z: number; yaw: number };
interface Recipe {
  /** shelving units along the back wall (first that fits wins), optional side unit */
  back?: string[];
  side?: string;
  /** goods for shelf levels; consecutive items repeat in runs, as shops stock them */
  goods?: string[];
  /** furniture / floor stock near the opening, in recess-local metres (x from centre, z negative inward) */
  floor?: (w: number, d: number, rnd: () => number) => { asset: string; x: number; z: number; yaw: number; on?: string }[];
}

const RECIPES: Record<Trade, Recipe> = {
  provisions: {
    back: ['lagos.shelf_steel', 'lagos.shelf_steel_narrow'], side: 'lagos.shelf_steel_narrow',
    goods: ['lagos.food_cans', 'lagos.oil_tin', 'lagos.cleaner_tin', 'lagos.bleach', 'lagos.cleaner_bottle', 'lagos.gallon'],
    floor: (w) => [
      { asset: 'lagos.crate3', x: -w / 2 + 0.45, z: -0.75, yaw: 4 },
      { asset: 'lagos.basket', x: -w / 2 + 0.45, z: -0.75, yaw: -6, on: 'lagos.crate3' },
      { asset: 'lagos.gallon', x: w / 2 - 0.35, z: -0.7, yaw: 20 },
      { asset: 'lagos.gallon', x: w / 2 - 0.55, z: -0.75, yaw: -10 },
    ],
  },
  phones: {
    back: ['lagos.shelf_steel_narrow', 'lagos.shelf_wall'],
    goods: ['lagos.box', 'lagos.radio', 'lagos.boombox', 'lagos.cleaner_tin'],
    floor: (w) => [{ asset: 'lagos.smalltable', x: 0, z: -0.9, yaw: 0 }, { asset: 'lagos.radio', x: 0.1, z: -0.9, yaw: -15, on: 'lagos.smalltable' }],
  },
  chemist: {
    back: ['lagos.shelf_wall', 'lagos.shelf_steel_narrow'], side: 'lagos.shelf_steel_narrow',
    goods: ['lagos.medical_box', 'lagos.medical_tape', 'lagos.bleach', 'lagos.cleaner_bottle', 'lagos.cleaner_tin'],
  },
  business: {
    back: ['lagos.shelf_wall'],
    goods: ['lagos.binders', 'lagos.box'],
    floor: () => [
      { asset: 'lagos.desk', x: 0, z: -1.0, yaw: 180 },
      { asset: 'lagos.crt', x: 0, z: -1.05, yaw: 0, on: 'lagos.desk' },
      { asset: 'lagos.chair', x: 0, z: -1.75, yaw: 0 },
    ],
  },
  electricals: {
    back: ['lagos.shelf_steel', 'lagos.shelf_steel_narrow'],
    goods: ['lagos.paint_tin', 'lagos.spray', 'lagos.toolbox', 'lagos.cleaner_tin', 'lagos.box'],
    floor: (w) => [{ asset: 'lagos.wood_crate', x: -w / 2 + 0.6, z: -0.75, yaw: 0 }, { asset: 'lagos.toolbox', x: -w / 2 + 0.6, z: -0.75, yaw: 12, on: 'lagos.wood_crate' }],
  },
  fashion: {
    back: ['lagos.shelf_wall', 'lagos.shelf_steel_narrow'],
    goods: ['lagos.basket', 'lagos.box', 'lagos.binders'],
    floor: (w) => [{ asset: 'lagos.stool', x: w / 2 - 0.5, z: -0.9, yaw: 30 }],
  },
  barber: {
    back: ['lagos.shelf_wall'],
    goods: ['lagos.cleaner_bottle', 'lagos.bleach', 'lagos.cleaner_tin'],
    floor: () => [{ asset: 'lagos.chair', x: 0, z: -1.2, yaw: 180 }, { asset: 'lagos.stool', x: -0.9, z: -0.9, yaw: 0 }],
  },
  photo: {
    back: ['lagos.shelf_wall'],
    goods: ['lagos.box', 'lagos.binders'],
    floor: () => [{ asset: 'lagos.stool', x: 0, z: -1.4, yaw: 0 }, { asset: 'lagos.chair', x: 0.9, z: -0.9, yaw: 200 }],
  },
  canteen: {
    back: ['lagos.shelf_steel_narrow'],
    goods: ['lagos.gallon', 'lagos.oil_tin', 'lagos.food_cans'],
    floor: (w) => [
      { asset: 'lagos.smalltable', x: -0.2, z: -1.0, yaw: 0 },
      { asset: 'lagos.gas', x: w / 2 - 0.35, z: -1.4, yaw: 0 },
      { asset: 'lagos.crate', x: -w / 2 + 0.4, z: -0.7, yaw: 10 },
      { asset: 'lagos.crate', x: -w / 2 + 0.42, z: -0.7, yaw: -4, on: 'lagos.crate' },
    ],
  },
  books: {
    back: ['lagos.shelf_steel', 'lagos.shelf_steel_narrow'],
    goods: ['lagos.binders', 'lagos.box'],
  },
  general: {
    back: ['lagos.shelf_steel_narrow'],
    goods: ['lagos.box', 'lagos.gallon', 'lagos.cleaner_tin'],
    floor: (w) => [{ asset: 'lagos.wood_crate', x: w / 2 - 0.6, z: -0.8, yaw: 0 }],
  },
};

/** Surfaces (y, local) a model offers to put things on: upward faces hit by vertical rays through its footprint. */
function shelfLevels(template: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(template);
  const ray = new THREE.Raycaster();
  const ys: number[] = [];
  template.updateMatrixWorld(true);
  for (const fx of [-0.25, 0, 0.25]) {
    const x = THREE.MathUtils.lerp(box.min.x, box.max.x, 0.5 + fx), z = (box.min.z + box.max.z) / 2;
    ray.set(new THREE.Vector3(x, box.max.y + 1, z), new THREE.Vector3(0, -1, 0));
    for (const h of ray.intersectObject(template, true)) {
      const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
      if (n && n.y > 0.7 && h.point.y > 0.05) ys.push(h.point.y);
    }
  }
  ys.sort((a, b) => a - b);
  const out: number[] = [];
  for (const y of ys) if (!out.length || y - out[out.length - 1] > 0.05) out.push(y);
  return out;
}

const _m = new THREE.Matrix4();
const levelCache = new WeakMap<THREE.Object3D, number[]>();
const levelsOf = (a: LoadedAsset) => { let l = levelCache.get(a.template); if (!l) { l = shelfLevels(a.template); levelCache.set(a.template, l); } return l; };

export class ShopDresser {
  readonly group = new THREE.Group();
  /** per dressed shop: world matrices per asset (instancing input) + the assets it retains */
  private dressed = new Map<string, { slots: Map<string, THREE.Matrix4[]>; assets: string[] }>();
  /** one InstancedMesh per (asset, mesh) for all dressed shops: a few dozen draw calls for every stocked shop */
  private batches = new Map<string, THREE.InstancedMesh[]>();
  private templates = new Map<string, LoadedAsset>();
  private dirty = new Set<string>();
  private loading = new Set<string>();
  /** shop ids whose recipe referenced models missing from the manifest (reported, never replaced by boxes) */
  readonly missing = new Set<string>();
  radius = 30;

  /** compiles a new batch's shaders before it is shown (WebGLRenderer.compileAsync), so stocking never stalls a frame */
  prepare: (obj: THREE.Object3D) => Promise<unknown> = () => Promise.resolve();

  constructor(private registry: AssetRegistry) { this.group.name = 'shop-dressing'; }

  /**
   * Dress shops within radius of a focus point, release those beyond 1.5 × radius. One shop at a time, nearest
   * first, so stocking the street never stalls the frame loop (models parse and upload progressively).
   */
  update(build: DistrictBuild, focus: THREE.Vector3[]) {
    const dist = (m: THREE.Matrix4) => {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      return Math.min(...focus.map((f) => Math.hypot(f.x - p.x, f.z - p.z)));
    };
    let next: DistrictBuild['shops'][number] | null = null, best = Infinity;
    for (const shop of build.shops) {
      const d = dist(shop.matrix), has = this.dressed.has(shop.id);
      if (has && d > this.radius * 1.5) this.release(shop.id);
      else if (!has && !this.loading.has(shop.id) && d < this.radius && d < best) { best = d; next = shop; }
    }
    if (next && this.loading.size === 0) void this.dress(next);
  }

  /** drop everything (district rebuilt) */
  clear() { for (const id of [...this.dressed.keys()]) this.release(id); }

  get stats() {
    let instances = 0, drawCalls = 0;
    for (const list of this.batches.values()) for (const m of list) { instances += m.count; drawCalls++; }
    return { dressed: this.dressed.size, loading: this.loading.size, instances, drawCalls };
  }

  private release(id: string) {
    const d = this.dressed.get(id);
    if (!d) return;
    for (const a of d.slots.keys()) this.dirty.add(a);
    for (const a of d.assets) this.registry.release(a);
    this.dressed.delete(id);
    this.rebatch();
  }

  /** rebuild the instanced meshes of the assets whose instance lists changed */
  private rebatch() {
    const staged: THREE.InstancedMesh[] = [];
    // previous batches stay visible until their replacements are compiled (no flicker of neighbouring shops)
    const retired: THREE.InstancedMesh[] = [];
    for (const assetId of this.dirty) {
      retired.push(...(this.batches.get(assetId) ?? []));
      this.batches.delete(assetId);
      const mats: THREE.Matrix4[] = [];
      for (const d of this.dressed.values()) mats.push(...(d.slots.get(assetId) ?? []));
      const asset = this.templates.get(assetId);
      if (!mats.length || !asset) { this.templates.delete(assetId); continue; }
      const furniture = asset.record.entityType === 'FURNITURE' || asset.record.entityType === 'CHAIR';
      const list: THREE.InstancedMesh[] = [];
      asset.template.updateMatrixWorld(true);
      asset.template.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
        const local = mesh.matrixWorld;
        mats.forEach((m, i) => im.setMatrixAt(i, _m.multiplyMatrices(m, local)));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = furniture; im.receiveShadow = true;
        im.name = `dress:${assetId}`;
        list.push(im);
        staged.push(im);
      });
      this.batches.set(assetId, list);
    }
    this.dirty.clear();
    const swap = () => {
      for (const m of retired) { m.removeFromParent(); m.dispose(); }
      for (const m of staged) if ([...this.batches.values()].some((l) => l.includes(m))) this.group.add(m);
    };
    if (!staged.length) { swap(); return Promise.resolve(); }
    const tmp = new THREE.Group();
    staged.forEach((m) => tmp.add(m));
    return this.prepare(tmp).catch(() => undefined).then(swap);
  }

  private async dress(shop: DistrictBuild['shops'][number]) {
    this.loading.add(shop.id);
    const recipe = RECIPES[shop.trade] ?? RECIPES.general;
    const rnd = seeded(shop.id);
    const W = shop.width - 0.14, D = shop.depth, H = shop.height;
    const wanted = new Set<string>([...(recipe.back ?? []), ...(recipe.side ? [recipe.side] : []), ...(recipe.goods ?? []), ...(recipe.floor?.(W, D, rnd).map((f) => f.asset) ?? [])]);
    const loaded = new Map<string, LoadedAsset>();
    await Promise.all([...wanted].map(async (id) => {
      if (!this.registry.manifest.assets.some((a) => a.id === id)) { this.missing.add(`${shop.id}: ${id}`); return; }
      try { loaded.set(id, await this.registry.loadGLTF(id)); this.registry.retain(id); } catch { this.missing.add(`${shop.id}: ${id}`); }
    }));
    const slots: Slot[] = [];
    const size = (id: string) => loaded.get(id)!.size;
    // back wall shelving: as many units as fit, the first recipe entry that fits at all
    const backId = recipe.back?.find((id) => loaded.has(id) && size(id).x <= W - 0.1 && size(id).y <= H - 0.05);
    const shelves: { id: string; x: number; z: number; yaw: number }[] = [];
    if (backId) {
      const s = size(backId);
      const n = Math.max(1, Math.floor((W - 0.1) / (s.x + 0.04)));
      const span = n * s.x + (n - 1) * 0.04;
      for (let i = 0; i < n; i++) shelves.push({ id: backId, x: -span / 2 + s.x / 2 + i * (s.x + 0.04), z: -D + s.z / 2 + 0.04, yaw: 0 });
    }
    // side unit facing into the recess when the shop is wide and deep enough
    if (recipe.side && loaded.has(recipe.side) && W > 2.7) {
      const s = size(recipe.side), backDepth = backId ? size(backId).z + 0.08 : 0;
      // along the left wall, between the back shelving and the counter line near the opening
      if (s.x < D - backDepth - 0.8 && s.y <= H - 0.05) shelves.push({ id: recipe.side, x: -W / 2 + s.z / 2 + 0.04, z: -D + backDepth + 0.05 + s.x / 2, yaw: 90 });
    }
    for (const sh of shelves) slots.push({ asset: sh.id, x: sh.x, y: 0, z: sh.z, yaw: sh.yaw });
    // goods on measured shelf levels, in runs of identical items, only where they fit under the next level
    const goods = (recipe.goods ?? []).filter((g) => loaded.has(g));
    for (const sh of shelves) {
      if (!goods.length) break;
      const s = size(sh.id);
      const levels = levelsOf(loaded.get(sh.id)!).filter((y) => y < H - 0.2);
      levels.forEach((y, li) => {
        const clearance = (levels[li + 1] ?? Math.min(H, s.y + 0.45)) - y - 0.03;
        let x = -s.x / 2 + 0.04;
        let pick = Math.floor(rnd() * goods.length), run = 0;
        while (x < s.x / 2 - 0.04) {
          if (run <= 0) { pick = (pick + 1 + Math.floor(rnd() * 2)) % goods.length; run = 2 + Math.floor(rnd() * 4); }
          const g = goods[pick], gs = size(g);
          if (gs.y > clearance || gs.z > s.z) { run = 0; if (goods.every((q) => size(q).y > clearance)) break; continue; }
          if (x + gs.x > s.x / 2 - 0.02) break;
          // shelf-local → recess-local (yaw 0 or ±90)
          const lx = x + gs.x / 2, lz = (rnd() - 0.5) * Math.max(0, s.z - gs.z) * 0.5;
          const r = THREE.MathUtils.degToRad(sh.yaw);
          slots.push({ asset: g, x: sh.x + lx * Math.cos(r) + lz * Math.sin(r), y: y + 0.002, z: sh.z - lx * Math.sin(r) + lz * Math.cos(r), yaw: sh.yaw + (rnd() - 0.5) * 8 });
          x += gs.x + 0.015 + rnd() * 0.03; run--;
        }
      });
    }
    // floor stock / furniture (stacked "on" another model uses that model's measured top surface)
    const floorTop = new Map<string, number>();
    for (const f of recipe.floor?.(W, D, seeded(`${shop.id}/floor`)) ?? []) {
      if (!loaded.has(f.asset)) continue;
      let y = 0;
      if (f.on) {
        const under = loaded.get(f.on);
        if (!under) continue;
        y = floorTop.get(f.on) ?? (levelsOf(under).at(-1) ?? under.size.y);
      }
      if (y + size(f.asset).y > H - 0.05) continue;
      slots.push({ asset: f.asset, x: f.x, y, z: f.z, yaw: f.yaw });
      if (!f.on) floorTop.set(f.asset, levelsOf(loaded.get(f.asset)!).at(-1) ?? size(f.asset).y);
    }

    const bySlot = new Map<string, THREE.Matrix4[]>();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const sl of slots) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(sl.x, sl.y, sl.z), q.setFromAxisAngle(up, THREE.MathUtils.degToRad(sl.yaw)), one).premultiply(shop.matrix);
      if (!bySlot.has(sl.asset)) bySlot.set(sl.asset, []);
      bySlot.get(sl.asset)!.push(m);
    }
    for (const [id, a] of loaded) this.templates.set(id, a);
    this.dressed.set(shop.id, { slots: bySlot, assets: [...loaded.keys()] });
    for (const a of bySlot.keys()) this.dirty.add(a);
    await this.rebatch();
    this.loading.delete(shop.id);
  }
}
