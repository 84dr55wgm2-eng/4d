import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetCategory, AssetRecord, ContentManifest, EntityType } from '../core/types';
import { ContentCache } from '../storage/ContentCache';
import { idb } from '../storage/idb';
import { discoverFiles, embeddedGLTF, unpackUpload } from './AssetResources';

export interface RemoteAssetResult {
  id: string;
  title: string;
  type: string;
  url: string;
  downloadable?: boolean;
  score?: number;
  tags?: string[];
  thumbnail?: string;
  thumbnailUrl?: string;
  formats?: string[];
  description?: string;
  provider?: string;
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
  /** reads `pkg://<packageId>/<file>` from the browser's package store (prepared content, never fetched) */
  packageReader?: (url: string) => Promise<ArrayBuffer>;
  /**
   * Three levels are kept apart: the persistent byte cache (OPFS/IDB, survives reloads), parsed models in memory
   * (`loaded`), and visible instances (counted by retain/release). A model nobody retains any more is dropped
   * from memory after a grace period; its bytes stay in the persistent cache for a fast reload.
   */
  private refs = new Map<string, number>();
  private evictTimers = new Map<string, ReturnType<typeof setTimeout>>();
  evictAfterMs = 15000;

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
    return /^(https?:|user:|pkg:)/.test(a.url) ? a.url : `${this.baseUrl}${a.url.replace(/^\//, '')}`;
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
    return (data.results ?? []).filter((r) => r.downloadable !== false).map((r) => ({ ...r, thumbnail: r.thumbnailUrl ?? r.thumbnail }));
  }

  /** Register a remote result as a normal AssetRecord so cache/load/place use one pipeline. */
  async registerRemote(r: RemoteAssetResult): Promise<AssetRecord> {
    const id = `remote.${safeId(r.id)}`;
    const existing = this.manifest.assets.find((a) => a.id === id || a.sourceUrl === r.url);
    if (existing) {
      if (existing.url.includes('/download?')) {
        const descriptor = await discoverFiles(r.id, r.formats), root = descriptor.files[0];
        existing.url = root.url; existing.format = root.filename.toLowerCase().endsWith('.gltf') ? 'gltf' : 'glb';
        (existing.runtime ??= {}).resources = root.includes ?? [];
        existing.thumbnail = r.thumbnailUrl ?? r.thumbnail;
        this.loaded.delete(existing.id);
        await this.persistRecords();
      }
      await this.loadGLTF(existing.id);
      return existing;
    }
    const entityType = inferEntityType(r.title, r.tags);
    const descriptor = await discoverFiles(r.id, r.formats);
    const root = descriptor.files[0];
    const provider = r.id.includes(':') ? r.id.split(':', 1)[0] : '3d-asset-server';
    const record: AssetRecord = {
      id,
      name: r.title,
      category: categoryFor(entityType),
      source: `3D Asset Server · ${provider}`,
      sourceUrl: r.url,
      url: root.url,
      format: root.filename.toLowerCase().endsWith('.gltf') ? 'gltf' : 'glb',
      thumbnail: r.thumbnailUrl ?? r.thumbnail,
      bytes: root.sizeBytes,
      license: {
        id: descriptor.license?.name ?? r.license?.name ?? 'See source',
        attribution: r.license?.attributionRequired ? 'Attribution required — see source asset page' : undefined,
        verified: !!r.license?.name,
        notes: 'Discovered through 3d-asset-server; verify the selected asset before commercial publishing.',
      },
      tags: [...new Set([...(r.tags ?? []), ...r.title.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)])],
      entityType,
      runtime: { remoteAssetId: r.id, resources: root.includes ?? [], description: r.description, interaction: entityType === 'LIGHT' ? { toggleable: true, enabled: true } : undefined },
    };
    this.manifest.assets.push(record);
    try { const loaded = await this.loadGLTF(id); record.bounds = loaded.size.toArray() as AssetRecord['bounds']; } catch (e) {
      this.manifest.assets = this.manifest.assets.filter((a) => a.id !== id);
      throw new Error(`Import impossible pour ${r.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await this.persistRecords();
    return record;
  }

  async persistRecords() {
    await idb.put('settings', 'external-assets', this.manifest.assets.filter((a) => /^(remote|user|import)\./.test(a.id)));
  }

  async importFile(file: File, unitsToMetres = 1): Promise<AssetRecord> {
    if (!(unitsToMetres > 0 && unitsToMetres <= 100)) throw new Error('Échelle invalide');
    const bytes = await file.arrayBuffer();
    unpackUpload(bytes, file.name); // Reject incomplete formats before persisting.
    const id = `user.${crypto.randomUUID()}`;
    const record: AssetRecord = { id, name: file.name.replace(/\.(glb|zip)$/i, ''), category: 'ENVIRONMENT', entityType: 'ENVIRONMENT',
      source: 'Fichier fourni', sourceUrl: file.name, url: `user:${id}`, format: 'glb', bytes: bytes.byteLength,
      license: { id: 'Licence du fichier fourni', verified: false }, tags: ['imported', 'world'], scale: { unitsToMetres },
      runtime: { uploadKey: `upload:${id}`, filename: file.name, preserveOrigin: true } };
    await idb.put('settings', String(record.runtime!.uploadKey), bytes);
    this.manifest.assets.push(record);
    try { await this.loadGLTF(id); await this.persistRecords(); return record; }
    catch (error) { this.manifest.assets = this.manifest.assets.filter((a) => a.id !== id); await idb.del('settings', String(record.runtime!.uploadKey)); throw error; }
  }

  async importWorldURL(raw: string, unitsToMetres = 1): Promise<AssetRecord> {
    if (!(unitsToMetres > 0 && unitsToMetres <= 100)) throw new Error('Échelle invalide');
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL HTTP/HTTPS publique requise');
    const id = `user.${crypto.randomUUID()}`;
    const bytes = await this.cache.fetch(url.href, this.version);
    if (bytes.byteLength > 200*1024*1024) throw new Error('Import limité à 200 Mo');
    const binary = bytes.byteLength >= 4 && new DataView(bytes).getUint32(0, true) === 0x46546c67;
    const resources: { path: string; url: string }[] = [];
    if (!binary) {
      const doc = JSON.parse(new TextDecoder().decode(bytes));
      if (doc.asset?.version !== '2.0') throw new Error('Cette URL ne renvoie pas un modèle glTF 2.0');
      for (const object of [...(doc.buffers ?? []), ...(doc.images ?? [])]) {
        if (object.uri && !object.uri.startsWith('data:')) resources.push({path:decodeURIComponent(object.uri), url:new URL(object.uri, url).href});
      }
    }
    const record: AssetRecord = {id, name:decodeURIComponent(url.pathname.split('/').pop() || 'Monde importé').replace(/\.(glb|gltf)$/i,''),
      category:'ENVIRONMENT',entityType:'ENVIRONMENT', source:'URL de monde fournie',sourceUrl:url.href,url:url.href,format:binary?'glb':'gltf',
      license:{id:'Licence du fichier source',verified:false}, tags:['world','imported'],scale:{unitsToMetres},runtime:{resources,preserveOrigin:true}};
    this.manifest.assets.push(record);
    try { await this.loadGLTF(id); await this.persistRecords(); return record; }
    catch(error) { this.manifest.assets=this.manifest.assets.filter((a)=>a.id!==id); throw error; }
  }

  async worldSource(id: string): Promise<AssetRecord> {
    const source = this.get(id), key = `import.${id}`;
    const existing = this.manifest.assets.find((a) => a.id === key);
    if (existing) return existing;
    const record: AssetRecord = { ...structuredClone(source), id: key, entityType: 'ENVIRONMENT', category: 'ENVIRONMENT',
      scale: { unitsToMetres: source.scale?.unitsToMetres ?? 1 }, runtime: { ...source.runtime, preserveOrigin: true } };
    this.manifest.assets.push(record);
    await this.loadGLTF(key); await this.persistRecords(); return record;
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
        const sourceId = record.runtime?.sourceAssetId as string | undefined;
        if (sourceId) {
          const source = await this.loadGLTF(sourceId, onProgress);
          const wanted = new Set(record.runtime?.sourceNodes as number[]);
          const scene = new THREE.Group();
          source.template.updateMatrixWorld(true);
          source.gltf.scene.traverse((obj) => {
            const assoc = source.gltf.parser.associations.get(obj) as { nodes?: number } | undefined;
            if (assoc?.nodes === undefined || !wanted.has(assoc.nodes)) return;
            const copy = obj.clone(true);
            obj.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
            scene.add(copy);
          });
          if (!scene.children.length) throw new Error(`No authored nodes for ${id}`);
          const template = this.normalize(record, scene);
          const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
          const out = { record, gltf: source.gltf, template, size };
          this.onLoaded?.(out);
          return out;
        }
        const url = this.resolveUrl(record);
        let gltf: GLTF;
        if (record.runtime?.uploadKey) {
          const bytes = await idb.get<ArrayBuffer>('settings', String(record.runtime.uploadKey));
          if (!bytes) throw new Error('Le fichier importé n’est plus disponible dans ce navigateur');
          const archive = unpackUpload(bytes, String(record.runtime.filename));
          gltf = await this.loader.parseAsync(archive.binary ? archive.root.slice().buffer : embeddedGLTF(archive.root, archive.resources), '');
        } else if (record.format === 'gltf' && record.runtime?.resources) {
          const buf = await this.cache.fetch(url, this.version, onProgress);
          const resources: Record<string, Uint8Array> = {};
          let totalBytes = buf.byteLength;
          const companions = record.runtime.resources as { path: string; url: string }[];
          // Bound concurrent decoding/downloads rather than creating an unbounded request fan-out.
          for (let i=0; i<companions.length; i+=4) await Promise.all(companions.slice(i,i+4).map(async (f) => {
            resources[f.path] = new Uint8Array(await this.cache.fetch(f.url, this.version));
            totalBytes += resources[f.path].byteLength;
            if (totalBytes > 200 * 1024 * 1024) throw new Error('Import et dépendances limités à 200 Mo');
          }));
          gltf = await this.loader.parseAsync(embeddedGLTF(new Uint8Array(buf), resources), '');
        } else if (url.startsWith('pkg://')) {
          if (!this.packageReader) throw new Error('Paquets indisponibles dans ce navigateur');
          gltf = await this.loader.parseAsync(await this.packageReader(url), '');
        } else {
          const buf = await this.cache.fetch(url, this.version, onProgress);
          gltf = await this.loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
        }
        const template = this.normalize(record, gltf.scene);
        const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
        record.bounds = size.toArray() as AssetRecord['bounds'];
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
    // kit files (Poly Haven modular sets): keep one assembled preset, preserving relative placement
    const prefix = record.runtime?.keepPrefix as string | undefined;
    if (prefix) {
      scene.updateMatrixWorld(true);
      const picked: THREE.Object3D[] = [];
      scene.traverse((o) => { if (o.name.startsWith(prefix) && !picked.some((p) => o.parent && isDescendant(o, p))) picked.push(o); });
      if (!picked.length) throw new Error(`${record.name}: aucun élément « ${prefix} » dans le fichier`);
      const matrices = picked.map((o) => o.matrixWorld.clone());
      scene.clear();
      picked.forEach((o, i) => { o.removeFromParent(); matrices[i].decompose(o.position, o.quaternion, o.scale); scene.add(o); });
      scene.position.set(0, 0, 0); scene.quaternion.identity(); scene.scale.set(1, 1, 1);
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
    if (record.entityType !== 'ENVIRONMENT' && !record.runtime?.preserveOrigin) {
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

  retain(id: string) {
    this.refs.set(id, (this.refs.get(id) ?? 0) + 1);
    const t = this.evictTimers.get(id);
    if (t) { clearTimeout(t); this.evictTimers.delete(id); }
  }

  release(id: string) {
    const n = (this.refs.get(id) ?? 0) - 1;
    if (n > 0) { this.refs.set(id, n); return; }
    this.refs.delete(id);
    if (this.evictTimers.has(id)) return;
    this.evictTimers.set(id, setTimeout(() => { this.evictTimers.delete(id); if (!this.refs.has(id)) void this.evict(id); }, this.evictAfterMs));
  }

  /** drop a parsed model from memory (GPU buffers + textures); derived/variant models never dispose shared data */
  private async evict(id: string) {
    const p = this.loaded.get(id);
    if (!p) return;
    const record = this.manifest.assets.find((a) => a.id === id);
    const isSource = [...this.loaded.keys()].some((k) => this.manifest.assets.find((a) => a.id === k)?.runtime?.sourceAssetId === id);
    if (!record || isSource || record.entityType === 'ACTOR' || record.entityType === 'ENVIRONMENT') return;
    const asset = await p.catch(() => null);
    if (this.refs.has(id)) return;
    this.loaded.delete(id);
    if (!asset || record.runtime?.sourceAssetId) return;
    const textures = new Set<THREE.Texture>();
    asset.gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
        mat.dispose();
      }
    });
    textures.forEach((t) => t.dispose());
    this.memoryEvicted++;
  }

  memoryEvicted = 0;
  /** persistent cache vs memory vs instance references (diagnostics) */
  memoryStats() {
    return { inMemory: this.loaded.size, referenced: this.refs.size, instances: [...this.refs.values()].reduce((a, b) => a + b, 0), evicted: this.memoryEvicted, pendingEviction: this.evictTimers.size };
  }

  instantiate(asset: LoadedAsset): THREE.Object3D {
    let skinned = false;
    asset.template.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
    const copy = skinned ? cloneSkinned(asset.template) : asset.template.clone(true);
    // Stateful props must own their material; switching one lamp cannot switch all its clones.
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
    return copy;
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

function isDescendant(o: THREE.Object3D, ancestor: THREE.Object3D) {
  for (let p = o.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}
