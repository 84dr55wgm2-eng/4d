import * as THREE from 'three';
import { Crowd, type CrowdAgent } from '@recast-navigation/core';
import type { Entity, WorldDocument } from '../core/types';
import type { Navigation } from '../runtime/Navigation';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { AssemblyRuntime } from '../assembly/AssemblyRuntime';
import { matrixOf } from '../assembly/AssemblyRuntime';
import { worldConnector } from '../assembly/operations';
import { characterClips } from '../assembly/StudioAssembly';

/**
 * Population of an assembled place on one clock: pedestrians are Detour Crowd agents (local avoidance, repath when
 * blocked), customers go in, take a free seat (one occupant per seat) or wait, then leave; vehicles follow the
 * placed sets' lanes and stop for whatever stands ahead. The world document stays the authority for who exists
 * and where they belong; the moving state is runtime, snapshotted with the world when it is saved.
 */
type Behavior = 'wander' | 'customer' | 'sit' | 'drive' | 'idle';
interface SimMeta { kind: 'person' | 'vehicle' | 'prop'; behavior: Behavior; home: string; area?: string | null }
type Phase = 'idle' | 'walk' | 'wait' | 'seated';
interface Person {
  id: string; behavior: Behavior; home: string; area?: string | null;
  agent: CrowdAgent; obj: THREE.Object3D; mixer: THREE.AnimationMixer | null; walk?: THREE.AnimationAction; idle?: THREE.AnimationAction; clipSpeed: number;
  phase: Phase; plan: string[]; until: number; target: THREE.Vector3 | null; seat: Seat | null;
  stuck: number; repaths: number; rng: () => number; heading: number;
}
interface Seat { id: string; position: THREE.Vector3; approach: THREE.Vector3; heading: number; placement: string; occupant: string | null }
interface Lane { id: string; points: THREE.Vector3[]; length: number }
interface Vehicle { id: string; obj: THREE.Object3D; lane: Lane; s: number; speed: number; cruise: number; stopped: boolean; rng: () => number }
export interface SimSnapshot { t: number; people: Record<string, { p: [number, number, number]; phase: Phase; plan: string[]; until: number; seat: string | null }>; vehicles: Record<string, { lane: string; s: number }> }

const STEP = 1 / 30;
const SEAT_RE = /chair|stool|bench|seat|chaise|tabouret|banc/i;

function rngFor(id: string) {
  let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

export class Simulation {
  readonly root = new THREE.Group();
  /** the shared clock (seconds of simulated time) */
  t = 0;
  running = true;
  people: Person[] = [];
  vehicles: Vehicle[] = [];
  seats: Seat[] = [];
  lanes: Lane[] = [];
  private crowd: Crowd | null = null;
  private nav: Navigation | null = null;
  private actorAgent: CrowdAgent | null = null;
  private acc = 0;
  private generation = 0;

  constructor(private registry: AssetRegistry, private runtime: AssemblyRuntime) { this.root.name = 'simulation'; }

  get stats() {
    return { t: +this.t.toFixed(2), people: this.people.length, vehicles: this.vehicles.length, seats: this.seats.length, occupied: this.seats.filter((s) => s.occupant).length, lanes: this.lanes.length,
      phases: this.people.reduce<Record<string, number>>((m, p) => { m[p.phase] = (m[p.phase] ?? 0) + 1; return m; }, {}), stoppedVehicles: this.vehicles.filter((v) => v.stopped).length };
  }

  dispose() {
    this.generation++;
    for (const p of this.people) p.mixer?.stopAllAction();
    this.root.clear();
    this.crowd?.destroy(); this.crowd = null; this.actorAgent = null;
    this.people = []; this.vehicles = []; this.seats = []; this.lanes = [];
  }

  /** (re)build from the document and the current navigation; state of agents that still exist is kept */
  async rebuild(doc: WorldDocument, nav: Navigation, objects: Map<string, THREE.Object3D>, restore?: SimSnapshot | null) {
    const prev = restore ?? (this.people.length || this.vehicles.length ? this.snapshot() : null);
    this.dispose();
    const gen = this.generation;
    this.nav = nav;
    if (prev) this.t = prev.t;
    const sims = doc.entities.filter((e) => (e.metadata?.sim as SimMeta | undefined)?.kind && e.assetId);
    this.collectSeats(doc, objects);
    this.collectLanes(doc);
    if (!sims.length) return;
    this.crowd = new Crowd(nav.navMesh, { maxAgents: Math.max(8, sims.length + 4), maxAgentRadius: 0.6 });
    this.actorAgent = this.crowd.addAgent({ x: 0, y: -1000, z: 0 }, { radius: 0.35, height: 1.8, maxSpeed: 0, maxAcceleration: 0, separationWeight: 0 });
    for (const e of sims) {
      const meta = e.metadata!.sim as SimMeta;
      try {
        const asset = await this.registry.loadGLTF(e.assetId!);
        if (gen !== this.generation) return;
        if (meta.kind === 'vehicle') this.addVehicle(e, this.registry.instantiate(asset), prev?.vehicles[e.id]);
        else if (meta.kind === 'person') this.addPerson(e, meta, asset, prev?.people[e.id]);
      } catch (err) { console.warn('[sim]', e.id, err); }
    }
  }

  // ------------------------------------------------------------------ world data
  private collectSeats(doc: WorldDocument, objects: Map<string, THREE.Object3D>) {
    for (const e of doc.entities) {
      if (e.type !== 'SET') continue;
      const def = this.runtime.setOf(e); if (!def) continue;
      const hidden = new Set((e.metadata?.set as { hiddenMembers?: string[] }).hiddenMembers ?? []);
      const m = matrixOf(e);
      for (const mem of def.members) {
        if (hidden.has(mem.id) || mem.lod === 'LOD' || mem.lod === 'SLOD' || !SEAT_RE.test(mem.resource)) continue;
        const p = new THREE.Vector3(...mem.position).applyMatrix4(m);
        const q = new THREE.Quaternion(...e.transform.rotation).multiply(new THREE.Quaternion(...mem.quaternion));
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
        const approach = this.nav?.closest(p.clone().addScaledVector(fwd, 0.45)) ?? this.nav?.closest(p);
        if (!approach || approach.distanceTo(p) > 1.2) continue; // a seat nobody can reach is not offered
        this.seats.push({ id: `${e.id}/${mem.id}`, position: p, approach, heading: Math.atan2(-fwd.x, -fwd.z), placement: e.id, occupant: null });
      }
    }
    void objects;
  }

  private collectLanes(doc: WorldDocument) {
    for (const e of doc.entities) {
      if (e.type !== 'SET') continue;
      const def = this.runtime.setOf(e); if (!def) continue;
      const m = matrixOf(e);
      for (const r of def.roads) {
        const pts = r.points.map((p) => new THREE.Vector3(...p).applyMatrix4(m));
        let length = 0; for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
        if (length > 1) this.lanes.push({ id: `${e.id}/${r.id}`, points: pts, length });
      }
    }
  }

  // ------------------------------------------------------------------ people
  private addPerson(e: Entity, meta: SimMeta, asset: Awaited<ReturnType<AssetRegistry['loadGLTF']>>, saved?: SimSnapshot['people'][string]) {
    const obj = this.registry.instantiate(asset);
    obj.traverse((o) => { o.userData.entityId = e.id; if ((o as THREE.SkinnedMesh).isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; } });
    const holder = new THREE.Group(); holder.name = e.name; holder.add(obj); this.root.add(holder);
    const clips = characterClips(asset.gltf.animations);
    const mixer = clips.walk ? new THREE.AnimationMixer(obj) : null;
    const walk = clips.walk && mixer ? mixer.clipAction(clips.walk) : undefined;
    const idle = clips.idle && mixer ? mixer.clipAction(clips.idle) : undefined;
    idle?.play();
    const start = saved ? new THREE.Vector3(...saved.p) : this.nav!.closest(new THREE.Vector3(...e.transform.position)) ?? new THREE.Vector3(...e.transform.position);
    const agent = this.crowd!.addAgent(start, { radius: 0.3, height: 1.7, maxSpeed: 1.25, maxAcceleration: 6, collisionQueryRange: 2.5, pathOptimizationRange: 8, separationWeight: 1.5 });
    const p: Person = { id: e.id, behavior: meta.behavior, home: meta.home, area: meta.area, agent, obj: holder, mixer, walk, idle, clipSpeed: 1.3,
      phase: 'idle', plan: [], until: 0, target: null, seat: null, stuck: 0, repaths: 0, rng: rngFor(e.id), heading: 0 };
    if (saved) {
      p.phase = saved.phase; p.plan = saved.plan; p.until = saved.until;
      const seat = saved.seat ? this.seats.find((s) => s.id === saved.seat && !s.occupant) : null;
      if (seat) { seat.occupant = p.id; p.seat = seat; }
      if (p.phase === 'walk') p.phase = 'idle'; // re-plan the leg from where it stood
    }
    holder.position.copy(start);
    this.people.push(p);
  }

  private homeOf(p: Person) { return this.placement(p.home); }
  private placementEntities: Map<string, Entity> = new Map();
  setDocument(doc: WorldDocument) { this.placementEntities = new Map(doc.entities.filter((e) => e.type === 'SET').map((e) => [e.id, e])); }
  private placement(id: string) { return this.placementEntities.get(id) ?? null; }

  /** inside / outside points of a person's door (connector `area`, else the home's first door) */
  private doorPoints(p: Person) {
    const e = this.homeOf(p); const def = e ? this.runtime.setOf(e) : null;
    if (!e || !def) return null;
    const c = def.connectors.find((x) => x.id === p.area || x.id.endsWith(`/${p.area}`)) ?? def.connectors.find((x) => x.kind === 'door');
    if (!c) return null;
    const w = worldConnector(e, c);
    const inside = this.nav!.closest(w.p.clone().addScaledVector(w.n, -2.2)), outside = this.nav!.closest(w.p.clone().addScaledVector(w.n, 2.5));
    return inside && outside ? { inside, outside, normal: w.n } : null;
  }

  private randomNear(p: Person, centre: THREE.Vector3, radius: number) {
    const r = this.nav!.query.findRandomPointAroundCircle(centre, radius);
    if (r.success) return v3(r.randomPoint);
    const a = p.rng() * Math.PI * 2;
    return this.nav!.closest(centre.clone().add(new THREE.Vector3(Math.cos(a) * radius * 0.5, 0, Math.sin(a) * radius * 0.5)));
  }

  /** next leg of a person's routine */
  private plan(p: Person): void {
    const home = this.homeOf(p);
    const centre = home ? new THREE.Vector3(...home.transform.position) : v3(p.agent.position());
    if (!p.plan.length) {
      if (p.behavior === 'customer') p.plan = ['outside', 'inside', 'seat', 'stay', 'outside', 'away', 'pause'];
      else if (p.behavior === 'sit') p.plan = ['seat', 'sitforever'];
      else if (p.behavior === 'wander') p.plan = ['away', 'pause'];
      else { p.phase = 'idle'; return; }
    }
    const step = p.plan.shift()!;
    const door = this.doorPoints(p);
    const go = (to: THREE.Vector3 | null): void => { if (!to) return this.plan(p); p.target = to; p.phase = 'walk'; p.stuck = 0; p.repaths = 0; p.agent.requestMoveTarget(to); };
    switch (step) {
      case 'outside': return go(door?.outside ?? this.randomNear(p, centre, 6));
      case 'inside': return go(door?.inside ?? null);
      case 'seat': {
        if (p.seat) return go(p.seat.approach);
        const pos = v3(p.agent.position());
        const free = this.seats.filter((s) => !s.occupant && (s.placement === p.home || p.behavior === 'sit')).sort((a, b) => a.approach.distanceTo(pos) - b.approach.distanceTo(pos))[0];
        if (!free) { p.plan.unshift('stand'); return this.plan(p); } // all seats taken: wait standing
        free.occupant = p.id; p.seat = free;
        return go(free.approach);
      }
      case 'stand': p.phase = 'wait'; p.until = this.t + 4 + p.rng() * 4; p.target = null; return;
      case 'stay': p.phase = p.seat ? 'seated' : 'wait'; p.until = this.t + 8 + p.rng() * 10; return;
      case 'sitforever': p.phase = p.seat ? 'seated' : 'idle'; p.until = Infinity; return;
      case 'away': { if (p.seat) { p.seat.occupant = null; p.seat = null; } return go(this.randomNear(p, door?.outside ?? centre, 14)); }
      case 'pause': p.phase = 'wait'; p.until = this.t + 3 + p.rng() * 5; return;
      default: return this.plan(p);
    }
  }

  // ------------------------------------------------------------------ vehicles
  private addVehicle(e: Entity, obj: THREE.Object3D, saved?: SimSnapshot['vehicles'][string]) {
    obj.traverse((o) => { o.userData.entityId = e.id; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    const holder = new THREE.Group(); holder.name = e.name; holder.add(obj); this.root.add(holder);
    const at = new THREE.Vector3(...e.transform.position);
    const lane = (saved && this.lanes.find((l) => l.id === saved.lane)) ?? [...this.lanes].sort((a, b) => a.points[0].distanceTo(at) - b.points[0].distanceTo(at))[0];
    if (!lane) { holder.position.copy(at); return; } // no lane in the place: parked
    const rng = rngFor(e.id);
    this.vehicles.push({ id: e.id, obj: holder, lane, s: saved?.s ?? rng() * lane.length * 0.5, speed: 0, cruise: 7 + rng() * 3, stopped: false, rng });
  }

  private laneAt(l: Lane, s: number) {
    let d = s;
    for (let i = 1; i < l.points.length; i++) {
      const seg = l.points[i].distanceTo(l.points[i - 1]);
      if (d <= seg) { const p = l.points[i - 1].clone().lerp(l.points[i], d / seg); return { p, dir: l.points[i].clone().sub(l.points[i - 1]).normalize() }; }
      d -= seg;
    }
    const n = l.points.length;
    return { p: l.points[n - 1].clone(), dir: l.points[n - 1].clone().sub(l.points[n - 2]).normalize() };
  }

  /** lane continuing this one: a lane of the assembly starting where this one ends (joined streets), else the return lane */
  private nextLane(v: Vehicle) {
    const end = v.lane.points[v.lane.points.length - 1];
    const dir = this.laneAt(v.lane, v.lane.length).dir;
    const onward = this.lanes.filter((l) => l !== v.lane && l.points[0].distanceTo(end) < 16 && l.points[1].clone().sub(l.points[0]).normalize().dot(dir) > 0.5);
    if (onward.length) return onward[Math.floor(v.rng() * onward.length)];
    return [...this.lanes].filter((l) => l !== v.lane).sort((a, b) => a.points[0].distanceTo(end) - b.points[0].distanceTo(end))[0] ?? v.lane;
  }

  // ------------------------------------------------------------------ clock
  update(dt: number, actor?: { position: THREE.Vector3; velocity?: THREE.Vector3 } | null) {
    if (!this.running || (!this.people.length && !this.vehicles.length)) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) { this.acc -= STEP; this.step(STEP, actor); }
  }

  /** one fixed step; deterministic for the same document, snapshot and actor path */
  step(dt: number, actor?: { position: THREE.Vector3; velocity?: THREE.Vector3 } | null) {
    this.t += dt;
    if (this.actorAgent && actor) this.actorAgent.teleport(actor.position);
    for (const p of this.people) {
      if (p.phase === 'idle' && p.behavior !== 'idle') this.plan(p);
      else if ((p.phase === 'wait' || p.phase === 'seated') && this.t >= p.until) this.plan(p);
    }
    this.crowd?.update(dt);
    for (const p of this.people) {
      const pos = v3(p.agent.position()), vel = v3(p.agent.velocity());
      const speed = Math.hypot(vel.x, vel.z);
      if (p.phase === 'walk' && p.target) {
        const left = Math.hypot(p.target.x - pos.x, p.target.z - pos.z);
        if (left < 0.45) { p.agent.resetMoveTarget(); p.phase = 'idle'; p.target = null; if (p.plan[0] === 'stay' || p.plan[0] === 'sitforever' || p.plan[0] === 'pause') this.plan(p); }
        else if (speed < 0.08) {
          // blocked (another agent, the actor, a door): wait, then ask for a new path, then give up on this leg
          p.stuck += dt;
          if (p.stuck > 2.5) { p.stuck = 0; p.repaths++; if (p.repaths > 2) { p.agent.resetMoveTarget(); p.phase = 'wait'; p.until = this.t + 2; p.plan = []; if (p.seat) { p.seat.occupant = null; p.seat = null; } } else p.agent.requestMoveTarget(p.target); }
        } else p.stuck = 0;
      }
      if (p.phase === 'seated' && p.seat) { pos.copy(p.seat.approach); p.heading = p.seat.heading; }
      else if (speed > 0.15) p.heading += Math.atan2(Math.sin(Math.atan2(vel.x, vel.z) - p.heading), Math.cos(Math.atan2(vel.x, vel.z) - p.heading)) * Math.min(1, dt * 10);
      p.obj.position.copy(pos); p.obj.rotation.y = p.heading;
      if (p.walk && p.idle) {
        const moving = speed > 0.2;
        p.walk.enabled = true; p.idle.enabled = true;
        p.walk.setEffectiveWeight(moving ? 1 : 0); p.idle.setEffectiveWeight(moving ? 0 : 1);
        if (moving && !p.walk.isRunning()) p.walk.play();
        p.walk.timeScale = moving ? speed / p.clipSpeed : 1;
      }
      p.mixer?.update(dt);
    }
    // vehicles: follow the lane, brake for anything ahead (other vehicles, pedestrians, the actor)
    const blockers = [...this.people.map((p) => p.obj.position), ...this.vehicles.map((v) => v.obj.position), ...(actor ? [actor.position] : [])];
    for (const v of this.vehicles) {
      const { p, dir } = this.laneAt(v.lane, v.s);
      let clear = Infinity;
      for (const b of blockers) {
        if (b === v.obj.position) continue;
        const d = b.clone().sub(p); d.y = 0;
        const ahead = d.dot(dir), side = Math.abs(d.x * dir.z - d.z * dir.x);
        if (ahead > 0 && ahead < clear && side < 1.6) clear = ahead;
      }
      const want = clear < 4 ? 0 : clear < 12 ? v.cruise * (clear - 4) / 8 : v.cruise;
      v.speed += THREE.MathUtils.clamp(want - v.speed, -8 * dt, 3 * dt);
      v.stopped = v.speed < 0.1 && want === 0;
      v.s += v.speed * dt;
      if (v.s >= v.lane.length) { const n = this.nextLane(v); v.s = n === v.lane ? 0 : Math.max(0, v.s - v.lane.length); v.lane = n; }
      const at = this.laneAt(v.lane, v.s);
      v.obj.position.copy(at.p); v.obj.rotation.y = Math.atan2(at.dir.x, at.dir.z);
    }
  }

  snapshot(): SimSnapshot {
    return {
      t: this.t,
      people: Object.fromEntries(this.people.map((p) => [p.id, { p: p.obj.position.toArray() as [number, number, number], phase: p.phase, plan: p.plan, until: Number.isFinite(p.until) ? p.until : 1e9, seat: p.seat?.id ?? null }])),
      vehicles: Object.fromEntries(this.vehicles.map((v) => [v.id, { lane: v.lane.id, s: v.s }])),
    };
  }
}
