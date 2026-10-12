import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetRecord, Entity, Vec3, WorldDocument } from '../../core/types';
import { buildDistrict, metricBox, type DistrictBuild } from './DistrictBuilder';
import { LAGOS_MATERIALS } from './LagosMaterials';
import { MaterialLibrary } from './Materials';

const NAV_TOP = 2.4;

/**
 * Runtime side of a district package: renders the semantic plan, and derives collision and Recast input
 * from the same plan + the current furniture/vehicle entities (so moving a desk re-routes the actor).
 */
export class DistrictRuntime {
  readonly mats: MaterialLibrary;
  build!: DistrictBuild;
  readonly group = new THREE.Group();
  private planKey = '';

  constructor(base: string, anisotropy: number) {
    this.mats = new MaterialLibrary(base, LAGOS_MATERIALS, anisotropy);
    this.group.name = 'district';
  }

  /** (Re)build visuals when the plan changed. Returns true if geometry changed. */
  sync(doc: WorldDocument) {
    const key = JSON.stringify(doc.district);
    if (key === this.planKey) return false;
    this.planKey = key;
    if (this.build) {
      this.build.render.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.group.remove(this.build.render);
      this.build.collide.dispose(); this.build.navigate.dispose();
    }
    this.build = buildDistrict(doc.district!, this.mats);
    this.build.render.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    this.group.add(this.build.render);
    this.group.updateMatrixWorld(true);
    return true;
  }

  /**
   * World boxes of entities that obstruct walking (desks, vehicles, generators…), not chairs/doors/props in hand.
   * Derived from the document + each model's measured footprint, so a route is planned around an obstacle
   * whether or not its model is currently loaded; the loaded object is only a fallback for unmeasured imports.
   */
  static obstacles(doc: WorldDocument, objects: Map<string, THREE.Object3D>, footprint: (assetId: string) => AssetRecord['footprint'] | undefined = () => undefined) {
    const out: THREE.Box3[] = [];
    const m = new THREE.Matrix4(), corner = new THREE.Vector3();
    for (const e of doc.entities) {
      if (!blocks(e)) continue;
      const fp = e.assetId ? footprint(e.assetId) : undefined;
      let b: THREE.Box3;
      if (fp) {
        b = new THREE.Box3();
        m.compose(new THREE.Vector3(...e.transform.position), new THREE.Quaternion(...e.transform.rotation), new THREE.Vector3(...e.transform.scale));
        for (const x of [fp.min[0], fp.max[0]]) for (const y of [fp.min[1], fp.max[1]]) for (const z of [fp.min[2], fp.max[2]]) b.expandByPoint(corner.set(x, y, z).applyMatrix4(m));
      } else {
        const o = objects.get(e.id);
        if (!o) continue;
        b = new THREE.Box3().setFromObject(o);
      }
      if (b.isEmpty() || b.getSize(new THREE.Vector3()).length() < 0.5) continue;
      b.expandByScalar(-0.03);
      out.push(b);
    }
    return out;
  }

  geometry(doc: WorldDocument, objects: Map<string, THREE.Object3D>, footprint?: (assetId: string) => AssetRecord['footprint'] | undefined) {
    const boxes = DistrictRuntime.obstacles(doc, objects, footprint).map((b) => {
      const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const top = Math.min(b.max.y, b.min.y + NAV_TOP);
      const g = new THREE.BoxGeometry(s.x, top - b.min.y, s.z);
      g.translate(c.x, (b.min.y + top) / 2, c.z);
      g.deleteAttribute('normal'); g.deleteAttribute('uv');
      return g.toNonIndexed();
    });
    const withBoxes = (base: THREE.BufferGeometry) => {
      const merged = mergeGeometries([base.index ? base.toNonIndexed() : base.clone(), ...boxes.map((b) => b.clone())], false)!;
      merged.setIndex(new THREE.BufferAttribute(new Uint32Array(merged.getAttribute('position').count).map((_, i) => i), 1));
      return merged;
    };
    const out = { collide: withBoxes(this.build.collide), navigate: withBoxes(this.build.navigate) };
    boxes.forEach((b) => b.dispose());
    return out;
  }
}

function blocks(e: Entity) {
  if (e.type === 'ACTOR' || e.type === 'DOOR' || e.type === 'CHAIR' || e.type === 'LIGHT') return false;
  if (e.capabilities.includes('pickable')) return false;
  if (!e.capabilities.includes('collidable')) return false;
  return true;
}

/** Procedural door leaf: origin at the hinge, leaf along +x, street face toward +z. */
export function doorObject(e: Entity, mats: MaterialLibrary) {
  const cfg = (e.metadata?.procedural ?? {}) as { width?: number; height?: number };
  const w = cfg.width ?? 1, h = cfg.height ?? 2.15;
  const g = new THREE.Group();
  const leaf = metricBox(w - 0.05, h - 0.03, 0.045);
  const uv = leaf.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  leaf.translate(w / 2, h / 2, 0);
  leaf.setAttribute('uv1', leaf.getAttribute('uv'));
  const mesh = new THREE.Mesh(leaf, mats.get('door_wood', [0.45, 0.58, 0.72]));
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  // glazed upper panel with bars + handle
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, h * 0.32), mats.get('glass_louvre'));
  glass.position.set(w / 2, h * 0.72, 0.026); g.add(glass);
  for (let x = w * 0.24; x <= w * 0.78; x += 0.1) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.015, h * 0.32, 0.015), mats.get('steel_dark'));
    bar.position.set(x, h * 0.72, 0.04); g.add(bar);
  }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.05), mats.get('frame_aluminium'));
  handle.position.set(w - 0.12, 1.02, 0.05); g.add(handle);
  return g;
}

/** Bank of authored fluorescent fixtures (one LIGHT entity, one switch) at the tube positions (entity-local). */
export function lightBankObject(e: Entity, template: THREE.Object3D | null, mats: MaterialLibrary) {
  const cfg = (e.metadata?.procedural ?? {}) as { fixtures?: [number, number, number][]; yaw?: number };
  const g = new THREE.Group();
  for (const p of cfg.fixtures ?? []) {
    let f: THREE.Object3D;
    if (template) f = template.clone(true);
    else {
      f = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8).rotateZ(Math.PI / 2), mats.get('fluorescent'));
    }
    f.position.set(...p);
    f.rotation.y = THREE.MathUtils.degToRad(cfg.yaw ?? 0);
    g.add(f);
  }
  // emissive tubes on authored fixtures: make sure they glow and are switchable (applySemanticState keys on emissive)
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats_ = Array.isArray(m.material) ? m.material : [m.material];
    const cloned = mats_.map((mat) => {
      const s = (mat as THREE.MeshStandardMaterial).clone();
      if (/tube|light|bulb|emiss|glow/i.test(s.name) || (s.emissive && s.emissive.getHex() !== 0)) { s.emissive = new THREE.Color(0.95, 0.98, 1); s.emissiveIntensity = 2; }
      return s;
    });
    m.material = cloned.length === 1 ? cloned[0] : cloned;
  });
  return g;
}

/** Flexible cable along authored points (entity-local), e.g. a PC power lead down to its wall socket. */
export function cableObject(e: Entity, mats: MaterialLibrary) {
  const cfg = (e.metadata?.procedural ?? {}) as { points?: Vec3[]; radius?: number };
  const pts = (cfg.points ?? []).map((p) => new THREE.Vector3(...p));
  if (pts.length < 2) return new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, pts.length * 10), cfg.radius ?? 0.005, 6, false), mats.get('cable'));
  mesh.castShadow = false; mesh.receiveShadow = true;
  return mesh;
}
