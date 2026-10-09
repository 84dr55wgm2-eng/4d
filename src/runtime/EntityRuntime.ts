import * as THREE from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { Entity, WorldDocument } from '../core/types';

/**
 * Keeps Three.js objects in sync with the WorldDocument's entities.
 * The document is the source of truth; objects are disposable views of it.
 */
export class EntityRuntime {
  readonly group = new THREE.Group();
  readonly objects = new Map<string, THREE.Object3D>();
  private pending = new Set<string>();
  /** entity types rendered by dedicated systems (the actor) */
  external = new Map<string, THREE.Object3D>();
  onLoadError?: (entity: Entity, err: unknown) => void;
  onSpawn?: (obj: THREE.Object3D) => void;

  constructor(private registry: AssetRegistry) {
    this.group.name = 'entities';
  }

  sync(doc: WorldDocument) {
    const live = new Set(doc.entities.map((e) => e.id));
    for (const [id, obj] of this.objects) {
      if (!live.has(id)) {
        obj.removeFromParent();
        this.objects.delete(id);
      }
    }
    for (const e of doc.entities) {
      const ext = this.external.get(e.id);
      if (ext) {
        this.objects.set(e.id, ext);
        ext.userData.entityId = e.id;
        continue;
      }
      const obj = this.objects.get(e.id);
      if (obj) applyTransform(obj, e);
      else if (e.assetId && !this.pending.has(e.id)) this.spawn(e);
    }
  }

  private async spawn(e: Entity) {
    this.pending.add(e.id);
    try {
      const asset = await this.registry.loadGLTF(e.assetId!);
      const obj = this.registry.instantiate(asset);
      obj.name = e.name;
      obj.userData.entityId = e.id;
      obj.traverse((o) => (o.userData.entityId = e.id));
      applyTransform(obj, e);
      this.objects.set(e.id, obj);
      this.group.add(obj);
      this.onSpawn?.(obj);
    } catch (err) {
      console.error('[EntityRuntime] failed to load', e.assetId, err);
      this.onLoadError?.(e, err);
    } finally {
      this.pending.delete(e.id);
    }
  }

  /** resolves once every entity with an asset has an object (or failed) */
  async ready(timeoutMs = 120000) {
    const t0 = performance.now();
    while (this.pending.size && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 50));
  }

  pickables(): THREE.Object3D[] {
    return [...this.objects.values()];
  }
}

export function applyTransform(obj: THREE.Object3D, e: Entity) {
  obj.position.fromArray(e.transform.position);
  obj.quaternion.fromArray(e.transform.rotation);
  obj.scale.fromArray(e.transform.scale);
}

export function readTransform(obj: THREE.Object3D): Entity['transform'] {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    position: obj.position.toArray().map(r) as Entity['transform']['position'],
    rotation: obj.quaternion.toArray().map(r) as Entity['transform']['rotation'],
    scale: obj.scale.toArray().map(r) as Entity['transform']['scale'],
  };
}
