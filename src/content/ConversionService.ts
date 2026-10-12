import { idb } from '../storage/idb';

/**
 * Client for the owner's private conversion service (tools/gta/service, environment B). The browser never reads
 * raw game archives: raw import exists only through this service, which runs on the machine holding the files.
 * Address and token are kept in this browser only.
 */
export interface ServiceConfig { url: string; token: string }
export interface ServiceHealth { ok: boolean; game: { dir: string; executable: string | null } | null; cwExtract: boolean; blender: string | null; sollumz: boolean; missing: string[]; canRun: { fixture: boolean; region: boolean } }
export interface ServiceJob { id: string; kind: 'region' | 'fixture'; name: string; status: 'queued' | 'running' | 'done' | 'failed' | 'blocked'; steps: { name: string; status: string }[]; progress?: { step: string; line: string }; error?: { step?: string; code: string; message: string } | null; package?: string; createdAt?: string }

const KEY = 'conversionService';

export class ConversionService {
  async config(): Promise<ServiceConfig | null> { return (await idb.get<ServiceConfig>('settings', KEY).catch(() => undefined)) ?? null; }
  async setConfig(c: ServiceConfig | null) { if (c) await idb.put('settings', KEY, c); else await idb.del('settings', KEY); }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const c = await this.config();
    if (!c?.url) throw Object.assign(new Error('Aucun service de conversion configuré.'), { code: 'service_not_configured' });
    const res = await fetch(new URL(path, c.url.endsWith('/') ? c.url : c.url + '/'), { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${c.token}`, 'content-type': 'application/json' } });
    const body = await res.json().catch(() => ({})) as T & { error?: string };
    if (!res.ok) throw Object.assign(new Error(body.error ?? `Service : HTTP ${res.status}`), { status: res.status });
    return body;
  }

  health() { return this.req<ServiceHealth>('health'); }
  jobs() { return this.req<ServiceJob[]>('jobs'); }
  job(id: string) { return this.req<ServiceJob>(`jobs/${id}`); }
  /** bbox in GTA world X/Y (metres, Z-up source coordinates) */
  createRegion(name: string, bbox: [number, number, number, number], maxYmaps = 40) { return this.req<ServiceJob>('jobs', { method: 'POST', body: JSON.stringify({ kind: 'region', name, bbox, maxYmaps }) }); }
  createFixture() { return this.req<ServiceJob>('jobs', { method: 'POST', body: JSON.stringify({ kind: 'fixture' }) }); }
  resume(id: string) { return this.req<ServiceJob>(`jobs/${id}/resume`, { method: 'POST' }); }
  remove(id: string) { return this.req<{ deleted: string }>(`jobs/${id}`, { method: 'DELETE' }); }
  /** URL + auth for PackageStore.importUrl */
  async packageRequest(id: string): Promise<[string, RequestInit]> {
    const c = await this.config();
    if (!c) throw new Error('Aucun service de conversion configuré.');
    return [new URL(`jobs/${id}/package`, c.url.endsWith('/') ? c.url : c.url + '/').toString(), { headers: { authorization: `Bearer ${c.token}` } }];
  }
}
