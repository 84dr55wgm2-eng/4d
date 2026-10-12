import * as THREE from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { Entity, WorldDocument } from '../core/types';
import type { Catalog } from '../content/Catalog';
import type { SetConnector, SetDef } from '../content/package';

/**
 * Placed sets ("ensembles") of imported content. A placement is a studio entity (type SET) whose metadata names
 * the set (`<packageId>/<setId>`); its members are instanced from the package resources, keeping their authored
 * relative transforms, with one level of detail shown at a time. Collision and navigation come from the members'
 * collision geometry (the render mesh when the source had no separate collision).
 */
export const resourceAssetId = (pkg: string, res: string) => `pkg:${pkg}/${res}`;
export const setRefOf = (e: Entity) => (e.metadata?.set as { ref?: string } | undefined)?.ref;
const LOD_SWITCH = 220; // metres: beyond this, a placement shows its LOD members instead of its HD ones

export class AssemblyRuntime {
  readonly loading = new Set<string>();
  constructor(private registry: AssetRegistry, private catalog: Catalog) {}

  /** Factory for EntityRuntime: an empty group filled asynchronously with the set's members. */
  build(e: Entity): THREE.Object3D {
    const g = new THREE.Group();
    g.name = e.name;
    const ref = setRefOf(e);
    const hit = ref ? this.catalog.set(ref) : null;
    if (!hit) { g.userData.missing = ref; return g; }
    const hidden = new Set((e.metadata?.set as { hiddenMembers?: string[] }).hiddenMembers ?? []);
    this.loading.add(e.id);
    const { pkg, set } = hit;
    const hd = new THREE.Group(), lod = new THREE.Group();
    hd.name = 'hd'; lod.name = 'lod'; lod.visible = false;
    g.add(hd, lod);
    g.userData.lodGroups = { hd, lod };
    void Promise.all(set.members.filter((m) => !hidden.has(m.id)).map(async (m) => {
      const id = resourceAssetId(pkg.id, m.resource);
      try {
        const a = await this.registry.loadGLTF(id);
        this.registry.retain(id);
        const o = a.template.clone(true); // shared geometry and materials: static décor
        o.position.set(...m.position); o.quaternion.set(...m.quaternion); o.scale.set(...m.scale);
        o.userData.member = m.id; o.userData.resource = m.resource;
        o.traverse((x) => { x.userData.entityId = e.id; const mesh = x as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = m.lod !== 'LOD' && m.lod !== 'SLOD'; mesh.receiveShadow = true; } });
        (m.lod === 'LOD' || m.lod === 'SLOD' ? lod : hd).add(o);
      } catch (err) { console.warn('[assembly] member', m.id, err); g.userData.failed = [...(g.userData.failed ?? []), m.resource]; }
    })).finally(() => { this.loading.delete(e.id); g.userData.ready = true; g.dispatchEvent({ type: 'ready' } as never); });
    return g;
  }

  /** one level of detail per placement, by distance to the camera */
  updateLod(objects: Iterable<THREE.Object3D>, camera: THREE.Vector3) {
    const p = new THREE.Vector3();
    for (const o of objects) {
      const lg = o.userData.lodGroups as { hd: THREE.Group; lod: THREE.Group } | undefined;
      if (!lg || !lg.lod.children.length) continue;
      const far = o.getWorldPosition(p).distanceTo(camera) > LOD_SWITCH;
      lg.hd.visible = !far; lg.lod.visible = far;
    }
  }

  /** a placement's set definition */
  setOf(e: Entity): SetDef | null { const r = setRefOf(e); return r ? this.catalog.set(r)?.set ?? null : null; }

  /** connector of a placement in world space (position, outward normal) */
  connectorWorld(e: Entity, connectorId: string): (SetConnector & { world: THREE.Vector3; worldNormal: THREE.Vector3 }) | null {
    const s = this.setOf(e); const c = s?.connectors.find((x) => x.id === connectorId || x.id.endsWith(`/${connectorId}`));
    if (!s || !c) return null;
    const m = matrixOf(e);
    return { ...c, world: new THREE.Vector3(...c.position).applyMatrix4(m), worldNormal: new THREE.Vector3(...c.normal).transformDirection(m).setY(0).normalize() };
  }

  /** footprint of a placement in world XZ (rotated rectangle corners) */
  footprint(e: Entity) {
    const s = this.setOf(e); if (!s) return null;
    const m = matrixOf(e), b = s.bounds;
    return [[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.max[0], b.max[2]], [b.min[0], b.max[2]]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(m));
  }

  /** collision triangles of every placed set (world space), for collision + navigation */
  geometry(doc: WorldDocument, objects: Map<string, THREE.Object3D>) {
    const parts: THREE.BufferGeometry[] = [];
    for (const e of doc.entities) {
      if (e.type !== 'SET') continue;
      const o = objects.get(e.id); const hd = (o?.userData.lodGroups as { hd: THREE.Group } | undefined)?.hd;
      if (!o || !hd) continue;
      o.updateMatrixWorld(true);
      hd.traverse((x) => {
        const mesh = x as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat?.transparent && (mat.opacity ?? 1) < 0.6) return; // glazing does not block
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', mesh.geometry.getAttribute('position').clone());
        if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
        g.applyMatrix4(mesh.matrixWorld);
        parts.push(g.index ? g.toNonIndexed() : g);
      });
    }
    let n = 0; for (const p of parts) n += p.getAttribute('position').count;
    const pos = new Float32Array(n * 3);
    let o = 0; for (const p of parts) { pos.set(p.getAttribute('position').array as Float32Array, o); o += p.getAttribute('position').count * 3; p.dispose(); }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setIndex(new THREE.BufferAttribute(new Uint32Array(n).map((_, i) => i), 1));
    return out;
  }
}

export function matrixOf(e: Entity) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...e.transform.position), new THREE.Quaternion(...e.transform.rotation), new THREE.Vector3(...e.transform.scale));
}
export const yawOf = (e: Entity) => THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...e.transform.rotation), 'YXZ').y);
