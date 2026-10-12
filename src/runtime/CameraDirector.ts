import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Emitter } from '../core/emitter';
import type { CameraShot } from '../core/types';
import type { CollisionWorld } from './CollisionWorld';
import { angleDiff } from './Actor';

export type CameraMode = 'follow' | 'free' | 'director';
export const LENSES = [24, 35, 50, 85] as const;

type Events = { change: { mode: CameraMode; focalLength: number } };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _ahead = new THREE.Vector3();
const _u = new THREE.Vector3();

/** What the follow camera needs to know about the space around the actor (provided by the Studio). */
export interface FollowContext {
  /** end of the actor's current path (null when standing) */
  destination: THREE.Vector3 | null;
  /** planar velocity of the actor, m/s */
  velocity: THREE.Vector3;
  /** room the actor stands in: world-space floor corners (rectangle, in order) and ceiling height */
  room: { corners: THREE.Vector3[]; ceilingY: number } | null;
}

/** Framing profile: camera distance, elevation, over-the-shoulder offset, lens and look height. */
interface Framing { dist: number; pitch: number; side: number; lens: number; look: number; lead: number }
/** Exterior: actor ~1/3 of frame height at 35 mm, street and destination readable ahead. */
const EXTERIOR: Framing = { dist: 5.4, pitch: 0.2, side: 0.55, lens: 35, look: 1.4, lead: 3.5 };
/** Interior: closer but higher and wider, so the room and the target furniture stay in frame. */
const INTERIOR: Framing = { dist: 3.6, pitch: 0.36, side: 0.35, lens: 24, look: 1.15, lead: 1.6 };
/** yaw offsets tried around "behind the actor" when the ideal position is obstructed */
const YAW_TRIES = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];

/**
 * EXPLORE (follow) / FREE / DIRECT cameras on one PerspectiveCamera.
 * Lens is expressed as a full-frame focal length (filmGauge 36 mm), the language a director uses.
 */
export class CameraDirector extends Emitter<Events> {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'follow';
  /** world point the follow camera orbits (updated from the actor every frame) */
  followPivot = new THREE.Vector3();
  followYaw = Math.PI; // behind the actor
  followHeading = 0;
  /** user zoom factor on the automatic framing distance (pinch / wheel) */
  followZoom = 1;
  /** provider of the actor's surroundings; without it the camera frames as exterior */
  followContext: (() => FollowContext) | null = null;
  /** current smoothed framing + chosen yaw offset (hysteresis), exposed for diagnostics */
  readonly framing: Framing = { ...EXTERIOR };
  private yawOffset = 0;
  /** last framing kind, for HUD/tests */
  framingKind: 'exterior' | 'interior' = 'exterior';
  /** director: point of interest provider (e.g. the actor's head) */
  lookAtProvider: (() => THREE.Vector3 | null) | null = null;

  private orbit: OrbitControls;
  private transition: { from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; fromF: number; toF: number; t: number; dur: number } | null = null;
  collision: CollisionWorld | null = null;

  constructor(dom: HTMLElement) {
    super();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1500);
    this.camera.filmGauge = 36;
    this.camera.setFocalLength(35);
    this.camera.userData.lensMm = 35;
    this.orbit = new OrbitControls(this.camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.screenSpacePanning = true;
    this.orbit.enabled = false;
    this.orbit.maxPolarAngle = Math.PI * 0.97;

    const touches = new Map<number, THREE.Vector2>();
    let pinch = 0;
    dom.addEventListener('pointerdown', (e) => { touches.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY)); pinch = 0; });
    dom.addEventListener('pointermove', (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
      if (this.mode !== 'follow' || touches.size !== 2) return;
      const [a, b] = [...touches.values()];
      const distance = a.distanceTo(b);
      if (pinch > 0 && distance > 0) this.followZoom = THREE.MathUtils.clamp(this.followZoom * pinch / distance, 0.45, 2.2);
      pinch = distance;
    });
    const release = (e: PointerEvent) => { touches.delete(e.pointerId); pinch = 0; };
    window.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('wheel', (e) => {
      if (this.mode === 'follow') this.followZoom = THREE.MathUtils.clamp(this.followZoom * (1 + Math.sign(e.deltaY) * 0.1), 0.45, 2.2);
    }, { passive: true });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get focalLength() { return Math.round(this.camera.userData.lensMm ?? this.camera.getFocalLength()); }

  setLens(mm: number) {
    this.camera.userData.lensMm = mm;
    this.camera.setFocalLength(mm);
    this.camera.updateProjectionMatrix();
    this.emit('change', { mode: this.mode, focalLength: mm });
  }

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.transition = null;
    this.orbit.enabled = mode !== 'follow';
    if (mode !== 'follow') {
      // orbit around what we are looking at (actor if near the view centre, else 8 m ahead)
      const p = this.lookAtProvider?.();
      this.camera.getWorldDirection(_dir);
      this.orbit.target.copy(p && p.distanceTo(this.camera.position) < 25 ? p : _v.copy(this.camera.position).addScaledVector(_dir, 8));
      this.orbit.update();
    }
    if (mode === 'follow') this.setLens(35);
    this.emit('change', { mode, focalLength: this.focalLength });
  }

  /** Director pose as plain data (saveShot). */
  currentShot(): Omit<CameraShot, 'id' | 'name'> {
    const target = this.mode === 'director' ? this.orbit.target.clone() : this.camera.getWorldDirection(_dir).multiplyScalar(8).add(this.camera.position);
    return {
      position: this.camera.position.toArray() as CameraShot['position'],
      target: target.toArray() as CameraShot['target'],
      focalLength: this.focalLength,
    };
  }

  /** Move to a shot (animated), entering director mode. */
  goTo(shot: Pick<CameraShot, 'position' | 'target' | 'focalLength'>, duration = 0.9) {
    this.setMode('director');
    const toT = new THREE.Vector3(...shot.target);
    this.transition = {
      from: this.camera.position.clone(), fromT: this.orbit.target.clone(),
      to: new THREE.Vector3(...shot.position), toT,
      fromF: this.focalLength, toF: shot.focalLength, t: 0, dur: duration,
    };
    if (duration <= 0) this.transition.t = 1;
  }

  lookAt(p: THREE.Vector3) {
    if (this.mode !== 'director') this.setMode('director');
    this.transition = null;
    this.orbit.target.copy(p);
    this.orbit.update();
  }

  setPose(position: THREE.Vector3, target: THREE.Vector3) {
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    if (this.mode !== 'follow') { this.orbit.target.copy(target); this.orbit.update(); }
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number) {
    if (this.mode === 'follow') this.updateFollow(dt);
    else if (this.mode === 'free') this.orbit.update(dt);
    else this.updateDirector(dt);
  }

  /** Jump straight to the automatic framing (world load, mode change): same computation as the live follow. */
  snapFollow() {
    this.followYaw = this.followHeading + Math.PI;
    this.yawOffset = 0;
    this.updateFollow(1, true);
  }

  /**
   * Automatic follow framing. `followPivot` is the actor's feet. The profile (exterior / interior) is smoothed,
   * candidate positions around "behind the actor" are probed against collision now and ~0.6 s ahead, the best
   * clear one is kept with hysteresis, and the final interpolated position is checked again so it never ends
   * up behind a wall.
   */
  private updateFollow(dt: number, snap = false) {
    const ctx = this.followContext?.() ?? null;
    const room = ctx?.room ?? null;
    const goal = room ? INTERIOR : EXTERIOR;
    this.framingKind = room ? 'interior' : 'exterior';
    const kp = snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 2.5);
    for (const key of Object.keys(goal) as (keyof Framing)[]) this.framing[key] += (goal[key] - this.framing[key]) * kp;
    const f = this.framing;
    if (Math.abs(this.focalLength - f.lens) > 0.4 || snap) {
      this.camera.setFocalLength(f.lens); this.camera.userData.lensMm = f.lens; this.camera.updateProjectionMatrix();
    }
    // heading the camera sits behind: actor heading, turned toward the destination while walking
    let heading = this.followHeading;
    const feet = this.followPivot;
    if (ctx?.destination) {
      const dx = ctx.destination.x - feet.x, dz = ctx.destination.z - feet.z;
      if (dx * dx + dz * dz > 2.2) heading += angleDiff(Math.atan2(dx, dz), heading) * 0.35;
    }
    const ky = snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    this.followYaw += angleDiff(heading + Math.PI, this.followYaw) * ky;

    // look point: chest height + lead toward where the actor is going
    const look = _look.copy(feet); look.y += f.look;
    const fwd = _ahead.set(Math.sin(heading), 0, Math.cos(heading));
    let lead = f.lead;
    if (ctx?.destination) lead = Math.min(lead, Math.max(0.5, Math.hypot(ctx.destination.x - feet.x, ctx.destination.z - feet.z) * 0.5));
    const want = f.dist * this.followZoom;

    // probe candidates; the anticipated look point uses the actor's velocity
    const future = _probe.copy(look);
    if (ctx) future.addScaledVector(ctx.velocity, 0.6);
    let best = this.yawOffset, bestScore = -Infinity, bestClear = want;
    for (const off of YAW_TRIES) {
      const yaw = this.followYaw + off;
      const dir = this.offsetDir(yaw, f.pitch, _v);
      let clear = this.clearance(look, dir, want);
      if (ctx && ctx.velocity.lengthSq() > 0.04) clear = Math.min(clear, this.clearance(future, dir, want));
      clear = Math.min(clear, this.roomLimit(look, dir, want, room));
      const score = Math.min(clear, want) / want - 0.22 * Math.abs(off) + (Math.abs(off - this.yawOffset) < 1e-3 ? 0.12 : 0);
      if (score > bestScore) { bestScore = score; best = off; bestClear = clear; }
    }
    this.yawOffset += (best - this.yawOffset) * (snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 3));
    const yaw = this.followYaw + this.yawOffset;
    let dist = Math.max(1.3, Math.min(want, bestClear));
    // when the space forces the camera close, crane up rather than filling the frame with the actor's back
    const squeeze = 1 - dist / want;
    const pitch = f.pitch + Math.max(0, squeeze) * 0.45;
    const dir = this.offsetDir(yaw, pitch, _dir);
    dist = Math.max(1.1, Math.min(dist, this.clearance(look, dir, dist), this.roomLimit(look, dir, dist, room)));
    const right = _w.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const desired = _v.copy(look).addScaledVector(dir, dist).addScaledVector(right, f.side * (1 - Math.max(0, squeeze) * 0.6));
    if (room) desired.y = Math.min(desired.y, room.ceilingY - 0.3);

    const k = snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 6);
    this.camera.position.lerp(desired, k);
    // final check after interpolation: the segment look → camera must stay clear
    const seg = _w.subVectors(this.camera.position, look);
    const len = seg.length();
    if (len > 1e-3 && this.collision) {
      seg.divideScalar(len);
      const hit = this.collision.rayDistance(look, seg, len + 0.25);
      if (hit < len + 0.2) this.camera.position.copy(look).addScaledVector(seg, Math.max(0.3, hit - 0.25));
    }
    const target = look.addScaledVector(fwd, lead).addScaledVector(right.set(Math.cos(yaw), 0, -Math.sin(yaw)), f.side * 0.4);
    this.camera.lookAt(target);
  }

  private offsetDir(yaw: number, pitch: number, out: THREE.Vector3) {
    const cp = Math.cos(pitch);
    return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
  }

  /** free distance from `from` along `dir`, keeping 0.3 m from surfaces */
  private clearance(from: THREE.Vector3, dir: THREE.Vector3, want: number) {
    if (!this.collision) return want;
    return this.collision.rayDistance(from, dir, want + 0.35) - 0.3;
  }

  /** distance along dir before leaving the room rectangle (0.3 m inside its walls) */
  private roomLimit(from: THREE.Vector3, dir: THREE.Vector3, want: number, room: FollowContext['room']) {
    if (!room) return want;
    const [c0, c1, , c3] = room.corners;
    const u = _u.subVectors(c1, c0); const lu = u.length(); u.divideScalar(lu);
    const vx = c3.x - c0.x, vz = c3.z - c0.z, lv = Math.hypot(vx, vz);
    const px = from.x - c0.x, pz = from.z - c0.z;
    const fu = px * u.x + pz * u.z, fv = (px * vx + pz * vz) / lv;
    const du = dir.x * u.x + dir.z * u.z, dv = (dir.x * vx + dir.z * vz) / lv;
    let t = want;
    const m = 0.3;
    if (du > 1e-4) t = Math.min(t, (lu - m - fu) / du); else if (du < -1e-4) t = Math.min(t, (m - fu) / du);
    if (dv > 1e-4) t = Math.min(t, (lv - m - fv) / dv); else if (dv < -1e-4) t = Math.min(t, (m - fv) / dv);
    return Math.max(0, t);
  }

  private updateDirector(dt: number) {
    const tr = this.transition;
    if (tr) {
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = tr.t < 0.5 ? 4 * tr.t ** 3 : 1 - (-2 * tr.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(tr.from, tr.to, e);
      this.orbit.target.lerpVectors(tr.fromT, tr.toT, e);
      this.camera.setFocalLength(THREE.MathUtils.lerp(tr.fromF, tr.toF, e));
      this.camera.userData.lensMm = this.camera.getFocalLength();
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.orbit.target);
      if (tr.t >= 1) {
        this.transition = null;
        this.emit('change', { mode: this.mode, focalLength: this.focalLength });
      }
      return;
    }
    if (this.trackTarget && this.lookAtProvider) {
      const p = this.lookAtProvider();
      if (p) this.orbit.target.lerp(p, 1 - Math.exp(-dt * 6));
    }
    this.orbit.update(dt);
  }

  /** director: continuously keep the look-at provider (actor) framed */
  trackTarget = false;

  get orbitTarget() { return this.orbit.target; }

  setOrbitEnabled(on: boolean) {
    this.orbit.enabled = on && this.mode !== 'follow';
  }
}
