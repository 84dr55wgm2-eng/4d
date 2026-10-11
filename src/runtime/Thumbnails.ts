import * as THREE from 'three';
import { idb } from '../storage/idb';

/** Renders a real preview of a loaded asset once, stores it in IndexedDB (no generated placeholders). */
export class Thumbnails {
  private cache = new Map<string, string>();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private target = new THREE.WebGLRenderTarget(160, 160, { colorSpace: THREE.SRGBColorSpace, samples: 4 });

  constructor(private renderer: THREE.WebGLRenderer, environment: THREE.Texture | null) {
    this.scene.environment = environment;
    this.scene.background = new THREE.Color(0x2a2d35);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 2);
    this.scene.add(key);
  }

  async preload(ids: string[]) {
    for (const id of ids) {
      const url = await idb.get<string>('settings', `thumb:${id}`).catch(() => undefined);
      if (url) this.cache.set(id, url);
    }
  }

  get(id: string) {
    return this.cache.get(id);
  }

  async make(id: string, template: THREE.Object3D, version: string) {
    if (this.cache.has(id)) return this.cache.get(id)!;
    const obj = template.clone(true);
    this.scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const d = r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.95;
    this.camera.position.copy(c).add(new THREE.Vector3(0.75, 0.45, 1).normalize().multiplyScalar(d));
    this.camera.lookAt(c);
    this.camera.near = d / 50;
    this.camera.far = d * 4;
    this.camera.updateProjectionMatrix();
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    const px = new Uint8Array(160 * 160 * 4);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, 160, 160, px);
    this.renderer.setRenderTarget(prev);
    this.scene.remove(obj);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 160;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(160, 160);
    for (let y = 0; y < 160; y++) img.data.set(px.subarray((159 - y) * 640, (160 - y) * 640), y * 640); // flip Y
    ctx.putImageData(img, 0, 0);
    const url = cv.toDataURL('image/webp', 0.85);
    this.cache.set(id, url);
    idb.put('settings', `thumb:${id}`, url).catch(() => {});
    void version;
    return url;
  }
}
