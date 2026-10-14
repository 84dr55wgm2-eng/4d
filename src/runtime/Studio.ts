import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AssetRegistry } from '../assets/AssetRegistry';
import { Emitter } from '../core/emitter';
import type { Entity, WorldDocument } from '../core/types';
import { idb } from '../storage/idb';
import { WorldStore } from '../world/WorldStore';
import { createOps } from '../ops/operations';
import { Actor, stripRootMotion } from './Actor';
import { CameraDirector, type CameraMode, type FollowContext } from './CameraDirector';
import { CollisionWorld } from './CollisionWorld';
import { Engine, type Quality } from './Engine';
import { EntityRuntime, readTransform } from './EntityRuntime';
import { Input, isTyping } from './Input';
import { Navigation } from './Navigation';
import { Thumbnails } from './Thumbnails';
import { InteractionSystem } from './InteractionSystem';
import { composeWorld, refreshSpatialData, type WorldPlan } from '../world/WorldCreator';
import { worldGeometry } from '../world/WorldGeometry';
import { importedDocument, sceneGeometry, sceneSpawn } from '../world/SceneWorld';
import { createToolRegistry } from '../ops/ToolRegistry';
import { cableObject, DistrictRuntime, doorObject, lightBankObject } from '../world/district/DistrictRuntime';
import { closedDoorBoxes, setTimeOfDay } from '../world/district/DistrictOps';
import { composeYabaWorld } from '../world/district/YabaWorld';
import { ShopDresser } from '../world/district/ShopDresser';
import { StudioAgent } from '../agent/Agent';
import { Simulation, type SimSnapshot } from '../sim/Simulation';
import { ConversionService } from '../content/ConversionService';
import { StudioAssembly, characterClips } from '../assembly/StudioAssembly';
import { INTERIOR_ENV } from '../world/district/Materials';
import type { DistrictBriefPlan } from '../world/district/Commands';
import { SequencePlayer } from './SequencePlayer';

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
  interactionTarget?: string | null;
  sequencePanel?: boolean;
  /** place studio panel (sources, catalogue, assembly, agent); undefined = open on assembled places */
  placePanel?: boolean;
  toast?: { text: string; at: number };
}

type Events = { ui: StudioUI };

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();
const _fv = new THREE.Vector3();

export class Studio extends Emitter<Events> {
  readonly engine: Engine;
  readonly registry = new AssetRegistry();
  readonly input = new Input();
  readonly cameras: CameraDirector;
  readonly entities: EntityRuntime;
  readonly interactions = new InteractionSystem(this);
  readonly ops = createOps(this);
  readonly tools = createToolRegistry(this);
  readonly agent = new StudioAgent(this);
  sim!: Simulation;
  readonly conversion = new ConversionService();
  store!: WorldStore;
  actor: Actor | null = null;
  actorEntityId: string | null = null;
  collision: CollisionWorld | null = null;
  nav: Navigation | null = null;
  environment: THREE.Object3D | null = null;
  thumbnails!: Thumbnails;
  district: DistrictRuntime | null = null;
  dresser: ShopDresser | null = null;
  /** imported packages, catalogue and assembled worlds */
  assembly!: StudioAssembly;
  private pendingNotice = '';
  /** recent selections (chair, then computer…) for commands like « déplace cette chaise devant cet ordinateur » */
  selectionHistory: string[] = [];
  sequences!: SequencePlayer;
  private districtSignature = '';
  private appliedSun = '';
  readonly gizmo: TransformControls;
  ui: StudioUI = {
    phase: 'boot', loading: [], mode: 'explore', cameraMode: 'follow', focalLength: 35, selection: null, gizmo: 'translate',
    canUndo: false, canRedo: false, saveState: 'saved', actorState: 'idle', diagnostics: false, quality: 'auto', placing: null, walkTargeting: false,
  };
  private saveTimer = 0;
  worlds: { id: string; name: string }[] = [];
  private geometryTimer = 0;
  private geometryGeneration = 0;
  private geometrySignature = '';
  private actorMarker: THREE.Mesh;

  constructor(readonly canvas: HTMLCanvasElement) {
    super();
    this.engine = new Engine(canvas);
    this.cameras = new CameraDirector(canvas);
    this.cameras.followContext = () => (this.actor ? this.followContext() : { destination: null, velocity: _fv.set(0, 0, 0), room: null });
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
      const stage = (label: string) => this.set({ loading: [{ label, loaded: 0, total: 0 }] });
      this.set({ phase: 'loading' });
      this.registry.setRenderer(this.engine.renderer);
      performance.mark('boot:start');
      await this.registry.init(stage);
      performance.mark('boot:manifest');
      this.assembly = new StudioAssembly(this);
      this.sim = new Simulation(this.registry, this.assembly.runtime);
      this.engine.scene.add(this.sim.root);
      stage('Paquets et projets enregistrés');
      await this.assembly.loadInstalled();
      const localWorlds = await idb.all<WorldDocument>('worlds');
      this.worlds = [...this.registry.manifest.worlds.map(({id, name}) => ({id, name})), ...localWorlds.filter((d) => (d.composition || d.imported || d.district || d.assembly) && !this.registry.manifest.worlds.some((w) => w.id === d.id)).map(({id, name}) => ({id, name}))];
      stage('Description du monde');
      const doc = await this.loadWorldDocument();
      for (const e of doc.entities) {
        const rec = e.assetId ? this.registry.manifest.assets.find((a) => a.id === e.assetId) : undefined;
        const defaults = rec?.runtime?.interaction as Record<string, unknown> | undefined;
        if (!defaults) continue;
        const metadata = (e.metadata ??= {});
        metadata.interaction = { ...structuredClone(defaults), ...(metadata.interaction as Record<string, unknown> ?? {}) };
        const add = (...caps: typeof e.capabilities) => { e.capabilities = [...new Set([...e.capabilities, ...caps])]; };
        if (e.type === 'LIGHT') add('interactable', 'toggleable');
        if (e.type === 'CHAIR' && defaults.seat) add('interactable', 'sittable');
        if (defaults.pickable) add('interactable', 'pickable');
      }
      this.store = new WorldStore(doc);
      this.store.prepare = (d) => { if (d.composition) { worldGeometry(d, this.registry.manifest.assets).dispose(); refreshSpatialData(d, this.registry.manifest.assets); } };
      this.store.onReject = (message) => this.toast(message);
      this.geometrySignature = JSON.stringify(doc.entities.filter((e) => e.type === 'BUILDING' || e.type === 'ROAD').map((e) => [e.id, e.transform]));
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
      const envRec = env.assetId ? this.registry.get(env.assetId) : null;
      const composedGeometry = doc.composition ? worldGeometry(doc, this.registry.manifest.assets) : null;
      const base = import.meta.env.BASE_URL;
      stage('Éclairage du monde');
      await this.engine.loadEnvironment(`${base}${this.registry.get(env.hdri).url}`, env.sun, env.exposure);
      this.thumbnails = new Thumbnails(this.engine.renderer, this.engine.scene.environment);
      // Library previews are optional; loading every cached thumbnail must not delay the world.
      void this.thumbnails.preload(this.registry.manifest.assets.map((a) => a.id)).then(() => this.set({}), (e) => console.warn('[thumbnails]', e));
      this.registry.onLoaded = (a) => {
        if (a.record.entityType && a.record.entityType !== 'ENVIRONMENT' && !this.thumbnails.get(a.record.id))
          this.thumbnails.make(a.record.id, a.template, this.registry.version).then(() => this.set({}), (e) => console.warn('[thumbnail]', a.record.id, e));
      };

      if (doc.district) {
        this.district = new DistrictRuntime(base, this.engine.renderer.capabilities.getMaxAnisotropy());
        this.district.sync(doc);
        performance.mark('boot:district-built');
        this.engine.scene.add(this.district.group);
        const fixture = await this.registry.loadGLTF('lagos.fluorescent').then((a) => a.template, () => null);
        const mats = this.district.mats;
        // sector streaming: a district only instantiates what is near the actor / camera
        this.entities.radius = 34;
        this.entities.focus = [new THREE.Vector3(...(doc.entities.find((e) => e.type === 'ACTOR')?.transform.position ?? doc.spawn.position))];
        this.entities.factories.set('door', (e) => doorObject(e, mats));
        this.entities.factories.set('light_bank', (e) => lightBankObject(e, fixture, mats));
        this.entities.factories.set('cable', (e) => cableObject(e, mats));
        // shop recesses are stocked with authored shelving and goods near the camera only
        this.dresser = new ShopDresser(this.registry);
        this.dresser.prepare = (o) => this.engine.renderer.compileAsync(o, this.cameras.camera, this.engine.scene);
        this.engine.scene.add(this.dresser.group);
      }
      if (doc.assembly) {
        this.entities.factories.set('set', (e) => this.assembly.runtime.build(e));
      }
      if (doc.entities.some((e) => e.metadata?.sim)) {
        // population entities are placeholders in the document; the simulation owns their animated bodies
        this.entities.factories.set('sim', (e) => { const g = new THREE.Group(); g.name = e.name; return g; });
      }
      this.appliedSun = JSON.stringify([env.sun, env.exposure]);
      stage('Décor, personnage et navigation');
      const [world, bakedCollision, bakedNav, actor] = await Promise.all([
        env.assetId ? this.registry.loadGLTF(env.assetId, track(envRec!.name)) : null,
        this.district ? Promise.resolve(new CollisionWorld(this.district.build.collide.clone())) :
        composedGeometry ? Promise.resolve(new CollisionWorld(composedGeometry)) : env.collision ? CollisionWorld.load((u) => this.registry.cache.fetch(u, this.registry.version, track('Collision')), `${base}${env.collision}`) : null,
        // navigation is optional: without it, directed walking reports an error instead of breaking the world
        composedGeometry ? Navigation.build(worldGeometry(doc, this.registry.manifest.assets, true)) : env.navmesh ? this.registry.cache.fetch(`${base}${env.navmesh}`, this.registry.version).then((b) => Navigation.load(b)).catch((e) => { console.warn('[nav] unavailable', e); return null; }) : null,
        this.loadActor(doc, track),
      ]);
      let collision = bakedCollision, nav = bakedNav;
      if (doc.imported && world) {
        this.set({ loading: [...this.ui.loading, { label: 'Géométrie et navigation du monde importé', loaded: 0, total: 0 }] });
        const cached = doc.imported.dataKey ? await idb.get<{ positions: Float32Array; indices: Uint32Array; nav: Uint8Array }>('settings', doc.imported.dataKey) : undefined;
        const geometry = cached ? new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(cached.positions, 3)).setIndex(new THREE.BufferAttribute(cached.indices, 1)) : await sceneGeometry(world.template);
        nav = cached ? await Navigation.load(cached.nav.buffer as ArrayBuffer) : await Navigation.build(geometry);
        collision = new CollisionWorld(geometry);
      }
      this.collision = collision;
      this.nav = nav;
      this.cameras.collision = collision;
      this.environment = world?.template ?? null;
      world?.template.traverse((o) => {
        o.matrixAutoUpdate = false;
        o.updateMatrix();
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      if (world) { world.template.updateMatrixWorld(true); this.engine.scene.add(world.template); }
      if (collision) this.engine.scene.add(collision.debugMesh);
      if (nav) this.engine.scene.add(nav.debugObject());
      if (actor) {
        this.actor = actor.actor;
        this.actorEntityId = actor.entityId;
        this.actor.collision = collision;
        this.actor.blockers = () => closedDoorBoxes(this.store.doc).map((d) => d.box);
        this.entities.external.set(actor.entityId, actor.actor.root);
        this.engine.scene.add(actor.actor.root);
      }
      this.entities.onLoadError = (e) => this.toast(`Could not load ${e.name}`);
      // Navigation obstacles come from footprints, so streaming does not change routes; only an unmeasured
      // (imported) blocker appearing or leaving requires a rebuild.
      const unmeasured = (id: string) => { const e = this.store.entity(id); return !!e?.assetId && e.capabilities.includes('collidable') && !this.registry.manifest.assets.find((a) => a.id === e.assetId)?.footprint; };
      this.entities.onSpawn = (o) => { this.engine.shadowsDirty = true; this.applyInteriorLight(o, !!this.roomAt(o.getWorldPosition(new THREE.Vector3()).setY(o.position.y + 0.3))); if (unmeasured(o.userData.entityId)) this.scheduleDistrictRebuild(); };
      this.entities.onRelease = (id) => { if (unmeasured(id)) this.scheduleDistrictRebuild(); };
      // objects a running interaction or sequence depends on stay loaded whatever the distance
      this.entities.protect = () => this.protectedEntities();
      this.entities.sync(this.store.doc);
      this.placeActorFromDoc();
      this.interactions.restoreSeat();
      this.resetFollowCamera();
      this.engine.onUpdate((dt) => this.update(dt));
      this.engine.setQuality(this.ui.quality);
      this.engine.start();
      performance.mark('boot:world-and-actor');
      await this.entities.ready();
      performance.mark('boot:entities');
      if (doc.assembly) {
        this.set({ loading: [...this.ui.loading, { label: 'Ensembles, collisions et navigation', loaded: 0, total: 0 }] });
        await this.assembly.rebuildGeometry();
        performance.mark('boot:navigation');
        if (this.actor) {
          const p = this.nav?.closest(new THREE.Vector3(...doc.spawn.position)) ?? this.assembly.spawnPoint();
          if (p) this.actor.place(p, doc.spawn.heading);
          this.resetFollowCamera();
        }
        void StudioAssembly.rememberLast(doc.id);
      }
      if (this.district) {
        this.set({ loading: [...this.ui.loading, { label: 'Navigation du quartier', loaded: 0, total: 0 }] });
        await this.rebuildDistrictGeometry();
        performance.mark('boot:navigation');
        this.placeActorFromDoc();
        this.interactions.restoreSeat();
        this.resetFollowCamera();
      }
      this.sequences = new SequencePlayer(this);
      if (!doc.assembly && this.nav && doc.entities.some((e) => e.metadata?.sim)) {
        await this.assembly.rebuildSim();
      }
      if (doc.worldState.openingShot && doc.shots.length) {
        this.setMode('direct');
        this.cameras.goTo(doc.shots[0], 0);
      }
      // Authored scenery without a performer opens on its supplied camera.
      if (!this.actor && doc.shots.length) {
        this.setMode('direct');
        this.cameras.goTo(doc.shots[0], 0);
      }
      this.district?.mats.setEnvironment(this.engine.scene.environment, this.engine.scene.environmentIntensity);
      performance.mark('boot:ready');
      this.set({ phase: 'ready', loading: [], canUndo: false, canRedo: false });
      if (this.pendingNotice) { this.toast(this.pendingNotice); this.pendingNotice = ''; }
    } catch (e) {
      console.error(e);
      this.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async loadWorldDocument(): Promise<WorldDocument> {
    let wanted = new URLSearchParams(location.search).get('world');
    if (!wanted && this.registry.manifest.worlds.some((w) => w.id === 'lagos-market')) wanted = 'lagos-market';
    if (!wanted && this.registry.manifest.worlds.some((w) => w.id === 'hidden-alley')) wanted = 'hidden-alley';
    if (!wanted) {
      // the studio opens on the last assembled place, or on an empty one — never on a bundled demo district
      const last = await StudioAssembly.lastWorld();
      const saved = last ? await idb.get<WorldDocument>('worlds', last) : undefined;
      if (saved?.assembly) return saved;
      wanted = '';
      const hdri = this.registry.manifest.assets.find((a) => a.id === 'hdri.pedestrian-overpass') ? 'hdri.pedestrian-overpass' : this.registry.manifest.assets.find((a) => a.id.startsWith('hdri.'))!.id;
      const doc = StudioAssembly.emptyWorld('Nouveau lieu', { fictional: true }, hdri);
      await idb.put('worlds', doc.id, doc);
      this.worlds.push({ id: doc.id, name: doc.name });
      return doc;
    }
    if (wanted) {
      const saved = await idb.get<WorldDocument>('worlds', wanted);
      if ((saved?.composition || saved?.imported || saved?.district || saved?.assembly) && saved.format === 'cws-world' && !this.registry.manifest.worlds.some((w) => w.id === wanted)) return saved;
    }
    const entry = this.registry.manifest.worlds.find((w) => w.id === wanted) ?? this.registry.manifest.worlds[0];
    if (!entry) throw new Error('content manifest has no worlds');
    const res = await fetch(`${import.meta.env.BASE_URL}${entry.url}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`world HTTP ${res.status}`);
    const pkg = (await res.json()) as WorldDocument;
    const saved = await idb.get<WorldDocument>('worlds', pkg.id).catch(() => undefined);
    // User edits (entities, shots, world state) persist; environment settings always come from the package.
    if (saved && saved.format === pkg.format && saved.version === pkg.version) {
      if (pkg.revision && saved.revision !== pkg.revision) {
        // the published world changed (content, construction fixes): open it, keep the user's copy as its own world
        const backup = { ...saved, id: `${pkg.id}.avant-${saved.revision ?? 'v1'}`, name: `${saved.name} (avant mise à jour)` };
        await idb.put('worlds', backup.id, backup).catch(() => undefined);
        await idb.put('worlds', pkg.id, pkg).catch(() => undefined);
        this.pendingNotice = `« ${pkg.name} » a été mis à jour. Ta version précédente reste disponible : « ${backup.name} ».`;
        return pkg;
      }
      return pkg.district ? saved : { ...saved, environment: pkg.environment, zones: pkg.zones };
    }
    return pkg;
  }

  private async loadActor(doc: WorldDocument, track: (l: string) => (a: number, b: number) => void) {
    const ent = doc.entities.find((e) => e.type === 'ACTOR');
    if (!ent?.assetId) return null;
    const rec = this.registry.get(ent.assetId);
    if (rec.url.startsWith('pkg://') || rec.runtime?.embeddedClips) {
      // a character from an imported package: its own rig and clips (no substitution by another avatar)
      const a = await this.registry.loadGLTF(ent.assetId, track(rec.name));
      const c = characterClips(a.gltf.animations);
      if (!c.walk || !c.idle) throw new Error(`${rec.name} : aucune animation de locomotion dans le fichier — personnage non dirigeable`);
      const loco = (clip: THREE.AnimationClip, fallbackSpeed = 1.3) => {
        const k = clip.clone();
        const root = k.tracks.find((t) => /hips.*\.position$/i.test(t.name))?.name.split('.')[0];
        const dist = root ? stripRootMotion(k, root) : 0;
        // clips animated in place have no root travel: a walking pace is assumed and recorded
        return { clip: k, speed: dist > 0.05 ? dist / k.duration : fallbackSpeed };
      };
      const model = this.registry.instantiate(a);
      model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; });
      const actor = new Actor(model, { idle: c.idle.clone(), walk: loco(c.walk), run: c.run === c.walk ? { ...loco(c.walk), speed: loco(c.walk).speed * 1.9 } : loco(c.run!, 2.6) });
      return { actor, entityId: ent.id };
    }
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
    this.cameras.followHeading = this.actor.heading;
    this.cameras.followPivot.copy(this.actor.position);
    this.cameras.snapFollow();
  }

  /** room containing a world point (district rooms are rectangles in their building's frame) */
  roomAt(p: THREE.Vector3) {
    for (const r of this.district?.build.rooms ?? []) {
      if (p.y < r.floorY - 0.6 || p.y > r.ceilingY) continue;
      const [c0, c1, , c3] = r.corners;
      const ux = c1.x - c0.x, uz = c1.z - c0.z, vx = c3.x - c0.x, vz = c3.z - c0.z;
      const fu = ((p.x - c0.x) * ux + (p.z - c0.z) * uz) / (ux * ux + uz * uz);
      const fv = ((p.x - c0.x) * vx + (p.z - c0.z) * vz) / (vx * vx + vz * vz);
      if (fu > 0 && fu < 1 && fv > 0 && fv < 1) return r;
    }
    return null;
  }

  /** Surroundings for the automatic follow framing: destination, motion, and the room the actor is in. */
  private followContext(): FollowContext {
    const a = this.actor!;
    const r = this.roomAt(a.position);
    return {
      destination: a.path.length ? a.path[a.path.length - 1] : null,
      velocity: _fv.copy(a.desiredDir).multiplyScalar(a.speed),
      room: r ? { corners: r.corners, ceilingY: r.ceilingY } : null,
    };
  }

  /** inside a room the sky light only comes through the openings: objects (and the actor) get a reduced share */
  private applyInteriorLight(obj: THREE.Object3D, inside: boolean) {
    const env = this.engine.scene.environment;
    const key = inside ? `in:${env?.uuid}` : 'out';
    if (obj.userData.__interior === key) return;
    obj.userData.__interior = key;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        if (!('__env' in std.userData)) std.userData.__env = { map: std.envMap, intensity: std.envMapIntensity };
        const orig = std.userData.__env as { map: THREE.Texture | null; intensity: number };
        // an explicit envMap is required for the reduced intensity to apply (see MaterialLibrary.setEnvironment)
        if (inside && !orig.map && env) { std.envMap = env; std.envMapIntensity = orig.intensity * INTERIOR_ENV * this.engine.scene.environmentIntensity; }
        else { std.envMap = orig.map; std.envMapIntensity = orig.intensity; }
        std.needsUpdate = true;
      }
    });
  }

  // ---------------------------------------------------------------- frame
  private update(dt: number) {
    const a = this.actor;
    if (a) {
      // Product control is pointer/touch directed. Keyboard locomotion is intentionally not used.
      if (this.ui.mode === 'explore' && !a.path.length) a.desiredSpeed = 0;
      const before = a.position.x + a.position.z * 7.31 + a.heading * 3.7;
      a.update(dt);
      this.cameras.followHeading = a.heading;
      // an animated actor always changes its shadow; an idle one only breathes
      if (a.state !== 'idle' || Math.abs(before - (a.position.x + a.position.z * 7.31 + a.heading * 3.7)) > 1e-5) this.engine.shadowsDirty = true;
      if (a.state !== this.ui.actorState) this.set({ actorState: a.state });
      this.cameras.followPivot.lerp(a.position, 1 - Math.exp(-dt * 10));
      if (this.district) this.applyInteriorLight(a.root, !!this.roomAt(a.position));
      if (this.actorMarker.visible) this.actorMarker.position.set(a.position.x, a.position.y + 0.025, a.position.z);
      this.engine.shadowFocus.copy(this.ui.cameraMode === 'follow' ? a.position : this.cameras.mode === 'director' ? this.cameras.orbitTarget : a.position);
    }
    this.interactions.update();
    this.cameras.update(dt);
    if (this.store.doc.assembly || this.store.doc.entities.some((e) => e.metadata?.sim)) {
      this.assembly.runtime.updateLod(this.entities.objects.values(), this.cameras.camera.position);
      // one clock: the population advances with the same frame time as the sequence and the actor (also in fixed-step rehearsal/export)
      this.sim.update(dt, this.actor ? { position: this.actor.position } : null);
    }
    if (Number.isFinite(this.entities.radius) && (this.streamTimer += dt) > 0.5) {
      this.streamTimer = 0;
      this.entities.focus = [this.actor?.position.clone() ?? new THREE.Vector3(), this.cameras.camera.position.clone()];
      this.entities.stream();
      // shops are stocked once the world is usable, never in competition with its first load
      if (this.district && this.dresser && this.ui.phase === 'ready') this.dresser.update(this.district.build, this.entities.focus);
    }
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
    this.actor?.cancelPath();
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
    this.actorMarker.visible = id === this.actorEntityId;
    if (this.actorMarker.visible && this.actor) this.actorMarker.position.set(this.actor.position.x, this.actor.position.y + 0.025, this.actor.position.z);
    if (id && this.selectionHistory.at(-1) !== id) this.selectionHistory = [...this.selectionHistory, id].slice(-6);
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
    const committed = this.store.commit(`Transform ${this.store.entity(id)?.name}`, (doc) => {
      const e = doc.entities.find((x) => x.id === id);
      if (!e) return false;
      e.transform = t;
    });
    if (!committed) this.entities.sync(this.store.doc);
  }

  /** Collision + navigation from the district plan and the current obstacle entities. */
  async rebuildDistrictGeometry() {
    if (!this.district || !this.store.doc.district) return;
    await this.entities.ready();
    if (this.district.sync(this.store.doc)) this.dresser?.clear();
    const { collide, navigate } = this.district.geometry(this.store.doc, this.entities.objects, (id) => this.registry.manifest.assets.find((a) => a.id === id)?.footprint);
    // human clearance: 0.3 m radius on a 15 cm grid, so 1.2 m doorways stay passable
    const nav = await Navigation.build(navigate, { cs: 0.15, radius: 0.3 });
    navigate.dispose();
    const old = this.collision;
    this.collision = new CollisionWorld(collide);
    old?.debugMesh.removeFromParent(); old?.geometry.dispose();
    this.nav?.dispose(); this.nav = nav;
    this.cameras.collision = this.collision;
    if (this.actor) this.actor.collision = this.collision;
    this.engine.scene.add(this.collision.debugMesh, nav.debugObject());
    this.engine.shadowsDirty = true;
  }

  private streamTimer = 0;
  /** interaction target, held objects and every target of the sequence being played */
  private protectedEntities() {
    const ids = new Set<string>();
    if (this.ui.interactionTarget) ids.add(this.ui.interactionTarget);
    for (const e of this.store.doc.entities) if ((e.metadata?.interaction as { heldBy?: string } | undefined)?.heldBy) ids.add(e.id);
    for (const id of this.sequences?.activeTargets() ?? []) ids.add(id);
    return ids;
  }
  private scheduleDistrictRebuild() {
    if (!this.district || this.ui.phase !== 'ready') return;
    clearTimeout(this.geometryTimer);
    const generation = ++this.geometryGeneration;
    this.geometryTimer = window.setTimeout(() => {
      if (generation === this.geometryGeneration) this.rebuildDistrictGeometry().catch((e) => this.toast(`Navigation : ${e instanceof Error ? e.message : String(e)}`));
    }, 600);
  }

  private districtKey() {
    const d = this.store.doc;
    return JSON.stringify([d.district, d.entities.filter((e) => e.capabilities.includes('collidable') && e.type !== 'ACTOR').map((e) => [e.id, e.transform.position, e.transform.rotation, e.transform.scale])]);
  }

  private onDocChange(source: string) {
    this.entities.sync(this.store.doc);
    if (this.store.doc.assembly) this.assembly.onDocChange(source);
    // moved objects follow the light of the space they are now in
    if (this.district) for (const o of this.entities.objects.values()) if (o !== this.actor?.root) this.applyInteriorLight(o, !!this.roomAt(_v.copy(o.position).setY(o.position.y + 0.3)));
    const env = this.store.doc.environment, sunKey = JSON.stringify([env.sun, env.exposure]);
    if (sunKey !== this.appliedSun) {
      this.appliedSun = sunKey;
      this.engine.setSun(env.sun.azimuth, env.sun.elevation, env.sun.intensity);
      this.engine.renderer.toneMappingExposure = env.exposure;
    }
    if (this.district && source !== 'sequence') {
      const key = this.districtKey();
      if (key !== this.districtSignature) {
        this.districtSignature = key;
        clearTimeout(this.geometryTimer);
        const generation = ++this.geometryGeneration;
        this.geometryTimer = window.setTimeout(() => {
          if (generation === this.geometryGeneration) this.rebuildDistrictGeometry().catch((e) => this.toast(`Navigation : ${e instanceof Error ? e.message : String(e)}`));
        }, 300);
      }
    }
    const signature = JSON.stringify(this.store.doc.entities.filter((e) => e.type === 'BUILDING' || e.type === 'ROAD').map((e) => [e.id, e.transform]));
    if (this.store.doc.composition && signature !== this.geometrySignature) {
      this.geometrySignature = signature;
      const generation = ++this.geometryGeneration;
      clearTimeout(this.geometryTimer);
      this.geometryTimer = window.setTimeout(async () => {
        try {
          this.actor?.cancelPath();
          const geometry = worldGeometry(this.store.doc, this.registry.manifest.assets);
          const navGeometry = worldGeometry(this.store.doc, this.registry.manifest.assets, true);
          const nav = await Navigation.build(navGeometry); navGeometry.dispose();
          if (generation !== this.geometryGeneration) { nav.dispose(); geometry.dispose(); return; }
          const old = this.collision;
          this.collision = new CollisionWorld(geometry);
          old?.debugMesh.removeFromParent(); old?.geometry.dispose();
          this.nav?.dispose(); this.nav = nav;
          this.cameras.collision = this.collision;
          if (this.actor) this.actor.collision = this.collision;
          this.engine.scene.add(this.collision.debugMesh, nav.debugObject());
        } catch (e) { this.toast(`Navigation: ${e instanceof Error ? e.message : String(e)}`); }
      }, 250);
    }
    this.engine.shadowsDirty = true;
    if (source === 'undo' || source === 'redo' || source === 'load') { this.placeActorFromDoc(); this.interactions.restoreSeat(); }
    else if (this.actor?.seated) this.interactions.restoreSeat();
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
      refreshSpatialData(doc, this.registry.manifest.assets);
      await idb.put('worlds', doc.id, doc);
      const back = await idb.get<WorldDocument>('worlds', doc.id);
      if (!back || back.entities.length !== doc.entities.length) throw new Error('read-back mismatch');
      if (this.sim?.people.length + this.sim?.vehicles.length) await idb.put('settings', `sim:${doc.id}`, this.sim.snapshot());
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

  async createWorld(plan: WorldPlan) {
    const baseline = this.store.snapshot();
    const doc = composeWorld(plan, baseline, this.registry.manifest.assets);
    refreshSpatialData(doc, this.registry.manifest.assets);
    // Assets and navigation must be usable before persisting a new package or leaving the current one.
    await Promise.all(doc.composition!.dependencies.filter((id) => this.registry.get(id).format === 'glb').map((id) => this.registry.loadGLTF(id)));
    refreshSpatialData(doc, this.registry.manifest.assets);
    const geometry = worldGeometry(doc, this.registry.manifest.assets);
    const navGeometry = worldGeometry(doc, this.registry.manifest.assets, true);
    const nav = await Navigation.build(navGeometry); navGeometry.dispose();
    if (!nav.closest(new THREE.Vector3(...doc.spawn.position))) throw new Error('Point de départ non accessible');
    nav.dispose(); geometry.dispose();
    if (!await this.save()) throw new Error('Le monde actuel ne peut pas être sauvegardé');
    await idb.put('worlds', doc.id, doc);
    const back = await idb.get<WorldDocument>('worlds', doc.id);
    if (!back || back.entities.length !== doc.entities.length) throw new Error('Échec de sauvegarde du nouveau monde');
    this.worlds.push({ id: doc.id, name: doc.name });
    await this.switchWorld(doc.id);
    return doc.id;
  }

  /** Brief → district plan → authored assets → composed, saved, navigable world (Yaba 2003 kit). */
  /**
   * Brief/panel plan → composed, saved, navigable world. Nothing is preloaded here: the new world streams its
   * models around the spawn point like any district (only missing manifest entries block the composition).
   */
  async createDistrictWorld(p: DistrictBriefPlan) {
    if (p.blockers.length) throw new Error(p.blockers.join(' '));
    const actor = this.store.doc.entities.find((e) => e.type === 'ACTOR');
    if (!actor) throw new Error('Acteur de référence absent');
    const doc = composeYabaWorld(p.plan, actor, this.registry.manifest.assets, { id: `world.${crypto.randomUUID()}`, name: p.name, workstations: p.params.cafe.workstations, layout: p.params.cafe.layout });
    setTimeOfDay(doc, p.time);
    if (doc.district!.missing.length) throw new Error(`Assets introuvables : ${doc.district!.missing.join(', ')}`);
    const made = doc.entities.filter((e) => /^ws\.\d+\.desk$/.test(e.id)).length;
    if (made < p.params.cafe.workstations) throw new Error(`La salle (${p.params.cafe.width} × ${p.params.cafe.depth} m, disposition « ${p.params.cafe.layout} ») ne contient que ${made} poste(s) sur ${p.params.cafe.workstations} : agrandis-la ou change la disposition.`);
    if (!await this.save()) throw new Error('Le monde actuel ne peut pas être sauvegardé');
    await idb.put('worlds', doc.id, doc);
    const back = await idb.get<WorldDocument>('worlds', doc.id);
    if (!back?.district) throw new Error('Échec de sauvegarde du nouveau monde');
    this.worlds.push({ id: doc.id, name: doc.name });
    await this.switchWorld(doc.id);
    return doc.id;
  }

  /**
   * New empty assembled place (no bundled district, no default actor content): saved, listed, then opened.
   * Content is added afterwards with the assembly operations.
   */
  async createAssemblyWorld(name = 'Nouveau lieu', context: Partial<NonNullable<WorldDocument['assembly']>['context']> = {}) {
    const hdri = this.registry.manifest.assets.find((a) => a.id === 'hdri.pedestrian-overpass')?.id ?? this.registry.manifest.assets.find((a) => a.id.startsWith('hdri.'))!.id;
    const doc = StudioAssembly.emptyWorld(name, { fictional: true, ...context }, hdri);
    if (!await this.save()) throw new Error('Le monde actuel ne peut pas être sauvegardé');
    await idb.put('worlds', doc.id, doc);
    if (!(await idb.get<WorldDocument>('worlds', doc.id))?.assembly) throw new Error('Échec de sauvegarde du nouveau lieu');
    this.worlds.push({ id: doc.id, name: doc.name });
    await this.switchWorld(doc.id);
    return doc.id;
  }

  /**
   * The character the user embodies in an assembled place: a package character with its own rig and clips
   * (no retargeting). The world is saved and reopened so the actor loads like any world actor.
   */
  async setPlaceActor(resourceRef: string) {
    const hit = this.assembly.catalog.resource(resourceRef);
    if (!hit || hit.res.kind !== 'character') throw new Error(`Personnage introuvable : ${resourceRef}`);
    if (!hit.res.clips?.length) throw new Error(`${hit.res.id} n’a pas d’animation : il ne peut pas être dirigé.`);
    const assetId = `pkg:${hit.pkg.id}/${hit.res.id}`;
    const p = this.assembly.spawnPoint() ?? new THREE.Vector3(...this.store.doc.spawn.position);
    this.store.commit(`Personnage : ${hit.res.id}`, (d) => {
      d.entities = d.entities.filter((e) => e.type !== 'ACTOR');
      d.entities.push({ id: 'actor', type: 'ACTOR', name: hit.res.id, assetId, transform: { position: [p.x, p.y, p.z], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tags: ['actor'], capabilities: ['selectable'], metadata: { package: hit.pkg.id } } as unknown as Entity);
      d.spawn = { position: [p.x, p.y, p.z], heading: 0 };
    });
    await this.switchWorld(this.store.doc.id);
  }

  async importWorldFile(file: File, unitsToMetres = 1) {
    const record = await this.registry.importFile(file, unitsToMetres);
    return this.importWorldAsset(record.id);
  }

  async importWorldURL(url: string, unitsToMetres = 1) {
    const record = await this.registry.importWorldURL(url, unitsToMetres);
    return this.importWorldAsset(record.id);
  }

  async importWorldAsset(id: string) {
    const record = await this.registry.worldSource(id);
    const source = await this.registry.loadGLTF(record.id);
    const geometry = await sceneGeometry(source.template);
    let nav: Navigation | null = null;
    try {
      nav = await Navigation.build(geometry);
      const preferred = this.registry.get(id).runtime?.spawn as [number,number,number] | undefined;
      const spawn = sceneSpawn(nav, geometry.boundingBox!, preferred);
      const doc = importedDocument(record, this.store.snapshot(), geometry.boundingBox!, spawn, geometry.index!.count / 3);
      doc.imported!.dataKey = `derived:${doc.id}:v1`;
      await idb.put('settings', doc.imported!.dataKey, { positions: geometry.getAttribute('position').array, indices: geometry.index!.array, nav: nav.serialize() });
      if (!await this.save()) throw new Error('Sauvegarde du monde actuel impossible');
      await idb.put('worlds', doc.id, doc);
      const back = await idb.get<WorldDocument>('worlds', doc.id);
      if (!back?.imported) throw new Error('Sauvegarde du monde importé impossible');
      this.worlds.push({id:doc.id,name:doc.name});
      await this.switchWorld(doc.id);
      return doc.id;
    } finally { nav?.dispose(); geometry.dispose(); }
  }

  async switchWorld(id: string) {
    const entry = this.worlds.find((w) => w.id === id);
    if (!entry) {
      this.toast(`Unknown world: ${id}`);
      return;
    }
    if (!await this.save()) { this.toast('Save failed; the current world stays open'); return; }
    const u = new URL(location.href);
    u.searchParams.set('world', id);
    location.assign(u.toString());
  }

  // ---------------------------------------------------------------- pointer
  private bindPointer() {
    const pointers = new Set<number>();
    let down: { id: number; x: number; y: number; moved: boolean } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      if (pointers.size !== 1 || e.button !== 0) { down = null; return; }
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    });
    this.canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); down = null; });
    window.addEventListener('pointerup', (e) => {
      const tap = down && down.id === e.pointerId && !down.moved && pointers.size === 1;
      pointers.delete(e.pointerId);
      down = null;
      if (tap && e.target === this.canvas && !this.gizmo.dragging) this.onClick(e.clientX, e.clientY);
    });
  }

  private pick(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.cameras.camera);
    const hits = _ray.intersectObjects([...this.entities.pickables(), this.sim.root], true);
    const entityHit = hits.find((h) => { const id = h.object.userData.entityId; return id && this.store.entity(id)?.capabilities.includes('selectable'); });
    let ent = entityHit?.object.userData.entityId as string | undefined;
    let ground: THREE.Vector3 | null = null;
    if (this.collision) {
      const hit = this.collision.bvh.raycastFirst(_ray.ray, THREE.DoubleSide, 0, 400);
      if (hit) ground = hit.point.clone();
    }
    let entDist = entityHit?.distance ?? Infinity;
    if (!ent) {
      // Thin authored objects need a forgiving finger-sized screen target, while walls still occlude them.
      for (const e of this.store.doc.entities) {
        if (!e.capabilities.includes('interactable')) continue;
        const obj = this.entities.objects.get(e.id);
        if (!obj) continue;
        const box = new THREE.Box3().setFromObject(obj), center = box.getCenter(new THREE.Vector3());
        const projected = center.clone().project(this.cameras.camera);
        if (projected.z < -1 || projected.z > 1) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(cx, cy, cz).project(this.cameras.camera);
          const sx = r.left + (p.x + 1) * r.width / 2, sy = r.top + (1 - p.y) * r.height / 2;
          minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        }
        const distance = center.distanceTo(_ray.ray.origin);
        if (x >= minX - 12 && x <= maxX + 12 && y >= minY - 12 && y <= maxY + 12 && distance < entDist && (!ground || distance < ground.distanceTo(_ray.ray.origin) + 0.05)) {
          ent = e.id; entDist = distance;
        }
      }
    }
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
        this.set({ interactionTarget: null });
        this.toast('Personnage sélectionné · touche le sol ou un objet');
        return;
      }
      if (this.ui.selection === this.actorEntityId) {
        if (p.entity && p.entity !== this.actorEntityId && p.entityDistance <= p.groundDistance + 0.05) {
          this.set({ interactionTarget: p.entity });
          if (!this.interactions.actionsFor(p.entity).length) this.toast('Cet objet ne possède pas encore d’action');
          return;
        }
        if (p.ground) {
          this.set({ interactionTarget: null });
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
