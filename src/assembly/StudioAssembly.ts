import * as THREE from 'three';
import type { AssetRecord, Entity, WorldDocument } from '../core/types';
import { idb } from '../storage/idb';
import { Catalog } from '../content/Catalog';
import { PackageStore, type ImportProgress } from '../content/PackageStore';
import type { CwsPackage } from '../content/package';
import { CollisionWorld } from '../runtime/CollisionWorld';
import { Navigation } from '../runtime/Navigation';
import type { Studio } from '../runtime/Studio';
import { isAgentRefusal, refusalPayload } from '../vendor/pascal/refusal';
import type { SceneChanges, SceneNodes } from '../vendor/pascal/types';
import { AssemblyRuntime, resourceAssetId } from './AssemblyRuntime';
import type { SimSnapshot } from '../sim/Simulation';
import { planTransaction, verifyAssembly, worldConnector, type Issue, type OperationName } from './operations';

/**
 * The studio side of assembled worlds: imported packages and their catalogue, the transaction runner for the
 * Pascal-style operations, verification (scene rules + navigation) and the collision/navigation rebuilt from
 * the placed sets. The world document stays the single authority: operations become one store commit each.
 */
export type RunResult = { ok: true; results: Record<string, unknown>[]; issues: Issue[]; created: string[]; updated: string[]; deleted: string[] }
  | { ok: false; error: string; code: string; details?: Record<string, unknown>; issues?: Issue[]; results?: Record<string, unknown>[] };

export class StudioAssembly {
  readonly packages = new PackageStore();
  readonly catalog = new Catalog();
  readonly runtime: AssemblyRuntime;
  /** packages listed in this browser whose manifest could not be read */
  broken: { id: string; error: string }[] = [];
  private rebuildTimer = 0;
  private rebuildGen = 0;
  private signature = '';

  constructor(private s: Studio) {
    this.runtime = new AssemblyRuntime(s.registry, this.catalog);
    s.registry.packageReader = (url) => {
      const m = url.match(/^pkg:\/\/([^/]+)\/(.+)$/);
      if (!m) throw new Error(`Adresse de paquet invalide : ${url}`);
      return this.packages.read(m[1], m[2]);
    };
  }

  // ------------------------------------------------------------------ packages
  async loadInstalled() {
    this.broken = [];
    for (const p of await this.packages.list()) {
      try { this.register(await this.packages.manifest(p.id)); } catch (e) { this.broken.push({ id: p.id, error: e instanceof Error ? e.message : String(e) }); }
    }
  }

  register(pkg: CwsPackage) {
    this.catalog.add(pkg);
    const assets = this.s.registry.manifest.assets;
    for (const r of pkg.resources) {
      const id = resourceAssetId(pkg.id, r.id);
      const rec: AssetRecord = {
        id, name: r.id, category: r.kind === 'character' ? 'CHARACTERS' : r.kind === 'vehicle' ? 'VEHICLES' : 'PROPS',
        source: pkg.source.notGta ? 'Paquet de test (non GTA)' : pkg.source.kind === 'gta5' ? 'GTA V — import privé' : pkg.source.kind,
        sourceUrl: '', url: `pkg://${pkg.id}/${r.file}`, format: 'glb',
        license: { id: pkg.source.notGta ? 'test-fixture' : 'private-import', verified: false, attribution: pkg.source.license },
        tags: [...r.tags, `package:${pkg.id}`], entityType: r.kind === 'character' ? 'ACTOR' : r.kind === 'vehicle' ? 'VEHICLE' : 'PROP', bytes: r.bytes,
        runtime: { preserveOrigin: true, package: pkg.id, clips: undefined },
        footprint: { min: r.bounds.min, max: r.bounds.max },
      } as AssetRecord;
      const i = assets.findIndex((a) => a.id === id);
      if (i >= 0) assets[i] = rec; else assets.push(rec);
    }
  }

  async importFile(file: File, onProgress?: (p: ImportProgress) => void) { const e = await this.packages.importFile(file, onProgress); this.register(await this.packages.manifest(e.id)); return e; }
  async importFolder(files: File[], onProgress?: (p: ImportProgress) => void) { const e = await this.packages.importFolder(files, onProgress); this.register(await this.packages.manifest(e.id)); return e; }
  async importUrl(url: string, init?: RequestInit, onProgress?: (p: ImportProgress) => void) { const e = await this.packages.importUrl(url, init, onProgress); this.register(await this.packages.manifest(e.id)); return e; }
  /** the site's own test package (not GTA content) */
  importTestPackage(onProgress?: (p: ImportProgress) => void) { return this.importUrl(`${import.meta.env.BASE_URL}content/packages/fixture.test-city.cwspkg`, undefined, onProgress); }
  async removePackage(id: string) { await this.packages.remove(id); this.catalog.remove(id); }

  // ------------------------------------------------------------------ worlds
  static emptyWorld(name: string, context: NonNullable<WorldDocument['assembly']>['context'], hdri: string): WorldDocument {
    return {
      format: 'cws-world', version: 3, id: `world.${crypto.randomUUID()}`, name,
      // late-afternoon light by default (the physical sky reads as a sky, not a white haze); set_time_of_day changes it
      environment: { hdri, sun: { azimuth: -95, elevation: 16, intensity: 3.2 }, exposure: 1.0 },
      spawn: { position: [0, 0.3, 0], heading: 0 }, zones: [], entities: [], shots: [], worldState: { timeOfDay: 'golden' },
      assembly: { context, junctions: [], packages: [] }, sequences: [],
    } as WorldDocument;
  }

  // ------------------------------------------------------------------ operations
  private nodes(): SceneNodes { return Object.fromEntries(this.s.store.doc.entities.map((e) => [e.id, e as unknown as SceneNodes[string]])); }
  private ctx() { return { activeLevelId: null as null, catalog: this.catalog, junctions: this.s.store.doc.assembly?.junctions ?? [] }; }

  /**
   * Run operations as one transaction. The scene is previewed and verified first; a step that refuses aborts the
   * whole transaction, and blocking issues it would introduce abort it too unless `force` is set.
   */
  run(steps: { op: OperationName; input: Record<string, unknown> }[], label: string, opts: { force?: boolean } = {}): RunResult {
    if (!this.s.store.doc.assembly) return { ok: false, code: 'not_an_assembly', error: 'Ce monde n’est pas un assemblage : crée d’abord un lieu (create_world).' };
    const before = verifyAssembly(this.nodes(), this.ctx());
    let plan;
    try { plan = planTransaction(this.nodes(), steps, this.ctx()); }
    catch (e) {
      if (isAgentRefusal(e)) { const p = refusalPayload(e); return { ok: false, code: p.code, error: p.error, details: e.details }; }
      return { ok: false, code: 'operation_failed', error: e instanceof Error ? e.message : String(e) };
    }
    const introduced = plan.issues.filter((i) => i.severity === 'blocking' && !before.some((b) => b.code === i.code && b.ids.join() === i.ids.join()));
    if (introduced.length && !opts.force) return { ok: false, code: 'verification_failed', error: introduced.map((i) => i.message).join(' '), issues: plan.issues, results: plan.results };
    this.commit(plan.changes, label, plan.junctions, plan.issues);
    return { ok: true, results: plan.results, issues: plan.issues, created: plan.changes.create.map((c) => c.node.id), updated: plan.changes.update.map((u) => u.id), deleted: plan.changes.delete };
  }

  /** Pascal SceneChanges → one store commit (updates, creates, then deletes with their children) */
  private commit(changes: Required<SceneChanges>, label: string, junctions: NonNullable<WorldDocument['assembly']>['junctions'], issues: Issue[]) {
    this.s.store.commit(label, (d) => {
      for (const u of changes.update) { const e = d.entities.find((x) => x.id === u.id); if (e) Object.assign(e, structuredClone(u.data)); }
      for (const c of changes.create) d.entities.push(structuredClone({ ...c.node, ...(c.parentId ? { parentId: c.parentId } : {}) }) as unknown as Entity);
      const gone = new Set(changes.delete);
      let grew = true;
      while (grew) { grew = false; for (const e of d.entities) if (e.parentId && gone.has(e.parentId) && !gone.has(e.id)) { gone.add(e.id); grew = true; } }
      d.entities = d.entities.filter((e) => !gone.has(e.id));
      d.assembly!.junctions = structuredClone(junctions);
      d.assembly!.issues = issues.map(({ code, message, ids }) => ({ code, message, ids }));
      d.assembly!.packages = [...new Set(d.entities.flatMap((e) => { const r = (e.metadata?.set as { ref?: string } | undefined)?.ref ?? (e.assetId?.startsWith('pkg:') ? e.assetId.slice(4) : ''); return r ? [r.split('/')[0]] : []; }))];
    });
  }

  /** scene rules + navigation continuity between placements (needs the rebuilt navmesh) */
  verify(): Issue[] {
    const issues = verifyAssembly(this.nodes(), this.ctx());
    const nav = this.s.nav;
    const sets = this.s.store.doc.entities.filter((e) => e.type === 'SET');
    if (sets.length && !nav) { issues.push({ code: 'no_navigation', severity: 'warning', message: 'Navigation pas encore calculée pour cet assemblage.', ids: [] }); return issues; }
    if (!nav || sets.length < 2) return issues;
    // a walkable sample per placement: its walkable accesses first, else its centre
    const sample = (e: Entity) => {
      const def = this.runtime.setOf(e);
      for (const c of def?.connectors.filter((x) => x.kind !== 'road') ?? []) {
        const w = worldConnector(e, c); const p = nav.closest(w.p.clone().addScaledVector(w.n, -1.2));
        if (p && p.distanceTo(w.p) < 3) return p;
      }
      return nav.closest(new THREE.Vector3(...e.transform.position));
    };
    const pts = sets.map((e) => ({ e, p: sample(e) }));
    const origin = pts.find((x) => x.p);
    if (!origin) return issues;
    const reachable = new Set<string>([origin.e.id]);
    for (const x of pts) {
      if (x === origin) continue;
      if (!x.p) { issues.push({ code: 'not_walkable', severity: 'warning', message: `${x.e.name} : aucun sol praticable trouvé.`, ids: [x.e.id] }); continue; }
      if (!nav.path(origin.p!, x.p)) issues.push({ code: 'unreachable', severity: 'warning', message: `${x.e.name} n’est pas accessible à pied depuis ${origin.e.name}.`, ids: [origin.e.id, x.e.id] });
      else reachable.add(x.e.id);
    }
    // a set placed edge to edge without a declared junction is still fine when one can actually walk to it
    return issues.filter((i) => !(i.code === 'isolated' && reachable.has(i.ids[0]))).concat(issues.some((i) => i.code === 'isolated' && reachable.has(i.ids[0])) ? [{ code: 'adjacent_without_junction', severity: 'info', message: 'Ensemble(s) accolé(s) sans jonction déclarée, mais accessibles à pied.', ids: issues.filter((i) => i.code === 'isolated' && reachable.has(i.ids[0])).map((i) => i.ids[0]) }] : []);
  }

  // ------------------------------------------------------------------ collision + navigation from the placed sets
  private simSignature = '';
  onDocChange(source: string) {
    const doc = this.s.store.doc;
    const sig = JSON.stringify(doc.entities.filter((e) => e.type === 'SET').map((e) => [e.id, e.transform, e.metadata?.set]));
    const simSig = JSON.stringify(doc.entities.filter((e) => e.metadata?.sim).map((e) => [e.id, e.assetId, e.transform.position, e.metadata?.sim]));
    if (sig === this.signature && simSig !== this.simSignature && this.s.nav) { this.simSignature = simSig; void this.rebuildSim(); }
    if (sig === this.signature || source === 'sequence') return;
    this.signature = sig;
    clearTimeout(this.rebuildTimer);
    const gen = ++this.rebuildGen;
    this.rebuildTimer = window.setTimeout(() => { if (gen === this.rebuildGen) this.rebuildGeometry().catch((e) => this.s.toast(`Navigation : ${e instanceof Error ? e.message : String(e)}`)); }, 300);
  }

  async waitForSets(timeoutMs = 180000) {
    const t0 = performance.now();
    await this.s.entities.ready();
    while (this.runtime.loading.size && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 60));
  }

  private building: Promise<void> = Promise.resolve();
  /** one rebuild at a time (the navigation generator is not re-entrant) */
  rebuildGeometry() { return (this.building = this.building.catch(() => undefined).then(() => this.rebuildNow())); }

  private async rebuildNow() {
    await this.waitForSets();
    const geometry = this.runtime.geometry(this.s.store.doc, this.s.entities.objects);
    if (!geometry.getAttribute('position').count) { geometry.dispose(); return; }
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    if (!(Math.max(size.x, size.z) < 6000)) { geometry.dispose(); throw new Error(`étendue de l’assemblage invalide pour la navigation (${size.x.toFixed(0)} × ${size.z.toFixed(0)} m)`); }
    console.info(`[assembly] navigation: ${geometry.getAttribute('position').count / 3} triangles, ${size.x.toFixed(0)} × ${size.z.toFixed(0)} m`);
    const nav = await Navigation.build(geometry, { cs: 0.2, radius: 0.3 });
    const old = this.s.collision;
    const collision = new CollisionWorld(geometry);
    old?.debugMesh.removeFromParent(); old?.geometry.dispose();
    this.s.nav?.dispose();
    this.s.collision = collision; this.s.nav = nav;
    this.s.cameras.collision = collision;
    if (this.s.actor) this.s.actor.collision = collision;
    this.s.engine.scene.add(collision.debugMesh, nav.debugObject());
    this.s.engine.shadowsDirty = true;
    await this.rebuildSim();
    this.s.set({});
  }

  private simRestored = false;
  /** population on the current navigation; the saved snapshot is applied once, when the world opens */
  async rebuildSim() {
    const doc = this.s.store.doc, nav = this.s.nav;
    if (!nav) return;
    this.simSignature = JSON.stringify(doc.entities.filter((e) => e.metadata?.sim).map((e) => [e.id, e.assetId, e.transform.position, e.metadata?.sim]));
    const restore = this.simRestored ? null : await idb.get<SimSnapshot>('settings', `sim:${doc.id}`).catch(() => undefined);
    this.simRestored = true;
    this.s.sim.setDocument(doc);
    await this.s.sim.rebuild(doc, nav, this.s.entities.objects, restore);
  }

  /** where the actor starts: a walkable point next to the first placement's first pedestrian access */
  spawnPoint(): THREE.Vector3 | null {
    const nav = this.s.nav;
    const first = this.s.store.doc.entities.find((e) => e.type === 'SET');
    if (!nav || !first) return null;
    for (const c of this.runtime.setOf(first)?.connectors.filter((x) => x.kind === 'sidewalk' || x.kind === 'passage' || x.kind === 'door') ?? []) {
      const w = worldConnector(first, c), p = nav.closest(w.p.clone().addScaledVector(w.n, -3));
      if (p) return p;
    }
    return nav.closest(new THREE.Vector3(...first.transform.position));
  }

  /** last opened assembly world, to reopen it by default */
  static async rememberLast(id: string) { await idb.put('settings', 'lastWorld', id).catch(() => undefined); }
  static async lastWorld() { return idb.get<string>('settings', 'lastWorld').catch(() => undefined); }
}

/** idle / walk / run clips for a package character, from its own animations (names first, else what exists) */
export function characterClips(animations: THREE.AnimationClip[]) {
  const by = (re: RegExp) => animations.find((a) => re.test(a.name));
  const walk = by(/walk|marche/i) ?? animations[0];
  const run = by(/run|jog|course/i) ?? walk;
  let idle = by(/idle|stand|repos/i);
  if (!idle && walk) {
    // no idle clip: a still pose sampled at the walk's first frame
    idle = new THREE.AnimationClip('idle(still)', 1, walk.tracks.map((t) => {
      const T = t.constructor as new (n: string, times: number[], values: number[]) => THREE.KeyframeTrack;
      return new T(t.name, [0], Array.from(t.values.slice(0, t.getValueSize())));
    }));
  }
  return { idle: idle ?? null, walk: walk ?? null, run: run ?? null };
}
