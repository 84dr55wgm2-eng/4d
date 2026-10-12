import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { idb } from '../storage/idb';
import type { CwsPackage } from './package';

/**
 * Prepared packages in the viewer's own browser (environment C): imported from a .cwspkg file, a folder, or a
 * private URL (e.g. the owner's conversion service), never published by the site. Files go to OPFS; when OPFS is
 * missing (some private modes, older Safari) they go to IndexedDB. Archives are unzipped as a stream, entry by
 * entry, so a multi-gigabyte package never sits whole in memory. Storage quota is checked before writing.
 */
export type StorageBackend = 'opfs' | 'indexeddb';
export interface StoredPackage { id: string; name: string; source: CwsPackage['source']; importedAt: string; bytes: number; backend: StorageBackend; sets: number; resources: number }
export interface ImportProgress { phase: 'checking' | 'writing' | 'indexing' | 'done'; file?: string; bytes: number; total?: number }

const INDEX_KEY = 'packages';
const enc = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');

export class PackageStore {
  private opfs: Promise<FileSystemDirectoryHandle | null>;
  private manifests = new Map<string, CwsPackage>();
  private urls = new Map<string, string>();

  constructor() {
    this.opfs = (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('packages', { create: true });
        // a real write probe: some browsers expose the API but refuse writes (private windows)
        const probe = await dir.getFileHandle('.probe', { create: true });
        const w = await probe.createWritable(); await w.write(new Uint8Array([1])); await w.close();
        await dir.removeEntry('.probe');
        return dir;
      } catch { return null; }
    })();
  }

  async backend(): Promise<StorageBackend> { return (await this.opfs) ? 'opfs' : 'indexeddb'; }

  /** quota as the browser reports it, and whether storage is persistent (not evicted under pressure) */
  async storage() {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    return { usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted: !!persisted, backend: await this.backend() };
  }

  async list(): Promise<StoredPackage[]> { return (await idb.get<StoredPackage[]>('settings', INDEX_KEY)) ?? []; }

  async manifest(id: string): Promise<CwsPackage> {
    let m = this.manifests.get(id);
    if (!m) { m = JSON.parse(new TextDecoder().decode(await this.read(id, 'package.json'))) as CwsPackage; this.manifests.set(id, m); }
    return m;
  }

  async read(id: string, file: string): Promise<ArrayBuffer> {
    const dir = await this.opfs;
    if (dir) {
      const pd = await dir.getDirectoryHandle(enc(id));
      return (await (await pd.getFileHandle(enc(file))).getFile()).arrayBuffer();
    }
    const blob = await idb.get<Blob>('packageFiles', `${id}/${file}`);
    if (!blob) throw new Error(`Fichier absent du paquet ${id} : ${file}`);
    return blob.arrayBuffer();
  }

  /** object URL for a package file (thumbnails, previews) — revoked on remove */
  async url(id: string, file: string) {
    const k = `${id}/${file}`;
    if (!this.urls.has(k)) this.urls.set(k, URL.createObjectURL(new Blob([await this.read(id, file)])));
    return this.urls.get(k)!;
  }

  async remove(id: string) {
    const dir = await this.opfs;
    if (dir) await dir.removeEntry(enc(id), { recursive: true }).catch(() => undefined);
    for (const k of (await idb.keys('packageFiles')).map(String)) if (k.startsWith(`${id}/`)) await idb.del('packageFiles', k);
    for (const [k, u] of this.urls) if (k.startsWith(`${id}/`)) { URL.revokeObjectURL(u); this.urls.delete(k); }
    this.manifests.delete(id);
    await idb.put('settings', INDEX_KEY, (await this.list()).filter((p) => p.id !== id));
  }

  /** .cwspkg / .zip file picked by the user */
  importFile(file: File, onProgress?: (p: ImportProgress) => void) { return this.importStream(file.stream(), file.size, onProgress); }

  /** a folder with package.json + res/… (input type=file webkitdirectory) */
  async importFolder(files: File[], onProgress?: (p: ImportProgress) => void) {
    const rootLen = (files[0]?.webkitRelativePath.split('/')[0]?.length ?? 0) + 1;
    const total = files.reduce((n, f) => n + f.size, 0);
    await this.checkQuota(total);
    const staging = `staging-${Date.now()}`;
    let bytes = 0;
    try {
      for (const f of files) {
        const rel = f.webkitRelativePath.slice(rootLen) || f.name;
        await this.write(staging, rel, new Uint8Array(await f.arrayBuffer()));
        bytes += f.size; onProgress?.({ phase: 'writing', file: rel, bytes, total });
      }
      return await this.commit(staging, bytes, onProgress);
    } catch (e) { await this.dropStaging(staging); throw e; }
  }

  /** private URL (the conversion service download, or the site's own test package) */
  async importUrl(url: string, init?: RequestInit, onProgress?: (p: ImportProgress) => void) {
    const res = await fetch(url, init);
    if (!res.ok || !res.body) throw new Error(`Téléchargement du paquet impossible (HTTP ${res.status})`);
    return this.importStream(res.body, Number(res.headers.get('content-length')) || undefined, onProgress);
  }

  // ------------------------------------------------------------------ internals
  private async checkQuota(need?: number) {
    const s = await this.storage();
    if (navigator.storage?.persist && !s.persisted) await navigator.storage.persist().catch(() => false);
    if (need && s.quota && s.quota - s.usage < need * 1.1)
      throw Object.assign(new Error(`Espace de stockage insuffisant : ${(need / 1e6).toFixed(0)} Mo nécessaires, ${((s.quota - s.usage) / 1e6).toFixed(0)} Mo disponibles pour ce site.`), { code: 'quota' });
  }

  private async write(pkg: string, file: string, data: Uint8Array) {
    const dir = await this.opfs;
    try {
      if (dir) {
        const pd = await dir.getDirectoryHandle(enc(pkg), { create: true });
        const w = await (await pd.getFileHandle(enc(file), { create: true })).createWritable();
        await w.write(data as unknown as FileSystemWriteChunkType); await w.close();
      } else await idb.put('packageFiles', `${pkg}/${file}`, new Blob([data as unknown as BlobPart]));
    } catch (e) {
      if ((e as DOMException)?.name === 'QuotaExceededError') throw Object.assign(new Error('Stockage du navigateur plein pendant l’import ; rien n’a été conservé.'), { code: 'quota' });
      throw e;
    }
  }

  private async importStream(stream: ReadableStream<Uint8Array>, size: number | undefined, onProgress?: (p: ImportProgress) => void) {
    onProgress?.({ phase: 'checking', bytes: 0, total: size });
    await this.checkQuota(size);
    const staging = `staging-${Date.now()}`;
    let bytes = 0, failed: unknown = null;
    const pending: Promise<void>[] = [];
    const unzip = new Unzip((entry) => {
      if (entry.name.endsWith('/')) return;
      const chunks: Uint8Array[] = [];
      entry.ondata = (err, chunk, final) => {
        if (err) { failed = err; return; }
        chunks.push(chunk);
        if (final) {
          const total = chunks.reduce((n, c) => n + c.length, 0), all = new Uint8Array(total);
          let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
          pending.push(this.write(staging, entry.name, all).then(() => { bytes += total; onProgress?.({ phase: 'writing', file: entry.name, bytes, total: size }); }, (e) => { failed = e; }));
        }
      };
      entry.start();
    });
    unzip.register(UnzipInflate); unzip.register(UnzipPassThrough);
    try {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (failed) throw failed;
        if (done) { unzip.push(new Uint8Array(0), true); break; }
        unzip.push(value);
        if (pending.length > 8) { await Promise.all(pending); pending.length = 0; } // back-pressure on writes
      }
      await Promise.all(pending);
      if (failed) throw failed;
      return await this.commit(staging, bytes, onProgress);
    } catch (e) { await this.dropStaging(staging); throw e; }
  }

  /** validate package.json, then move staging → <id> (an existing package with the same id is replaced) */
  private async commit(staging: string, bytes: number, onProgress?: (p: ImportProgress) => void): Promise<StoredPackage> {
    onProgress?.({ phase: 'indexing', bytes });
    let m: CwsPackage;
    try { m = JSON.parse(new TextDecoder().decode(await this.read(staging, 'package.json'))); } catch { throw new Error('Ce fichier n’est pas un paquet préparé (package.json absent ou illisible). Les archives brutes du jeu passent par le service de conversion.'); }
    if (m.format !== 'cws-package' || m.version !== 1) throw new Error(`Format de paquet non pris en charge (${m.format} v${m.version})`);
    const missing: string[] = [];
    for (const r of m.resources) { try { await this.read(staging, r.file); } catch { missing.push(r.file); } }
    if (missing.length) throw new Error(`Paquet incomplet : ${missing.length} fichier(s) manquant(s), ex. ${missing.slice(0, 3).join(', ')}`);
    await this.remove(m.id);
    const dir = await this.opfs;
    if (dir) {
      // OPFS has no rename for directories everywhere: copy entries then drop staging
      const from = await dir.getDirectoryHandle(enc(staging)), to = await dir.getDirectoryHandle(enc(m.id), { create: true });
      for await (const [name, h] of (from as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) {
        const w = await (await to.getFileHandle(name, { create: true })).createWritable();
        await w.write(await h.getFile() as unknown as FileSystemWriteChunkType); await w.close();
      }
    } else {
      for (const k of (await idb.keys('packageFiles')).map(String)) if (k.startsWith(`${staging}/`)) {
        await idb.put('packageFiles', `${m.id}/${k.slice(staging.length + 1)}`, await idb.get('packageFiles', k));
      }
    }
    await this.dropStaging(staging);
    const entry: StoredPackage = { id: m.id, name: m.name, source: m.source, importedAt: new Date().toISOString(), bytes, backend: await this.backend(), sets: m.sets.length, resources: m.resources.length };
    await idb.put('settings', INDEX_KEY, [...(await this.list()).filter((p) => p.id !== m.id), entry]);
    this.manifests.set(m.id, m);
    onProgress?.({ phase: 'done', bytes });
    return entry;
  }

  private async dropStaging(staging: string) {
    const dir = await this.opfs;
    if (dir) await dir.removeEntry(enc(staging), { recursive: true }).catch(() => undefined);
    for (const k of (await idb.keys('packageFiles')).map(String)) if (k.startsWith(`${staging}/`)) await idb.del('packageFiles', k);
  }
}
