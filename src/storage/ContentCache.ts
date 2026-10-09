import { Emitter } from '../core/emitter';
import type { CacheStatus } from '../core/types';
import { idb } from './idb';

/**
 * Remote/imported content -> browser storage -> runtime.
 * Pattern from gta-vice-city-wasm / playgta5: binaries live in OPFS (origin private file system),
 * metadata in IndexedDB, keyed by manifest version so a new package version invalidates old bytes.
 */
export interface ContentMeta {
  url: string;
  key: string;
  version: string;
  bytes: number;
  cachedAt: number;
  store: 'opfs' | 'none';
}

type CacheEvents = { status: { url: string; status: CacheStatus; loaded?: number; total?: number } };

async function sha(text: string) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ContentCache extends Emitter<CacheEvents> {
  private root: Promise<FileSystemDirectoryHandle | null>;
  private statuses = new Map<string, CacheStatus>();
  private inflight = new Map<string, Promise<ArrayBuffer>>();
  /** bytes served from OPFS this session (diagnostics) */
  stats = { hits: 0, misses: 0, bytesFromCache: 0, bytesFromNetwork: 0, opfs: false };

  constructor() {
    super();
    this.root = (async () => {
      try {
        if (!navigator.storage?.getDirectory) return null;
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('content', { create: true });
        this.stats.opfs = true;
        navigator.storage.persist?.().catch(() => {});
        return dir;
      } catch (e) {
        console.warn('[ContentCache] OPFS unavailable, network-only', e);
        return null;
      }
    })();
  }

  status(url: string): CacheStatus {
    return this.statuses.get(url) ?? 'remote';
  }

  /** Load cached status for many urls at startup (so the library can show cache state). */
  async refreshStatuses(urls: string[], version: string) {
    for (const url of urls) {
      const meta = await idb.get<ContentMeta>('contentMeta', url).catch(() => undefined);
      if (meta && meta.version === version && meta.store === 'opfs') this.setStatus(url, 'cached');
    }
  }

  private setStatus(url: string, status: CacheStatus, loaded?: number, total?: number) {
    this.statuses.set(url, status);
    this.emit('status', { url, status, loaded, total });
  }

  fetch(url: string, version: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
    const k = `${url}@${version}`;
    let p = this.inflight.get(k);
    if (!p) {
      p = this.load(url, version, onProgress).finally(() => this.inflight.delete(k));
      this.inflight.set(k, p);
    }
    return p;
  }

  private async load(url: string, version: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
    const root = await this.root;
    const key = (await sha(`${url}@${version}`)) + '.bin';
    if (root) {
      const meta = await idb.get<ContentMeta>('contentMeta', url).catch(() => undefined);
      if (meta && meta.key === key) {
        try {
          const file = await (await root.getFileHandle(key)).getFile();
          if (file.size === meta.bytes) {
            const buf = await file.arrayBuffer();
            this.stats.hits++;
            this.stats.bytesFromCache += buf.byteLength;
            this.setStatus(url, 'cached');
            onProgress?.(buf.byteLength, buf.byteLength);
            return buf;
          }
        } catch { /* fall through to network */ }
      }
    }

    this.setStatus(url, 'downloading', 0, 0);
    const res = await fetch(url);
    if (!res.ok) {
      this.setStatus(url, 'error');
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const total = Number(res.headers.get('content-length')) || 0;
    let buf: ArrayBuffer;
    if (res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress(loaded, total);
        this.emit('status', { url, status: 'downloading', loaded, total });
      }
      const out = new Uint8Array(loaded);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.byteLength; }
      buf = out.buffer;
    } else {
      buf = await res.arrayBuffer();
    }
    this.stats.misses++;
    this.stats.bytesFromNetwork += buf.byteLength;

    if (root) {
      // Persist in the background; a failed write never breaks loading, but it is reported honestly.
      (async () => {
        try {
          const handle = await root.getFileHandle(key, { create: true });
          const w = await handle.createWritable();
          await w.write(buf);
          await w.close();
          await idb.put('contentMeta', url, { url, key, version, bytes: buf.byteLength, cachedAt: Date.now(), store: 'opfs' } satisfies ContentMeta);
          this.setStatus(url, 'cached');
        } catch (e) {
          console.warn('[ContentCache] could not persist', url, e);
          this.setStatus(url, 'remote');
        }
      })();
    } else {
      this.setStatus(url, 'remote');
    }
    return buf;
  }

  async usage() {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const metas = await idb.all<ContentMeta>('contentMeta').catch(() => [] as ContentMeta[]);
    return { entries: metas.length, bytes: metas.reduce((a, m) => a + m.bytes, 0), quota: est?.quota ?? 0 };
  }

  async clear() {
    const root = await this.root;
    const metas = await idb.all<ContentMeta>('contentMeta').catch(() => [] as ContentMeta[]);
    for (const m of metas) {
      await root?.removeEntry(m.key).catch(() => {});
      await idb.del('contentMeta', m.url);
      this.setStatus(m.url, 'remote');
    }
  }
}
