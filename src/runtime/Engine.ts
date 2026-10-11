import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type Quality = 'auto' | 'high' | 'balanced';

interface Budget {
  pixelRatio: number;
  shadowMapSize: number;
  shadowExtent: number;
  ao: boolean;
}

// Same world, different budget (lesson from playgta5 quality profiles): never swap content.
const BUDGETS: Record<Exclude<Quality, 'auto'>, Budget> = {
  high: { pixelRatio: Math.min(devicePixelRatio, 2), shadowMapSize: 4096, shadowExtent: 34, ao: true },
  balanced: { pixelRatio: Math.min(devicePixelRatio, 1.25), shadowMapSize: 2048, shadowExtent: 26, ao: false },
};

export interface FrameStats {
  fps: number;
  frameMs: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/** Renderer, scene, lighting, quality budget and the frame loop. Knows nothing about UI. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  camera!: THREE.PerspectiveCamera;
  quality: Quality = 'auto';
  effective: Exclude<Quality, 'auto'> = matchMedia('(pointer: coarse)').matches ? 'balanced' : 'high';
  stats: FrameStats = { fps: 0, frameMs: 0, calls: 0, triangles: 0, geometries: 0, textures: 0 };
  /** point the shadow frustum follows (actor / camera focus) */
  shadowFocus = new THREE.Vector3();
  private composer?: EffectComposer;
  private sky?: Sky;
  private aoPass?: GTAOPass;
  private updaters: ((dt: number) => void)[] = [];
  private clock = new THREE.Timer();
  private frames = 0;
  private acc = 0;
  private slowFrames = 0;
  private sunDir = new THREE.Vector3(0.5, 0.6, 0.4).normalize();
  frameCount = 0;
  /** set by systems that move shadow casters (actor, gizmo, document edits) */
  shadowsDirty = true;
  shadowUpdates = 0;
  /** automation: stop the realtime loop; frames are produced by renderOnce() */
  paused = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('capture') });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.info.autoReset = false;

    this.sun = new THREE.DirectionalLight(0xffe2c0, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    // Static world: re-render the shadow map only when something that casts has moved.
    this.sun.shadow.autoUpdate = false;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a4a3a, 0.15);
    this.scene.add(this.hemi);
  }

  onUpdate(fn: (dt: number) => void) {
    this.updaters.push(fn);
    return () => { this.updaters = this.updaters.filter((u) => u !== fn); };
  }

  async loadEnvironment(hdrUrl: string, sun: { azimuth: number; elevation: number; intensity: number }, exposure: number) {
    const hdr = await new HDRLoader().loadAsync(hdrUrl);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();
    const az = THREE.MathUtils.degToRad(sun.azimuth), el = THREE.MathUtils.degToRad(sun.elevation);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.setSun(sun.azimuth, sun.elevation, sun.intensity);
    // Background: physical atmosphere matching the sun (the HDRI's ground/sea must not show past street ends).
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);
    this.sun.intensity = sun.intensity;
    this.renderer.toneMappingExposure = exposure;
  }

  setSun(azimuthDeg: number, elevationDeg: number, intensity = this.sun.intensity) {
    const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevationDeg);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.sun.intensity = intensity;
    // warmer and softer as the sun gets lower
    const warm = THREE.MathUtils.clamp(1 - (elevationDeg - 8) / 50, 0, 1);
    this.sun.color.setRGB(1, THREE.MathUtils.lerp(0.97, 0.8, warm), THREE.MathUtils.lerp(0.92, 0.62, warm));
    this.sky?.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.shadowsDirty = true;
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.applyBudget(q === 'auto' ? this.effective : q);
  }

  private applyBudget(level: Exclude<Quality, 'auto'>) {
    this.effective = level;
    const b = BUDGETS[level];
    this.renderer.setPixelRatio(b.pixelRatio);
    const s = this.sun.shadow;
    this.shadowsDirty = true;
    if (s.mapSize.x !== b.shadowMapSize) {
      s.mapSize.set(b.shadowMapSize, b.shadowMapSize);
      s.map?.dispose();
      s.map = null as never;
    }
    const cam = s.camera;
    cam.left = cam.bottom = -b.shadowExtent;
    cam.right = cam.top = b.shadowExtent;
    cam.near = 1;
    cam.far = 220;
    cam.updateProjectionMatrix();
    if (this.aoPass) this.aoPass.enabled = b.ao;
    this.resize();
  }

  setCamera(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, camera));
    this.aoPass = new GTAOPass(this.scene, camera, 1, 1);
    this.aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
    this.aoPass.blendIntensity = 0.75;
    this.composer.addPass(this.aoPass);
    this.composer.addPass(new OutputPass());
    this.applyBudget(this.effective);
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      // a lens is a focal length: keep it constant when the film aspect changes
      if (this.camera.userData.lensMm) this.camera.setFocalLength(this.camera.userData.lensMm);
      this.camera.updateProjectionMatrix();
    }
  }

  start() {
    this.clock.connect(document);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    this.clock.update();
    const dt = this.clock.getDelta();
    if (this.paused) return;
    for (const u of this.updaters) u(dt);
    this.render(dt);
  }

  /** Simulate without rendering (deterministic automation / tests). */
  step(seconds: number, dt = 1 / 60) {
    for (let t = 0; t < seconds - 1e-6; t += dt) for (const u of this.updaters) u(dt);
  }

  renderOnce() {
    this.render(1 / 60);
  }

  private render(dt: number) {
    // shadow frustum follows the focus point, snapped to texels to avoid shimmering
    const b = BUDGETS[this.effective];
    const texel = (b.shadowExtent * 2) / b.shadowMapSize;
    const f = this.shadowFocus;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    if (fx !== this.sun.target.position.x || fz !== this.sun.target.position.z) this.shadowsDirty = true;
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.set(fx, f.y, fz).addScaledVector(this.sunDir, 120);
    if (this.shadowsDirty) {
      this.sun.shadow.needsUpdate = true;
      this.shadowsDirty = false;
      this.shadowUpdates++;
    }
    this.renderer.info.reset();
    if (this.composer && b.ao) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.frameCount++;

    const info = this.renderer.info;
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.stats = {
        fps: Math.round(this.frames / this.acc), frameMs: +((this.acc / this.frames) * 1000).toFixed(1),
        calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      };
      // AUTO: drop to the balanced budget when the frame rate stays low (never swap content)
      if (this.quality === 'auto') {
        this.slowFrames = this.stats.fps < 40 ? this.slowFrames + 1 : 0;
        if (this.slowFrames >= 6 && this.effective === 'high') this.applyBudget('balanced');
      }
      this.frames = 0;
      this.acc = 0;
    }
  }
}
