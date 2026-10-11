import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AssetRegistry } from '../assets/AssetRegistry';
import { Emitter } from '../core/emitter';
import type { WorldDocument } from '../core/types';
import { idb } from '../storage/idb';
import { WorldStore } from '../world/WorldStore';
import { createOps } from '../ops/operations';
import { Actor, stripRootMotion } from './Actor';
import { CameraDirector, type CameraMode } from './CameraDirector';
import { CollisionWorld } from './CollisionWorld';
import { Engine, type Quality } from './Engine';
import { EntityRuntime, readTransform } from './EntityRuntime';
import { Input, isTyping } from './Input';
import { Navigation } from './Navigation';
import { Thumbnails } from './Thumbnails';
import { InteractionSystem } from './InteractionSystem';
import { createToolRegistry } from '../ops/ToolRegistry';

export type AppMode = 'explore' | 'edit' | 'direct';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface StudioUI {
  phase: 'boot' | 'loading' | 'ready' | 'error';
  loading: { label: string; loaded: number; total: number }[];
  error?: string;
  mode: AppMode;
  cameraMode: CameraMode;
  focalLength: number;
  selection: string | null;
  gizmo: GizmoMode;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
  saveError?: string;
  actorState: string;
  diagnostics: boolean;
  quality: Quality;
  placing: string | null;
  walkTargeting: boolean;
  toast?: { text: string; at: number };
}

type Events = { ui: StudioUI };

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();

export class Studio extends Emitter<Events> {
  readonly engine: Engine;
  readonly registry = new AssetRegistry();
  readonly input = new Input();
  readonly cameras: CameraDirector;
  readonly entities: EntityRuntime;
  readonly interactions = new InteractionSystem(this);
  readonly ops = createOps(this);
  readonly tools = createToolRegistry(this);
  store!: WorldStore;
  actor: Actor | null = null;
  actorEntityId: string | null = null;
  collision: CollisionWorld | null = null;
  nav: Navigation | null = null;
  environment: THREE.Object3D | null = null;
  thumbnails!: Thumbnails;
  readonly gizmo: TransformControls;
  ui: StudioUI = {
    phase: 'boot', loading: [], mode: 'explore', cameraMode: 'follow', focalLength: 35, selection: null, gizmo: 'translate',
    canUndo: false, canRedo: false, saveState: 'saved', actorState: 'idle', diagnostics: false, quality: 'auto', placing: null, walkTargeting: false,
  };
  private saveTimer = 0;
  private actorMarker: THREE.Mesh;

  constructor(readonly canvas: HTMLCanvasElement) {
    super();
    this.engine = new Engine(canvas);
    this.cameras = new CameraDirector(canvas, this.input);
    this.engine.setCamera(this.cameras.camera);
    this.entities = new EntityRuntime(this.registry);
    this.engine.scene.add(this.entities.group);
    this.gizmo = new TransformControls(this.cameras.camera, canvas);
    this.gizmo.setSize(0.85);
    this.engine.scene.add(this.gizmo.getHelper());
    this.actorMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.44, 48),
      new THREE.MeshBasicMaterial({ color: 0x0a84ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.actorMarker.name = '__actor_selection';
    this.actorMarker.rotation.x = -Math.PI / 2;
    this.actorMarker.visible = false;
    this.actorMarker.renderOrder = 20;
    this.engine.scene.add(this.actorMarker);
    this.gizmo.addEventListener('dragging-changed', (e) => this.onGizmoDrag(e.value as boolean));
    this.gizmo.addEventListener('objectChange', () => (this.engine.shadowsDirty = true));
    this.cameras.on('change', ({ mode, focalLength }) => this.set({ cameraMode: mode, focalLength }));
    this.cameras.lookAtProvider = () => (this.actor ? this.actor.headPosition(new THREE.Vector3()) : null);
    addEventListener('resize', () => this.engine.resize());
    this.bindPointer();
    this.bindKeys();
  }

  set(patch: Partial<StudioUI>) {
    this.ui = { ...this.ui, ...patch };
    this.emit('ui', this.ui);
  }

  toast(text: string) {
    this.set({ toast: { text, at: Date.now() } });
  }

  // ---------------------------------------------------------------- boot
  async boot() {
    try {
      this.set({ phase: 'loading' });
      this.registry.setRenderer(this.engine.renderer);
      await this.registry.init();
      const doc = await this.loadWorldDocument();
      this.store = new WorldStore(doc);
      this.store.on('change', ({ source }) => this.onDocChange(source));

      const track = (label: string) => {
        const item = { label, loaded: 0, total: 0 };
        this.set({ loading: [...this.ui.loading, item] });
        return (l: number, t: number) => {
          item.loaded = l;
          item.total = t;
          this.set({ loading: [...this.ui.loading] });
        };
      };

      const env = doc.environment;
      const envRec = this.registry.get(env.assetId);
      const base = import.meta.env.BASE_URL;
      await this.engine.loadEnvironment(`${base}${this.registry.get(env.hdri).url}`, env.sun, env.exposure);
      this.thumbnails = new Thumbnails(this.engine.renderer, this.engine.scene.environment);
      await this.thumbnails.preload(this.registry.manifest.assets.map((a) => a.id));
      this.registry.onLoaded = (a) => {
        if (a.record.entityType && a.record.entityType !== 'ENVIRONMENT' && !this.thumbnails.get(a.record.id))
          this.thumbnails.make(a.record.id, a.template, this.registry.version).then(() => this.set({}), (e) => console.warn('[thumbnail]', a.record.id, e));
      };

      const [world, collision, nav, actor] = await Promise.all([
        this.registry.loadGLTF(env.assetId, track(envRec.name)),
        env.collision ? CollisionWorld.load((u) => this.registry.cache.fetch(u, this.registry.version, track('Collision')), `${base}${env.collision}`) : null,
        // navigation is optional: without it, directed walking reports an error instead of breaking the world
        env.navmesh ? this.registry.cache.fetch(`${base}${env.navmesh}`, this.registry.version).then((b) => Navigation.load(b)).catch((e) => { console.warn('[nav] unavailable', e); return null; }) : null,
        this.loadActor(doc, track),
      ]);
      this.collision = collision;
      this.nav = nav;
      this.cameras.collision = collision;
      this.environment = world.template;
      world.template.traverse((o) => {
        o.matrixAutoUpdate = false;
        o.updateMatrix();
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      world.template.updateMatrixWorld(true);
      this.engine.scene.add(world.template);
      if (collision) this.engine.scene.add(collision.debugMesh);
      if (nav) this.engine.scene.add(nav.debugObject());
      if (actor) {
        this.actor = actor.actor;
        this.actorEntityId = actor.entityId;
        this.actor.collision = collision;
        this.entities.external.set(actor.entityId, actor.actor.root);
        this.engine.scene.add(actor.actor.root);
      }
      this.entities.onLoadError = (e) => this.toast(`Could not load ${e.name}`);
      this.entities.onSpawn = () => (this.engine.shadowsDirty = true);
      this.entities.sync(this.store.doc);
      this.placeActorFromDoc();
      this.resetFollowCamera();
      this.engine.onUpdate((dt) => this.update(dt));
      this.engine.setQuality(this.ui.quality);
      this.engine.start();
      await this.entities.ready();
      this.set({ phase: 'ready', loading: [], canUndo: false, canRedo: false });
    } catch (e) {
      console.error(e);
      this.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async loadWorldDocument(): Promise<WorldDocument> {
    const wanted = new URLSearchParams(location.search).get('world');
    const entry = this.registry.manifest.worlds.find((w) => w.id === wanted) ?? this.registry.manifest.worlds[0];
    if (!entry) throw new Error('content manifest has no worlds');
    const res = await fetch(`${import.meta.env.BASE_URL}${entry.url}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`world HTTP ${res.status}`);
    const pkg = (await res.json()) as WorldDocument;
    const saved = await idb.get<WorldDocument>('worlds', pkg.id).catch(() => undefined);
    // User edits (entities, shots, world state) persist; environment settings always come from the package.
    if (saved && saved.format === pkg.format && saved.version === pkg.version) return { ...saved, environment: pkg.environment, zones: pkg.zones };
    return pkg;
  }

  private async loadActor(doc: WorldDocument, track: (l: string) => (a: number, b: number) => void) {
    const ent = doc.entities.find((e) => e.type === 'ACTOR');
    if (!ent?.assetId) return null;
    const rec = this.registry.get(ent.assetId);
    const clipIds = rec.runtime?.clips as Record<'idle' | 'walk' | 'run', string>;
    const [avatar, idle, walk, run] = await Promise.all([
      this.registry.loadGLTF(ent.assetId, track(rec.name)),
      ...(['idle', 'walk', 'run'] as const).map((k) => this.registry.loadGLTF(clipIds[k], track(`Motion: ${k}`))),
    ]);
    const clip = (a: typeof idle) => a.gltf.animations[0].clone();
    const idleClip = clip(idle);
    stripRootMotion(idleClip);
    const loco = (a: typeof walk) => {
      const c = clip(a);
      const dist = stripRootMotion(c);
      return { clip: c, speed: dist / c.duration };
    };
    const model = this.registry.instantiate(avatar);
    // Adapt before generating: wardrobe tints are asset metadata, not code.
    const tints = (rec.runtime?.materialTints ?? {}) as Record<string, [number, number, number]>;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      const t = tints[mat.name];
      if (t) {
        m.material = mat.clone();
        (m.material as THREE.MeshStandardMaterial).color.setRGB(...t);
      }
    });
    const actor = new Actor(model, { idle: idleClip, walk: loco(walk), run: loco(run) });
    return { actor, entityId: ent.id };
  }

  private placeActorFromDoc() {
    if (!this.actor || !this.actorEntityId) return;
    const e = this.store.entity(this.actorEntityId)!;
    const q = new THREE.Quaternion().fromArray(e.transform.rotation);
    const heading = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    const p = new THREE.Vector3(...e.transform.position);
    // keep the actor on walkable ground even if the document position drifted
    const onNav = this.nav?.closest(p);
    if (onNav && onNav.distanceTo(p) > 0.5) p.copy(onNav);
    this.actor.place(p, heading);
  }

  resetFollowCamera() {
    if (!this.actor) return;
    this.cameras.followYaw = this.actor.heading + Math.PI;
    this.cameras.followPivot.copy(this.actor.position).y += 1.45;
    this.cameras.setPose(
      _v.set(Math.sin(this.cameras.followYaw), 0.35, Math.cos(this.cameras.followYaw)).multiplyScalar(3.4).add(this.cameras.followPivot),
      this.cameras.followPivot,
    );
  }

  // ---------------------------------------------------------------- frame
  private update(dt: number) {
    const a = this.actor;
    if (a) {
      // Product control is pointer/touch directed. Keyboard locomotion is intentionally not used.
      if (this.ui.mode === 'explore' && !a.path.length) a.desiredSpeed = 0;
      const before = a.position.x + a.position.z * 7.31 + a.heading * 3.7;
      a.update(dt);
      // an animated actor always changes its shadow; an idle one only breathes
      if (a.state !== 'idle' || Math.abs(before - (a.position.x + a.position.z * 7.31 + a.heading * 3.7)) > 1e-5) this.engine.shadowsDirty = true;
      if (a.state !== this.ui.actorState) this.set({ actorState: a.state });
      this.cameras.followPivot.lerp(_v.copy(a.position).setY(a.position.y + 1.45), 1 - Math.exp(-dt * 10));
      if (this.actorMarker.visible) this.actorMarker.position.set(a.position.x, a.position.y + 0.025, a.position.z);
      this.engine.shadowFocus.copy(this.ui.cameraMode === 'follow' ? a.position : this.cameras.mode === 'director' ? this.cameras.orbitTarget : a.position);
    }
    this.cameras.update(dt);
  }

  // ---------------------------------------------------------------- modes
  setMode(mode: AppMode) {
    if (mode === this.ui.mode) return;
    this.cancelInteractions();
    if (mode === 'explore') {
      this.select(null);
      this.resetFollowCamera();
      this.cameras.setMode('follow');
    } else if (mode === 'edit') {
      this.cameras.setMode('free');
      if (this.actor) this.actor.desiredSpeed = 0;
    } else {
      this.cameras.setMode('director');
      if (this.actor) this.actor.desiredSpeed = 0;
    }
    this.set({ mode });
  }

  setCameraMode(mode: CameraMode) {
    if (mode === 'follow') {
      this.setMode('explore');
      return;
    }
    if (mode === 'director' && this.ui.mode !== 'direct') this.set({ mode: 'direct' });
    if (mode === 'free' && this.ui.mode === 'explore') this.set({ mode: 'edit' });
    this.cameras.setMode(mode);
  }

  private cancelInteractions() {
    this.set({ placing: null, walkTargeting: false });
  }

  // ---------------------------------------------------------------- selection / editing
  select(id: string | null) {
    if (id && !this.store.entity(id)) return;
    const obj = id ? this.entities.objects.get(id) : null;
    const ent = id ? this.store.entity(id) : null;
    if (obj && ent && !ent.locked && this.ui.mode !== 'explore') this.gizmo.attach(obj);
    else this.gizmo.detach();
    this.gizmo.setMode(this.ui.gizmo);
    this.cameras.freeLookWithLeft = !id;
    this.actorMarker.visible = id === this.actorEntityId;
    if (this.actorMarker.visible && this.actor) this.actorMarker.position.set(this.actor.position.x, this.actor.position.y + 0.025, this.actor.position.z);
    this.set({ selection: id });
  }

  setGizmo(mode: GizmoMode) {
    this.gizmo.setMode(mode);
    this.set({ gizmo: mode });
  }

  private onGizmoDrag(dragging: boolean) {
    this.cameras.setOrbitEnabled(!dragging);
    if (dragging || !this.ui.selection) return;
    const id = this.ui.selection;
    const obj = this.entities.objects.get(id);
    if (!obj) return;
    if (id === this.actorEntityId && this.actor) {
      this.actor.place(obj.position.clone(), new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ').y);
      obj.scale.set(1, 1, 1);
    }
    const t = readTransform(obj);
    this.store.commit(`Transform ${this.store.entity(id)?.name}`, (doc) => {
      const e = doc.entities.find((x) => x.id === id);
      if (!e) return false;
      e.transform = t;
    });
  }

  private onDocChange(source: string) {
    this.entities.sync(this.store.doc);
    this.engine.shadowsDirty = true;
    if (source === 'undo' || source === 'redo' || source === 'load') this.placeActorFromDoc();
    if (this.ui.selection && !this.store.entity(this.ui.selection)) this.select(null);
    else if (this.ui.selection) this.select(this.ui.selection);
    this.set({ canUndo: this.store.canUndo, canRedo: this.store.canRedo, undoLabel: this.store.undoLabel, redoLabel: this.store.redoLabel, saveState: 'unsaved' });
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 700);
  }

  /** Sync runtime-only state (actor position) into the document without an undo step. */
  private syncActorIntoDoc(doc: WorldDocument) {
    if (!this.actor || !this.actorEntityId) return;
    const e = doc.entities.find((x) => x.id === this.actorEntityId);
    if (!e) return;
    e.transform = readTransform(this.actor.root);
  }

  async save(): Promise<boolean> {
    this.set({ saveState: 'saving' });
    try {
      const doc = this.store.snapshot();
      this.syncActorIntoDoc(doc);
      await idb.put('worlds', doc.id, doc);
      const back = await idb.get<WorldDocument>('worlds', doc.id);
      if (!back || back.entities.length !== doc.entities.length) throw new Error('read-back mismatch');
      this.set({ saveState: 'saved', saveError: undefined });
      return true;
    } catch (e) {
      this.set({ saveState: 'error', saveError: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  async resetWorld() {
    await idb.del('worlds', this.store.doc.id);
    location.reload();
  }

  switchWorld(id: string) {
    const entry = this.registry.manifest.worlds.find((w) => w.id === id);
    if (!entry) {
      this.toast(`Unknown world: ${id}`);
      return;
    }
    const u = new URL(location.href);
    u.searchParams.set('world', id);
    location.assign(u.toString());
  }

  // ---------------------------------------------------------------- pointer
  private bindPointer() {
    let down: { x: number; y: number; t: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5 || this.gizmo.dragging) return;
      this.onClick(e.clientX, e.clientY);
    });
  }

  private pick(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.cameras.camera);
    const hits = _ray.intersectObjects(this.entities.pickables(), true);
    const ent = hits.find((h) => h.object.userData.entityId)?.object.userData.entityId as string | undefined;
    let ground: THREE.Vector3 | null = null;
    if (this.collision) {
      const hit = this.collision.bvh.raycastFirst(_ray.ray, THREE.DoubleSide, 0, 400);
      if (hit) ground = hit.point.clone();
    }
    const entDist = hits[0]?.distance ?? Infinity;
    return { entity: ent ?? null, entityDistance: entDist, ground, groundDistance: ground ? ground.distanceTo(_ray.ray.origin) : Infinity };
  }

  private onClick(x: number, y: number) {
    if (this.ui.phase !== 'ready') return;
    const p = this.pick(x, y);
    if (this.ui.placing && p.ground) {
      const id = this.ui.placing;
      this.set({ placing: null });
      this.ops.placeAsset(id, p.ground.toArray() as [number, number, number]);
      return;
    }
    if (this.ui.walkTargeting && p.ground) {
      this.set({ walkTargeting: false });
      this.ops.moveActorTo(p.ground.toArray() as [number, number, number]);
      return;
    }
    if (this.ui.mode === 'explore') {
      // Touch/click the actor once to direct him. Subsequent taps choose destinations or objects.
      if (p.entity === this.actorEntityId) {
        this.select(this.actorEntityId);
        this.toast('Actor selected · tap the ground or an object');
        return;
      }
      if (this.ui.selection === this.actorEntityId) {
        if (p.entity && p.entity !== this.actorEntityId && p.entityDistance <= p.groundDistance + 0.05) {
          this.interactions.execute(p.entity).then((r) => {
            if (!r.ok) this.toast(r.error);
            else this.toast(r.action === 'approach' ? 'Reached object' : `Interaction: ${r.action}`);
          });
          return;
        }
        if (p.ground) {
          this.ops.moveActorTo(p.ground.toArray() as [number, number, number]).then((r) => {
            if (!r.ok) this.toast(r.error);
          });
        }
      }
      return;
    }
    if (p.entity && p.entityDistance <= p.groundDistance + 0.05) this.select(p.entity);
    else this.select(null);
  }

  private bindKeys() {
    addEventListener('keydown', (e) => {
      if (isTyping(e) || this.ui.phase !== 'ready') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.store.redo() : this.store.undo(); return; }
      if (mod && e.code === 'KeyY') { e.preventDefault(); this.store.redo(); return; }
      if (mod && e.code === 'KeyS') { e.preventDefault(); this.save(); return; }
      if (mod && e.code === 'KeyD' && this.ui.selection) { e.preventDefault(); this.ops.duplicateEntity(this.ui.selection); return; }
      if (e.code === 'Escape') { this.cancelInteractions(); this.select(null); return; }
      if (e.code === 'Backquote') { this.set({ diagnostics: !this.ui.diagnostics }); return; }
      if (e.code === 'Digit1' && !mod) this.setMode('explore');
      if (e.code === 'Digit2' && !mod) this.setMode('edit');
      if (e.code === 'Digit3' && !mod) this.setMode('direct');
      if (this.ui.mode !== 'explore' && this.ui.selection && this.cameras.mode !== 'free') {
        if (e.code === 'KeyG' || e.code === 'KeyW') this.setGizmo('translate');
        if (e.code === 'KeyR') this.setGizmo('rotate');
        if (e.code === 'KeyS') this.setGizmo('scale');
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.ui.selection) this.ops.deleteEntity(this.ui.selection);
    });
  }

  // Operations + tool registry are initialized near the other runtime systems.
}
