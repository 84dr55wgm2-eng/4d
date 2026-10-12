import * as THREE from 'three';
import { closedDoorBoxes } from '../world/district/DistrictOps';
import { uid } from '../core/emitter';
import type { AssetCategory, CameraShot, Capability, Entity, Vec3, WorldState } from '../core/types';
import type { CameraMode } from '../runtime/CameraDirector';
import type { Studio } from '../runtime/Studio';

/**
 * Deterministic world operations. This is the future AI tool layer: an LLM will translate
 * language into these calls, so every op validates input and returns a structured result
 * instead of pretending to succeed.
 */
export type OpResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): OpResult<T> => ({ ok: true, value });
const fail = (error: string): OpResult<never> => ({ ok: false, error });

export function createOps(studio: Studio) {
  const store = () => studio.store;
  const entity = (id: string) => store().entity(id);
  const editable = (id: string): Entity | string => {
    const e = entity(id);
    if (!e) return `no entity ${id}`;
    if (e.locked) return `${e.name} is locked`;
    return e;
  };

  const ops = {
    getState() {
      const d = store().doc;
      return {
        world: d.name,
        mode: studio.ui.mode,
        camera: { mode: studio.cameras.mode, ...studio.cameras.currentShot() },
        selection: studio.ui.selection,
        actor: studio.actor ? { position: studio.actor.position.toArray(), heading: studio.actor.heading, state: studio.actor.state } : null,
        entities: d.entities.map((e) => ({ id: e.id, type: e.type, name: e.name, position: e.transform.position, locked: !!e.locked })),
        shots: d.shots.map((s) => ({ id: s.id, name: s.name })),
        zones: d.zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind })),
        worldState: d.worldState,
      };
    },

    selectEntity(id: string | null): OpResult<string | null> {
      if (id && !entity(id)) return fail(`no entity ${id}`);
      studio.select(id);
      return ok(id);
    },

    moveEntity(id: string, position: Vec3, opts: { relative?: boolean; snapToGround?: boolean } = {}): OpResult<Vec3> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      const p = new THREE.Vector3(...position);
      if (opts.relative) p.add(new THREE.Vector3(...e.transform.position));
      if (opts.snapToGround !== false && studio.collision) {
        const g = studio.collision.groundHeight(p, 1.5, 6);
        if (g !== null) p.y = g;
      }
      if (id === studio.actorEntityId && studio.actor) studio.actor.place(p);
      const out = p.toArray() as Vec3;
      if (!store().commit(`Move ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.transform.position = out; })) return fail('Déplacement invalide');
      return ok(out);
    },

    rotateEntity(id: string, yawDegrees: number, opts: { relative?: boolean } = {}): OpResult<number> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      const cur = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...e.transform.rotation), 'YXZ').y;
      const yaw = (opts.relative ? cur : 0) + THREE.MathUtils.degToRad(yawDegrees);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      if (id === studio.actorEntityId && studio.actor) studio.actor.place(studio.actor.position.clone(), yaw);
      if (!store().commit(`Rotate ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.transform.rotation = q.toArray() as Entity['transform']['rotation']; })) return fail('Rotation invalide');
      return ok(THREE.MathUtils.radToDeg(yaw));
    },

    scaleEntity(id: string, scale: number): OpResult<number> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      if (!e.capabilities.includes('scalable')) return fail(`${e.name} is not scalable`);
      if (!(scale > 0.05 && scale < 20)) return fail('scale out of range (0.05..20)');
      if (!store().commit(`Scale ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.transform.scale = [scale, scale, scale]; })) return fail('Échelle invalide');
      return ok(scale);
    },

    duplicateEntity(id: string): OpResult<string> {
      const e = entity(id);
      if (!e) return fail(`no entity ${id}`);
      if (e.type === 'ACTOR') return fail('the hero actor cannot be duplicated in V1');
      const copy: Entity = structuredClone(e);
      copy.id = uid(e.type.toLowerCase());
      copy.name = `${e.name} copy`;
      copy.locked = false;
      copy.transform.position = [e.transform.position[0] + 0.8, e.transform.position[1], e.transform.position[2] + 0.8];
      if (!store().commit(`Duplicate ${e.name}`, (d) => { d.entities.push(copy); })) return fail('Position de la copie invalide');
      studio.select(copy.id);
      return ok(copy.id);
    },

    deleteEntity(id: string): OpResult<string> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      if (e.type === 'ACTOR') return fail('the hero actor cannot be deleted');
      store().commit(`Delete ${e.name}`, (d) => { d.entities = d.entities.filter((x) => x.id !== id); });
      return ok(id);
    },

    lockEntity(id: string, locked: boolean): OpResult<boolean> {
      const e = entity(id);
      if (!e) return fail(`no entity ${id}`);
      store().commit(`${locked ? 'Lock' : 'Unlock'} ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.locked = locked; });
      return ok(locked);
    },

    findAssets(query = '', category?: AssetCategory) {
      return studio.registry.find(query, category).map((a) => ({ id: a.id, name: a.name, category: a.category, source: a.source, cache: studio.registry.status(a.id) }));
    },

    placeAsset(assetId: string, position: Vec3, yawDegrees = 0): OpResult<string> {
      let rec;
      try { rec = studio.registry.get(assetId); } catch { return fail(`unknown asset ${assetId}`); }
      if (!rec.entityType || rec.category === 'ANIMATIONS' || rec.category === 'ENVIRONMENT' || rec.category === 'CHARACTERS') return fail(`${rec.name} is not placeable`);
      const p = new THREE.Vector3(...position);
      if (studio.collision) {
        const g = studio.collision.groundHeight(p, 1.5, 6);
        if (g !== null) p.y = g;
      }
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDegrees));
      const caps: Capability[] = ['selectable', 'movable', 'rotatable', 'scalable', 'collidable'];
      if (rec.entityType === 'LIGHT') caps.push('interactable', 'toggleable');
      if (rec.entityType === 'DOOR') caps.push('interactable', 'openable');
      if (rec.entityType === 'CHAIR' && rec.runtime?.interaction) caps.push('interactable', 'sittable');
      if ((rec.runtime?.interaction as { pickable?: boolean } | undefined)?.pickable) caps.push('interactable', 'pickable');
      const interaction = rec.runtime?.interaction ? structuredClone(rec.runtime.interaction) : undefined;
      const e: Entity = {
        id: uid(rec.entityType.toLowerCase()), type: rec.entityType, name: rec.name, assetId,
        transform: { position: p.toArray() as Vec3, rotation: q.toArray() as Entity['transform']['rotation'], scale: [1, 1, 1] },
        parentId: null, tags: [...rec.tags], capabilities: caps,
        metadata: interaction ? { interaction } : undefined,
      };
      if (!store().commit(`Place ${rec.name}`, (d) => { d.entities.push(e); })) return fail('Emplacement invalide');
      studio.select(e.id);
      return ok(e.id);
    },

    /** Navmesh-planned walk/run. Resolves when the actor arrives (or fails honestly). */
    moveActorTo(target: Vec3, opts: { run?: boolean } = {}): Promise<OpResult<Vec3>> {
      const a = studio.actor;
      if (!a) return Promise.resolve(fail('no actor'));
      if (!studio.nav) return Promise.resolve(fail('no navigation mesh loaded'));
      if (a.seated) return Promise.resolve(fail('Lève-toi avant de marcher'));
      if (!target.every(Number.isFinite)) return Promise.resolve(fail('invalid destination'));
      const path = studio.nav.path(a.position, new THREE.Vector3(...target));
      if (!path) return Promise.resolve(fail('no walkable path to target'));
      // a closed door is a real obstacle: refuse paths that would cross it (open it first)
      const doors = closedDoorBoxes(studio.store.doc);
      for (let i = 1; i < path.length && doors.length; i++) {
        const seg = new THREE.Ray(path[i - 1].clone().setY(path[i - 1].y + 1), path[i].clone().sub(path[i - 1]).setY(0).normalize());
        const len = path[i].clone().sub(path[i - 1]).setY(0).length();
        for (const d of doors) {
          const hit = seg.intersectBox(d.box.clone().expandByScalar(0.05), new THREE.Vector3());
          if (hit && hit.distanceTo(seg.origin) <= len) return Promise.resolve(fail(`${studio.store.entity(d.id)?.name ?? 'La porte'} est fermée — ouvre-la d’abord`));
        }
      }
      a.cancelPath();
      const points = path.filter((p, i) => i > 0 || p.distanceTo(a.position) > 0.15);
      if (!points.length) return Promise.resolve(ok(a.position.toArray() as Vec3));
      return new Promise((resolve) => {
        let elapsed = 0, stalled = 0;
        let last = a.position.clone();
        const off = studio.engine.onUpdate((dt) => {
          elapsed += dt;
          stalled = a.position.distanceTo(last) < 0.001 ? stalled + dt : 0;
          last.copy(a.position);
          if (elapsed > 120 || stalled > 8) a.cancelPath();
        });
        a.setPath(points, opts.run ? a.runSpeed : a.walkSpeed, () => { off(); resolve(ok(a.position.toArray() as Vec3)); });
        a.onCancel = () => { off(); resolve(fail('Movement interrupted or destination blocked')); };
      });
    },

    getInteractions(id: string) {
      return studio.interactions.actionsFor(id);
    },

    interact(id: string, action?: string) {
      return studio.interactions.execute(id, action);
    },

    stopActor(): OpResult<undefined> {
      if (!studio.actor) return fail('no actor');
      studio.actor.cancelPath();
      return ok(undefined);
    },

    turnActorTo(target: Vec3 | number): OpResult<number> {
      const a = studio.actor;
      if (!a) return fail('no actor');
      const heading = typeof target === 'number' ? THREE.MathUtils.degToRad(target) : Math.atan2(target[0] - a.position.x, target[2] - a.position.z);
      a.cancelPath();
      a.targetHeading = heading;
      return ok(THREE.MathUtils.radToDeg(heading));
    },

    setCamera(opts: { mode?: CameraMode; position?: Vec3; target?: Vec3; focalLength?: number; lookAtActor?: boolean }): OpResult<undefined> {
      if (opts.mode) studio.setCameraMode(opts.mode);
      if (opts.position || opts.target) {
        if (studio.cameras.mode === 'follow') studio.setCameraMode('director');
        const pos = opts.position ? new THREE.Vector3(...opts.position) : studio.cameras.camera.position.clone();
        const tgt = opts.target ? new THREE.Vector3(...opts.target) : studio.cameras.orbitTarget.clone();
        studio.cameras.setPose(pos, tgt);
      }
      if (opts.lookAtActor && studio.actor) studio.cameras.lookAt(studio.actor.headPosition());
      if (opts.focalLength) {
        if (!(opts.focalLength >= 10 && opts.focalLength <= 200)) return fail('focal length out of range (10..200mm)');
        studio.cameras.setLens(opts.focalLength);
      }
      return ok(undefined);
    },

    saveShot(name?: string): OpResult<string> {
      const shots = store().doc.shots;
      const label = name?.trim() || `SHOT_${String.fromCharCode(65 + (shots.length % 26))}${shots.length >= 26 ? Math.floor(shots.length / 26) : ''}`;
      const shot: CameraShot = { id: uid('shot'), name: label, ...studio.cameras.currentShot() };
      store().commit(`Save ${label}`, (d) => { d.shots.push(shot); });
      studio.toast(`Saved ${label}`);
      return ok(shot.id);
    },

    recallShot(idOrName: string, duration = 0.9): OpResult<string> {
      const s = store().doc.shots.find((x) => x.id === idOrName || x.name === idOrName);
      if (!s) return fail(`no shot ${idOrName}`);
      if (studio.ui.mode !== 'direct') studio.set({ mode: 'direct' });
      studio.cameras.goTo(s, duration);
      return ok(s.id);
    },

    deleteShot(id: string): OpResult<string> {
      const s = store().doc.shots.find((x) => x.id === id);
      if (!s) return fail(`no shot ${id}`);
      store().commit(`Delete ${s.name}`, (d) => { d.shots = d.shots.filter((x) => x.id !== id); });
      return ok(id);
    },

    setWorldState(patch: Partial<WorldState>): OpResult<WorldState> {
      store().commit('World state', (d) => { Object.assign(d.worldState, patch); });
      return ok(store().doc.worldState);
    },

    undo() { store().undo(); return ok(store().canUndo); },
    redo() { store().redo(); return ok(store().canRedo); },
    save() { return studio.save(); },
  };
  return ops;
}

export type StudioOps = ReturnType<typeof createOps>;
