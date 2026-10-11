import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// Adapted from luckeyfaraday/claude-of-duty export/web/collision-world.js:
// offline-baked serialized BVH (tools/prepare/bake_world.mjs) + capsule shapecast resolution.

interface Desc { byteOffset: number; byteLength: number }
interface CollisionMeta {
  format: 'collision-bvh-v1';
  triangles: number;
  byteLength: number;
  bounds: { min: number[]; max: number[] };
  layout: { position: Desc; index: Desc & { type: string }; roots: Desc[] };
}

const _seg = new THREE.Line3();
const _tri = new THREE.Vector3();
const _cap = new THREE.Vector3();
const _n = new THREE.Vector3();
const _box = new THREE.Box3();
const _c0 = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _down = new THREE.Ray();
const _cam = new THREE.Ray();

export class CollisionWorld {
  readonly geometry: THREE.BufferGeometry;
  readonly bvh: MeshBVH;
  readonly debugMesh: THREE.Mesh;

  constructor(meta: CollisionMeta | THREE.BufferGeometry, binary?: ArrayBuffer) {
    let g: THREE.BufferGeometry;
    if (meta instanceof THREE.BufferGeometry) {
      g = meta;
      g.computeBoundingBox();
      g.boundsTree = new MeshBVH(g);
    } else {
      const L = meta.layout;
      const positions = new Float32Array(binary!, L.position.byteOffset, L.position.byteLength / 4);
      const IndexType = L.index.type === 'Uint16Array' ? Uint16Array : Uint32Array;
      const index = new IndexType(binary!, L.index.byteOffset, L.index.byteLength / IndexType.BYTES_PER_ELEMENT);
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(meta.bounds.min), new THREE.Vector3().fromArray(meta.bounds.max));
      g.boundsTree = MeshBVH.deserialize(
        { version: 1, roots: L.roots.map((r) => binary!.slice(r.byteOffset, r.byteOffset + r.byteLength)), index, indirectBuffer: null } as never,
        g, { setIndex: false },
      );
    }
    this.geometry = g;
    this.bvh = g.boundsTree as unknown as MeshBVH;
    this.debugMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff3b30, wireframe: true, transparent: true, opacity: 0.25, depthTest: false }));
    this.debugMesh.raycast = acceleratedRaycast;
    this.debugMesh.visible = false;
    this.debugMesh.matrixAutoUpdate = false;
    this.debugMesh.renderOrder = 50;
  }

  static async load(fetchBytes: (url: string) => Promise<ArrayBuffer>, metaUrl: string) {
    const meta = (await (await fetch(metaUrl)).json()) as CollisionMeta;
    const bin = await fetchBytes(new URL('collision.bin', new URL(metaUrl, location.href)).href);
    return new CollisionWorld(meta, bin);
  }

  /** Push a vertical capsule (start/end centres + radius) out of geometry. Returns the corrected segment centre delta. */
  resolveCapsule(start: THREE.Vector3, end: THREE.Vector3, radius: number, out: THREE.Vector3): boolean {
    _seg.start.copy(start);
    _seg.end.copy(end);
    _c0.addVectors(start, end).multiplyScalar(0.5);
    _box.makeEmpty().expandByPoint(start).expandByPoint(end);
    _box.min.addScalar(-radius);
    _box.max.addScalar(radius);
    let hit = false;
    this.bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(_seg, _tri, _cap);
        if (d >= radius) return false;
        _n.subVectors(_cap, _tri);
        if (_n.lengthSq() < 1e-12) tri.getNormal(_n);
        else _n.multiplyScalar(1 / d);
        // Only resolve horizontally: grounding is handled by the down-ray, so floors/steps never shove the actor.
        _n.y = 0;
        if (_n.lengthSq() < 1e-6) return false;
        _n.normalize();
        const depth = radius - d;
        _seg.start.addScaledVector(_n, depth);
        _seg.end.addScaledVector(_n, depth);
        hit = true;
        return false;
      },
    });
    _c1.addVectors(_seg.start, _seg.end).multiplyScalar(0.5);
    out.subVectors(_c1, _c0);
    return hit;
  }

  /** Highest walkable surface under `p` between p.y+up and p.y-down. */
  groundHeight(p: THREE.Vector3, up = 0.6, down = 3): number | null {
    _down.origin.set(p.x, p.y + up, p.z);
    _down.direction.set(0, -1, 0);
    const hit = this.bvh.raycastFirst(_down, THREE.DoubleSide, 0, up + down);
    return hit ? hit.point.y : null;
  }

  /** First hit distance along a ray (camera occlusion). */
  rayDistance(origin: THREE.Vector3, dir: THREE.Vector3, far: number): number {
    _cam.origin.copy(origin);
    _cam.direction.copy(dir);
    const hit = this.bvh.raycastFirst(_cam, THREE.DoubleSide, 0, far);
    return hit ? hit.distance : far;
  }
}
