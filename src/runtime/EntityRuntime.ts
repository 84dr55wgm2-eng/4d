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
  private doc!: WorldDocument;
  /** entity types rendered by dedicated systems (the actor) */
  external = new Map<string, THREE.Object3D>();
  onLoadError?: (entity: Entity, err: unknown) => void;
  onSpawn?: (obj: THREE.Object3D) => void;
  /** procedural entity kinds (district doors, light banks) — data in entity.metadata.procedural */
  factories = new Map<string, (e: Entity) => THREE.Object3D>();

  /**
   * Sector streaming: entities (and therefore their asset bytes) are only fetched/instantiated within
   * `radius` of the focus points; objects beyond radius × 1.5 are released. Doors, lights, the actor and
   * anything flagged `metadata.resident` stay loaded. radius = Infinity disables streaming.
   */
  radius = Infinity;
  focus: THREE.Vector3[] = [];
  stats = { resident: 0, total: 0, deferred: 0 };

  /** ids that must stay instantiated whatever the distance (interaction target, held object, sequence targets) */
  protect: () => Iterable<string> = () => [];
  /** entity id → asset id it holds a reference on (AssetRegistry retain/release) */
  private retained = new Map<string, string>();

  private inRange(e: Entity, scale = 1) {
    if (!Number.isFinite(this.radius) || !this.focus.length || e.type === 'ACTOR' || e.type === 'DOOR' || e.type === 'LIGHT' || e.metadata?.resident || e.metadata?.surface) return true;
    for (const id of this.protect()) if (id === e.id) return true;
    const p = e.transform.position;
    return this.focus.some((f) => Math.hypot(f.x - p[0], f.z - p[2]) <= this.radius * scale);
  }

  /** re-evaluate streaming against the current focus (cheap; called a few times per second) */
  stream() {
    if (!Number.isFinite(this.radius) || !this.doc) return false;
    let changed = false;
    for (const e of this.doc.entities) {
      const obj = this.objects.get(e.id);
      if (!obj && this.inRange(e) && !this.pending.has(e.id) && (e.assetId || e.metadata?.procedural)) { this.spawn(e); changed = true; }
      else if (obj && !this.external.has(e.id) && !this.inRange(e, 1.5)) { this.remove(e.id, obj); changed = true; this.onRelease?.(e.id); }
    }
    this.count();
    return changed;
  }

  onRelease?: (id: string) => void;

  private remove(id: string, obj: THREE.Object3D) {
    obj.removeFromParent();
    this.objects.delete(id);
    const asset = this.retained.get(id);
    if (asset) { this.retained.delete(id); this.registry.release(asset); }
  }

  private count() {
    const d = this.doc;
    if (!d) return;
    this.stats.total = d.entities.length;
    this.stats.resident = d.entities.filter((e) => this.objects.has(e.id)).length;
    this.stats.deferred = this.stats.total - this.stats.resident - this.pending.size;
  }

  constructor(private registry: AssetRegistry) {
    this.group.name = 'entities';
  }

  sync(doc: WorldDocument) {
    this.doc = doc;
    const live = new Set(doc.entities.map((e) => e.id));
    for (const [id, obj] of this.objects) {
      if (!live.has(id)) this.remove(id, obj);
    }
    for (const e of doc.entities) {
      const ext = this.external.get(e.id);
      if (ext) {
        this.objects.set(e.id, ext);
        ext.traverse((o) => (o.userData.entityId = e.id));
        continue;
      }
      const obj = this.objects.get(e.id);
      if (obj) {
        applyTransform(obj, e);
        applySemanticState(obj, e);
      } else if ((e.assetId || e.metadata?.surface || e.metadata?.procedural) && !this.pending.has(e.id) && this.inRange(e)) this.spawn(e);
    }
    this.count();
  }

  private async spawn(e: Entity) {
    this.pending.add(e.id);
    try {
      let obj: THREE.Object3D;
      const proc = e.metadata?.procedural as { kind: string } | undefined;
      if (proc) {
        const make = this.factories.get(proc.kind);
        if (!make) throw new Error(`Procedural kind ${proc.kind} unavailable`);
        obj = make(e);
      } else if (e.metadata?.surface) {
        const cfg = e.metadata.surface as { width: number; depth: number; material: string };
        const source = await this.registry.loadGLTF('env.bistro');
        let material: THREE.Material | undefined;
        source.template.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.name.includes(cfg.material)) material = mat;
        });
        if (!material) throw new Error('Authored pavement material missing');
        const g = new THREE.PlaneGeometry(cfg.width, cfg.depth);
        g.rotateX(-Math.PI / 2);
        const uv = g.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * cfg.width / 2, uv.getY(i) * cfg.depth / 2);
        obj = new THREE.Mesh(g, material.clone());
        (obj as THREE.Mesh).receiveShadow = true;
      } else {
        const asset = await this.registry.loadGLTF(e.assetId!);
        obj = this.registry.instantiate(asset);
        this.registry.retain(e.assetId!);
        this.retained.set(e.id, e.assetId!);
      }
      // An async asset load must not resurrect an entity deleted while it was downloading.
      const current = this.doc.entities.find((x) => x.id === e.id);
      if (!current || !this.inRange(current, 1.5)) { const a = this.retained.get(e.id); if (a) { this.retained.delete(e.id); this.registry.release(a); } return; }
      e = current;
      obj.name = e.name;
      obj.userData.entityId = e.id;
      obj.traverse((o) => (o.userData.entityId = e.id));
      applyTransform(obj, e);
      applySemanticState(obj, e);
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


function applySemanticState(obj: THREE.Object3D, e: Entity) {
  if (e.type !== 'LIGHT') return;
  const cfg = (e.metadata?.interaction ?? {}) as { enabled?: boolean; color?: string; intensity?: number; distance?: number };
  const enabled = cfg.enabled !== false;
  // A ceiling bank (light_bank) sits at ceiling height: its light must hang below the ceiling plane so the ceiling
  // and walls receive it, and a dim fill near the floor stands for the light the floor bounces back up. Both follow
  // the switch, so a room with its lights off really goes dark.
  const bank = (e.metadata?.procedural as { kind?: string } | undefined)?.kind === 'light_bank';
  const ceilingH = (e.metadata?.procedural as { ceilingHeight?: number } | undefined)?.ceilingHeight ?? 3.1;
  let light = obj.getObjectByName('__cws_semantic_light') as THREE.PointLight | undefined;
  if (!light) {
    light = new THREE.PointLight(cfg.color ?? '#ffd7a3', cfg.intensity ?? 28, cfg.distance ?? 7, 2);
    light.name = '__cws_semantic_light';
    light.position.set(0, bank ? -0.6 : 0.45, 0);
    obj.add(light);
    if (bank) {
      const fill = new THREE.PointLight(cfg.color ?? '#ffd7a3', 1, cfg.distance ?? 7, 2);
      fill.name = '__cws_semantic_fill';
      fill.position.set(0, -ceilingH * 0.55, 0); // mid-height: no specular hotspot on the floor
      obj.add(fill);
    }
  }
  // switching keeps the light in the scene and only zeroes its intensity: the number of lights is part of every
  // shader's program key, so hiding it would recompile all materials (a visible hitch on each toggle)
  light.visible = true;
  light.intensity = enabled ? cfg.intensity ?? 28 : 0;
  light.distance = cfg.distance ?? 7;
  if (cfg.color) light.color.set(cfg.color);
  const fill = obj.getObjectByName('__cws_semantic_fill') as THREE.PointLight | undefined;
  if (fill) {
    fill.visible = true;
    fill.intensity = (cfg.intensity ?? 28) * 0.22 * (enabled ? 1 : 0);
    fill.distance = light.distance;
    fill.color.copy(light.color).lerp(new THREE.Color('#d8c6a8'), 0.4); // floor-tinted bounce
  }
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial;
      if (!m?.isMeshStandardMaterial) continue;
      if (m.userData.__cwsBaseEmissiveIntensity === undefined) m.userData.__cwsBaseEmissiveIntensity = m.emissiveIntensity;
      if (m.emissive && m.emissive.getHex() !== 0) m.emissiveIntensity = enabled ? Math.max(m.userData.__cwsBaseEmissiveIntensity || 1, 1) : 0;
    }
  });
}
