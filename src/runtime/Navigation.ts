import * as THREE from 'three';
import { init, importNavMesh, NavMeshQuery, type NavMesh } from '@recast-navigation/core';
import { NavMeshHelper } from '@recast-navigation/three';

/** Offline-baked Recast navmesh (tools/prepare/bake_world.mjs) + path queries for directed movement. */
export class Navigation {
  private constructor(readonly navMesh: NavMesh, readonly query: NavMeshQuery) {}
  private helper?: NavMeshHelper;

  static async load(bytes: ArrayBuffer) {
    await init();
    const { navMesh } = importNavMesh(new Uint8Array(bytes));
    return new Navigation(navMesh, new NavMeshQuery(navMesh));
  }

  closest(p: THREE.Vector3): THREE.Vector3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents: { x: 2, y: 4, z: 2 } });
    return r.success ? new THREE.Vector3(r.point.x, r.point.y, r.point.z) : null;
  }

  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const a = this.closest(from), b = this.closest(to);
    if (!a || !b) return null;
    const r = this.query.computePath(a, b, { halfExtents: { x: 2, y: 4, z: 2 } });
    if (!r.success || !r.path.length) return null;
    return r.path.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  }

  debugObject(): THREE.Object3D {
    if (!this.helper) {
      this.helper = new NavMeshHelper(this.navMesh, {
        navMeshMaterial: new THREE.MeshBasicMaterial({ color: 0x30d158, transparent: true, opacity: 0.35, depthWrite: false }),
      });
      this.helper.position.y += 0.03;
      this.helper.visible = false;
    }
    return this.helper;
  }
}
