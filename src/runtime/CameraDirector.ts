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
  followPitch = 0.12;
  followDistance = 3.4;
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
      if (pinch > 0 && distance > 0) this.followDistance = THREE.MathUtils.clamp(this.followDistance * pinch / distance, 1.4, 9);
      pinch = distance;
    });
    const release = (e: PointerEvent) => { touches.delete(e.pointerId); pinch = 0; };
    window.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('wheel', (e) => {
      if (this.mode === 'follow') this.followDistance = THREE.MathUtils.clamp(this.followDistance * (1 + Math.sign(e.deltaY) * 0.1), 1.4, 9);
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

  private updateFollow(dt: number) {
    this.followYaw += angleDiff(this.followHeading + Math.PI, this.followYaw) * (1 - Math.exp(-Math.min(dt, 0.1) * 5));
    const pivot = _w.copy(this.followPivot);
    // right-shoulder framing
    const right = _dir.set(Math.cos(this.followYaw), 0, -Math.sin(this.followYaw));
    pivot.addScaledVector(right, 0.32);
    const cp = Math.cos(this.followPitch);
    _v.set(Math.sin(this.followYaw) * cp, Math.sin(this.followPitch), Math.cos(this.followYaw) * cp);
    let dist = this.followDistance;
    if (this.collision) dist = Math.min(dist, Math.max(0.6, this.collision.rayDistance(pivot, _v, dist + 0.3) - 0.3));
    const desired = _v.multiplyScalar(dist).add(pivot);
    const k = 1 - Math.exp(-dt * 14);
    this.camera.position.lerp(desired, k);
    this.camera.lookAt(pivot);
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
