import * as THREE from 'three';
import type { CollisionWorld } from './CollisionWorld';

/**
 * Hero actor locomotion.
 * - Root motion is stripped from the clips (hips XZ) and replaced by controller velocity.
 * - Walk/jog are phase-synchronised and their playback rate is derived from the actual ground speed
 *   divided by the clip's measured stride, so the feet stay planted (no "ice skating").
 * - Facing turns toward the movement direction with a capped angular speed; large turns at low speed
 *   become step-turns (walk cycle at low rate) instead of spinning on the spot.
 */
export interface LocomotionClip {
  clip: THREE.AnimationClip;
  /** metres per second at timeScale 1 (measured from the stripped root motion) */
  speed: number;
}

export interface ActorClips {
  idle: THREE.AnimationClip;
  walk: LocomotionClip;
  run: LocomotionClip;
}

export type ActorState = 'idle' | 'walk' | 'run' | 'turn' | 'stop' | 'sit';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _push = new THREE.Vector3();

/** Remove horizontal root translation from a clip; returns metres travelled per cycle. */
export function stripRootMotion(clip: THREE.AnimationClip, rootBone = 'Hips'): number {
  const track = clip.tracks.find((t) => t.name === `${rootBone}.position`);
  if (!track) return 0;
  const v = track.values;
  const n = v.length / 3;
  const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
  const x0 = v[0], z0 = v[2];
  for (let i = 0; i < n; i++) {
    v[i * 3] = x0;
    v[i * 3 + 2] = z0;
  }
  return Math.hypot(dx, dz);
}

export class Actor {
  readonly root = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private run: THREE.AnimationAction;
  private phase = 0;
  seated = false;
  private seatBones: { bone: THREE.Bone; rotation: THREE.Quaternion }[] = [];

  /** world-space heading (radians, 0 = +Z) */
  heading = 0;
  speed = 0;
  state: ActorState = 'idle';
  /** desired planar velocity direction (unit) and magnitude, set by input or path follower */
  desiredDir = new THREE.Vector3();
  desiredSpeed = 0;
  /** heading to face when standing still (turnActorTo) */
  targetHeading: number | null = null;
  path: THREE.Vector3[] = [];
  onArrive?: () => void;
  onCancel?: () => void;
  radius = 0.28;
  height = 1.8;
  walkSpeed: number;
  runSpeed: number;

  constructor(model: THREE.Object3D, readonly clips: ActorClips, public collision: CollisionWorld | null = null) {
    this.root.name = 'actor';
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.idle = this.mixer.clipAction(clips.idle);
    this.walk = this.mixer.clipAction(clips.walk.clip);
    this.run = this.mixer.clipAction(clips.run.clip);
    for (const a of [this.idle, this.walk, this.run]) {
      a.play();
      a.setEffectiveWeight(0);
    }
    this.idle.setEffectiveWeight(1);
    this.walk.timeScale = 0;
    this.run.timeScale = 0;
    this.walkSpeed = clips.walk.speed;
    this.runSpeed = clips.run.speed;
  }

  get position() { return this.root.position; }

  place(p: THREE.Vector3, heading = this.heading) {
    this.stand();
    this.cancelPath();
    this.root.position.copy(p);
    this.heading = heading;
    this.speed = 0;
    this.path = [];
    this.snapToGround(true);
    this.root.rotation.y = heading;
  }

  setPath(points: THREE.Vector3[], speed: number, onArrive?: () => void) {
    this.cancelPath();
    this.path = points.slice();
    this.desiredSpeed = speed;
    this.targetHeading = null;
    this.onArrive = onArrive;
  }

  sit(anchor: THREE.Vector3, heading: number) {
    this.stand(); this.cancelPath();
    this.speed = 0; this.targetHeading = null;
    this.idle.setEffectiveWeight(1); this.walk.setEffectiveWeight(0); this.run.setEffectiveWeight(0);
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const hips = this.root.getObjectByName('Hips');
    const hipOffset = hips ? hips.getWorldPosition(new THREE.Vector3()).y - this.position.y : 0.95;
    this.position.copy(anchor); this.position.y += 0.10 - hipOffset;
    this.heading = heading; this.root.rotation.y = heading;
    this.root.updateMatrixWorld(true);
    const aim = (name: string, childName: string, desired: THREE.Vector3) => {
      const bone = this.root.getObjectByName(name) as THREE.Bone | undefined;
      const child = this.root.getObjectByName(childName);
      if (!bone || !child) return;
      this.seatBones.push({ bone, rotation: bone.quaternion.clone() });
      const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      const world = bone.getWorldQuaternion(new THREE.Quaternion());
      world.premultiply(new THREE.Quaternion().setFromUnitVectors(from, desired));
      const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      bone.quaternion.copy(parent.multiply(world));
      this.root.updateMatrixWorld(true);
    };
    const forward = new THREE.Vector3(Math.sin(heading), -0.12, Math.cos(heading)).normalize();
    for (const side of ['Left', 'Right']) {
      aim(`${side}UpLeg`, `${side}Leg`, forward);
      aim(`${side}Leg`, `${side}Foot`, new THREE.Vector3(0, -1, 0));
    }
    this.seated = true; this.state = 'sit';
  }

  stand() {
    if (!this.seated) return;
    for (const { bone, rotation } of this.seatBones) bone.quaternion.copy(rotation);
    this.seatBones = []; this.seated = false; this.state = 'idle';
  }

  cancelPath() {
    const cancel = this.onCancel;
    this.onCancel = undefined;
    this.onArrive = undefined;
    this.path = [];
    this.desiredSpeed = 0;
    this.desiredDir.set(0, 0, 0);
    cancel?.();
  }

  update(dt: number) {
    dt = Math.min(dt, 1 / 20);
    if (this.seated) { this.state = 'sit'; return; }

    // --- path following (directed movement)
    if (this.path.length) {
      const next = this.path[0];
      _v.set(next.x - this.position.x, 0, next.z - this.position.z);
      const d = _v.length();
      const last = this.path.length === 1;
      if (d < (last ? 0.15 : 0.5)) {
        this.path.shift();
        if (!this.path.length) {
          this.desiredSpeed = 0;
          this.desiredDir.set(0, 0, 0);
          const arrive = this.onArrive;
          this.onArrive = undefined;
          this.onCancel = undefined;
          arrive?.();
        }
      } else {
        this.desiredDir.copy(_v.multiplyScalar(1 / d));
        // slow down on approach so the stop lands on the target instead of overshooting
        if (last) this.desiredSpeed = Math.min(this.desiredSpeed, Math.max(0.6, d * 1.4));
      }
    }

    const wantMove = this.desiredSpeed > 0.05 && this.desiredDir.lengthSq() > 0.01;
    let turnRate = THREE.MathUtils.lerp(4.5, 2.6, THREE.MathUtils.clamp(this.speed / this.runSpeed, 0, 1));
    let targetSpeed = wantMove ? this.desiredSpeed : 0;
    let goalHeading = this.heading;
    let turningInPlace = false;

    if (wantMove) {
      goalHeading = Math.atan2(this.desiredDir.x, this.desiredDir.z);
      const err = Math.abs(angleDiff(goalHeading, this.heading));
      // Big direction change from (near) standstill: step-turn first, then accelerate.
      if (err > 1.2 && this.speed < 0.9) {
        targetSpeed = 0.25;
        turningInPlace = true;
        turnRate = 3.2;
      } else if (err > 0.6) {
        targetSpeed *= 0.55;
      }
    } else if (this.targetHeading !== null) {
      goalHeading = this.targetHeading;
      if (Math.abs(angleDiff(goalHeading, this.heading)) > 0.05) {
        turningInPlace = true;
        turnRate = 3.2;
      } else this.targetHeading = null;
    }

    const diff = angleDiff(goalHeading, this.heading);
    this.heading += THREE.MathUtils.clamp(diff, -turnRate * dt, turnRate * dt);

    const accel = targetSpeed > this.speed ? 3.2 : 5.5;
    this.speed = moveToward(this.speed, targetSpeed, accel * dt);

    // --- integrate along facing (characters move where they face)
    if (this.speed > 0.001 && !turningInPlace) {
      _v.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(this.speed * dt);
      this.position.add(_v);
    }
    this.resolveCollisions();
    this.snapToGround(false, dt);
    this.root.rotation.y = this.heading;

    // --- state + animation blend
    const s = turningInPlace ? Math.max(this.speed, 0.6) : this.speed;
    this.state = turningInPlace ? 'turn' : s < 0.05 ? 'idle' : !wantMove ? 'stop' : s > (this.walkSpeed + this.runSpeed) / 2 ? 'run' : 'walk';
    this.blend(s, dt);
    this.mixer.update(dt);
  }

  private blend(s: number, dt: number) {
    const W = this.clips.walk, R = this.clips.run;
    let wIdle = 0, wWalk = 0, wRun = 0;
    if (s <= 0.05) wIdle = 1;
    else if (s < W.speed * 0.6) { const t = (s - 0.05) / (W.speed * 0.6 - 0.05); wIdle = 1 - t; wWalk = t; }
    else if (s <= W.speed) wWalk = 1;
    else if (s < R.speed) { const t = (s - W.speed) / (R.speed - W.speed); wWalk = 1 - t; wRun = t; }
    else wRun = 1;

    // stride-matched cycle frequency (cycles/s) from the blended stride length
    const strideW = W.speed * W.clip.duration, strideR = R.speed * R.clip.duration;
    const stride = (wWalk + wRun) > 0 ? (wWalk * strideW + wRun * strideR) / (wWalk + wRun) : strideW;
    const freq = Math.max(s, 0.35) / stride;
    this.phase = (this.phase + freq * dt) % 1;
    this.walk.time = this.phase * W.clip.duration;
    this.run.time = this.phase * R.clip.duration;

    const k = 1 - Math.exp(-dt * 12);
    this.idle.setEffectiveWeight(THREE.MathUtils.lerp(this.idle.getEffectiveWeight(), wIdle, k));
    this.walk.setEffectiveWeight(THREE.MathUtils.lerp(this.walk.getEffectiveWeight(), wWalk, k));
    this.run.setEffectiveWeight(THREE.MathUtils.lerp(this.run.getEffectiveWeight(), wRun, k));
  }

  /** dynamic obstacles (closed doors, moved furniture) in world space */
  blockers: () => THREE.Box3[] = () => [];

  private resolveBlockers() {
    for (const b of this.blockers()) {
      if (this.position.y + this.height < b.min.y || this.position.y > b.max.y) continue;
      const cx = THREE.MathUtils.clamp(this.position.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(this.position.z, b.min.z, b.max.z);
      const dx = this.position.x - cx, dz = this.position.z - cz, d = Math.hypot(dx, dz);
      if (d >= this.radius) continue;
      if (d > 1e-5) { this.position.x = cx + (dx / d) * this.radius; this.position.z = cz + (dz / d) * this.radius; }
      else {
        // centre inside the box: leave by the nearest face
        const opts = [[b.min.x - this.radius - this.position.x, 0], [b.max.x + this.radius - this.position.x, 0], [0, b.min.z - this.radius - this.position.z], [0, b.max.z + this.radius - this.position.z]];
        opts.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
        this.position.x += opts[0][0]; this.position.z += opts[0][1];
      }
    }
  }

  private resolveCollisions() {
    this.resolveBlockers();
    if (!this.collision) return;
    for (let i = 0; i < 3; i++) {
      _a.set(this.position.x, this.position.y + this.radius + 0.35, this.position.z);
      _b.set(this.position.x, this.position.y + this.height - this.radius, this.position.z);
      if (!this.collision.resolveCapsule(_a, _b, this.radius, _push)) break;
      this.position.x += _push.x;
      this.position.z += _push.z;
    }
  }

  private groundY = 0;
  private snapToGround(hard: boolean, dt = 0) {
    if (!this.collision) return;
    const g = this.collision.groundHeight(this.position, 0.45, 4);
    if (g === null) return;
    if (hard) this.groundY = g;
    else this.groundY = g > this.groundY ? g : THREE.MathUtils.lerp(this.groundY, g, 1 - Math.exp(-dt * 20));
    this.position.y = this.groundY;
  }

  /** world-space head position (for cameras / look-at) */
  headPosition(out = new THREE.Vector3()) {
    return out.copy(this.position).addScaledVector(UP, 1.62);
  }
}

export function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function moveToward(v: number, t: number, step: number) {
  return v < t ? Math.min(t, v + step) : Math.max(t, v - step);
}
