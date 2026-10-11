import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetCategory, AssetRecord, ContentManifest, EntityType } from '../core/types';
import { ContentCache } from '../storage/ContentCache';
import { idb } from '../storage/idb';

export interface RemoteAssetResult {
  id: string;
  title: string;
  type: string;
  url: string;
  downloadable?: boolean;
  score?: number;
  tags?: string[];
  thumbnail?: string;
  license?: { name?: string; attributionRequired?: boolean; commercialUse?: boolean };
}

export interface LoadedAsset {
  record: AssetRecord;
  gltf: GLTF;
  /** normalized template: real-world metres, pivot at bottom-centre */
  template: THREE.Object3D;
  size: THREE.Vector3;
}

/**
 * SEARCH -> PREVIEW -> SELECT -> FETCH -> NORMALIZE -> CACHE -> PLACE.
 * V1 searches the local manifest; remote providers (3d-asset-server style) can plug into `find` later.
 */
export class AssetRegistry {
  manifest!: ContentManifest;
  readonly cache = new ContentCache();
  private loader: GLTFLoader;
  private loaded = new Map<string, Promise<LoadedAsset>>();
  /** called whenever an asset finishes loading (thumbnails, diagnostics) */
  onLoaded?: (asset: LoadedAsset) => void;

  constructor(private baseUrl = import.meta.env.BASE_URL) {
    MeshoptDecoder.useWorkers?.(Math.min(4, navigator.hardwareConcurrency || 2));
    const draco = new DRACOLoader().setDecoderPath(`${baseUrl}vendor/draco/`);
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(draco);
  }

  /** KTX2 needs the renderer to pick a GPU transcode target. */
  setRenderer(renderer: THREE.WebGLRenderer) {
    const ktx2 = new KTX2Loader().setTranscoderPath(`${this.baseUrl}vendor/basis/`).detectSupport(renderer);
    this.loader.setKTX2Loader(ktx2);
  }

  async init() {
    const res = await fetch(`${this.baseUrl}content/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    this.manifest = await res.json();
    // User-discovered assets survive reloads without changing the checked-in manifest.
    const external = await idb.get<AssetRecord[]>('settings', 'external-assets').catch(() => undefined);
    if (external?.length) {
      const known = new Set(this.manifest.assets.map((a) => a.id));
      for (const a of external) if (!known.has(a.id)) this.manifest.assets.push(a);
    }
    // optional: split-file index written by tools/package_artifact.mjs for hosts with a per-file size cap
    const parts = await fetch(`${this.baseUrl}content/parts.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    this.cache.parts = parts;
    await this.cache.refreshStatuses(this.manifest.assets.map((a) => this.resolveUrl(a)), this.manifest.version);
  }

  get version() { return this.manifest.version; }

  resolveUrl(a: AssetRecord) {
    return /^https?:/.test(a.url) ? a.url : `${this.baseUrl}${a.url.replace(/^\//, '')}`;
  }

  get(id: string) {
    const r = this.manifest.assets.find((a) => a.id === id);
    if (!r) throw new Error(`unknown asset ${id}`);
    return r;
  }

  /** Deterministic search: tokens must all match name/tags/category. */
  find(query = '', category?: AssetCategory): AssetRecord[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.manifest.assets.filter((a) => {
      if (category && a.category !== category) return false;
      const hay = `${a.name} ${a.category} ${a.tags.join(' ')} ${a.source}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }

  status(id: string) {
    return this.cache.status(this.resolveUrl(this.get(id)));
  }

  /**
   * Live multi-source discovery through 3d-asset-server.
   * Search stays separate from placement; a selected result is promoted into the normal registry.
   */
  async searchRemote(query: string, limit = 18): Promise<RemoteAssetResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const u = new URL('https://3d.shep.bot/v1/search');
    u.searchParams.set('q', q);
    u.searchParams.set('type', 'model');
    u.searchParams.set('free', 'true');
    u.searchParams.set('downloadable', 'true');
    u.searchParams.set('limit', String(Math.max(1, Math.min(30, limit))));
    const res = await fetch(u, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`asset search HTTP ${res.status}`);
    const data = await res.json() as { results?: RemoteAssetResult[] };
    return (data.results ?? []).filter((r) => r.downloadable !== false);
  }

  /** Register a remote result as a normal AssetRecord so cache/load/place use one pipeline. */
  async registerRemote(r: RemoteAssetResult): Promise<AssetRecord> {
    const id = `remote.${safeId(r.id)}`;
    const existing = this.manifest.assets.find((a) => a.id === id || a.sourceUrl === r.url);
    if (existing) return existing;
    const entityType = inferEntityType(r.title, r.tags);
    const provider = r.id.includes(':') ? r.id.split(':', 1)[0] : '3d-asset-server';
    const record: AssetRecord = {
      id,
      name: r.title,
      category: categoryFor(entityType),
      source: `3D Asset Server · ${provider}`,
      sourceUrl: r.url,
      url: `https://3d.shep.bot/v1/assets/${encodeURIComponent(r.id)}/download?format=glb&resolution=1k`,
      format: 'glb',
      license: {
        id: r.license?.name || 'See source',
        attribution: r.license?.attributionRequired ? 'Attribution required — see source asset page' : undefined,
        verified: !!r.license?.name,
        notes: 'Discovered through 3d-asset-server; verify the selected asset before commercial publishing.',
      },
      tags: [...new Set([...(r.tags ?? []), ...r.title.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)])],
      entityType,
      runtime: { remoteAssetId: r.id, interaction: entityType === 'LIGHT' ? { toggleable: true, enabled: true } : undefined },
    };
    this.manifest.assets.push(record);
    await idb.put('settings', 'external-assets', this.manifest.assets.filter((a) => a.id.startsWith('remote.')));
    return record;
  }

  async fetchBytes(id: string, onProgress?: (l: number, t: number) => void) {
    const rec = this.get(id);
    return this.cache.fetch(this.resolveUrl(rec), this.version, onProgress);
  }

  loadGLTF(id: string, onProgress?: (l: number, t: number) => void): Promise<LoadedAsset> {
    let p = this.loaded.get(id);
    if (!p) {
      p = (async () => {
        const record = this.get(id);
        const url = this.resolveUrl(record);
        const buf = await this.cache.fetch(url, this.version, onProgress);
        const gltf = await this.loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
        const template = this.normalize(record, gltf.scene);
        const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
        const out = { record, gltf, template, size };
        this.onLoaded?.(out);
        return out;
      })();
      p.catch(() => this.loaded.delete(id));
      this.loaded.set(id, p);
    }
    return p;
  }

  /** Real-world scale + bottom-centre pivot, so placement is "drop on ground". */
  private normalize(record: AssetRecord, scene: THREE.Object3D) {
    const root = new THREE.Group();
    root.name = record.id;
    // Props never bring their own lights/cameras into the world; optionally keep only named nodes
    // (e.g. one object out of a multi-object sample scene).
    const keep = record.runtime?.keepNodes as string[] | undefined;
    if (keep?.length) {
      const picked = keep.map((n) => scene.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      scene.clear();
      for (const o of picked) {
        o.removeFromParent();
        o.position.set(0, o.position.y, 0);
        scene.add(o);
      }
    }
    if (record.entityType !== 'ENVIRONMENT') {
      const strip: THREE.Object3D[] = [];
      scene.traverse((o) => { if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) strip.push(o); });
      strip.forEach((o) => o.removeFromParent());
    }
    const s = record.scale?.unitsToMetres ?? 1;
    scene.scale.multiplyScalar(s);
    scene.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(scene);
    if (record.scale?.targetHeight) {
      const h = box.getSize(new THREE.Vector3()).y;
      if (h > 0) scene.scale.multiplyScalar(record.scale.targetHeight / h);
      scene.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(scene);
    }
    // Environments keep their authored origin: baked collision/navmesh share that coordinate frame.
    if (record.entityType !== 'ENVIRONMENT') {
      const c = box.getCenter(new THREE.Vector3());
      scene.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    }
    root.add(scene);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return root;
  }

  instantiate(asset: LoadedAsset): THREE.Object3D {
    let skinned = false;
    asset.template.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
    return skinned ? cloneSkinned(asset.template) : asset.template.clone(true);
  }
}


function safeId(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function inferEntityType(title: string, tags: string[] = []): EntityType {
  const s = `${title} ${tags.join(' ')}`.toLowerCase();
  if (/\b(building|house|shop|store|cafe|restaurant|apartment|office|garage|warehouse|architecture)\b/.test(s)) return 'BUILDING';
  if (/\b(chair|seat|stool)\b/.test(s)) return 'CHAIR';
  if (/\b(table|desk|sofa|couch|bed|cabinet|shelf|furniture)\b/.test(s)) return 'FURNITURE';
  if (/\b(car|truck|bus|bike|bicycle|vehicle|van|taxi)\b/.test(s)) return 'VEHICLE';
  if (/\b(tree|plant|bush|flower|vegetation|palm)\b/.test(s)) return 'VEGETATION';
  if (/\b(lamp|lantern|light)\b/.test(s)) return 'LIGHT';
  if (/\b(door|gate)\b/.test(s)) return 'DOOR';
  return 'PROP';
}

function categoryFor(type: EntityType): AssetCategory {
  if (type === 'BUILDING' || type === 'DOOR') return 'ARCHITECTURE';
  if (type === 'CHAIR' || type === 'FURNITURE') return 'FURNITURE';
  if (type === 'VEHICLE') return 'VEHICLES';
  if (type === 'VEGETATION') return 'VEGETATION';
  return 'PROPS';
}
