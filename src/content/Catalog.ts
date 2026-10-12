import type { CwsPackage, PackageResource, SetDef } from './package';

/**
 * Searchable index over every imported package. Answers with compact candidates (ids, kind, measured size,
 * accesses, tags) — the agent never receives the whole inventory; details come from inspect().
 * Measured properties (from the geometry and game data) and inferred annotations stay separate.
 */
export interface SetCandidate {
  ref: string; // `<packageId>/<setId>`
  name: string;
  kind: SetDef['kind'];
  notGta: boolean;
  size: [number, number, number];
  accesses: Record<string, number>;
  capabilities: SetDef['capabilities'];
  tags: string[];
  uses: string[];
  score: number;
}
export interface ResourceCandidate { ref: string; kind: PackageResource['kind']; tags: string[]; size: [number, number, number]; clips?: string[]; notGta: boolean; score: number }

/** words the brief may use → set kinds / tags (French first, English accepted) */
const SYNONYMS: Record<string, string[]> = {
  street: ['rue', 'street', 'avenue', 'boulevard', 'route', 'commerçante', 'commercante', 'commerce', 'trottoir'],
  intersection: ['carrefour', 'intersection', 'croisement', 'angle', 'coin', 'corner'],
  building: ['bâtiment', 'batiment', 'immeuble', 'building', 'maison', 'boutique', 'magasin', 'shop'],
  interior: ['intérieur', 'interieur', 'interior', 'salle', 'pièce', 'piece', 'café', 'cafe', 'cybercafé', 'cybercafe', 'boutique', 'accessible'],
  courtyard: ['cour', 'courtyard', 'patio', 'résidentielle', 'residentielle', 'résidentiel', 'residential', 'square'],
  map: ['quartier', 'portion', 'district', 'zone', 'région', 'region'],
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export class Catalog {
  private packages = new Map<string, CwsPackage>();

  add(pkg: CwsPackage) { this.packages.set(pkg.id, pkg); }
  remove(id: string) { this.packages.delete(id); }
  get size() { let n = 0; for (const p of this.packages.values()) n += p.sets.length; return n; }
  list() { return [...this.packages.values()].map((p) => ({ id: p.id, name: p.name, notGta: !!p.source.notGta, kind: p.source.kind, sets: p.sets.length, resources: p.resources.length })); }

  set(ref: string): { pkg: CwsPackage; set: SetDef } | null {
    const [pid, ...rest] = ref.split('/'); const sid = rest.join('/');
    const pkg = this.packages.get(pid); const set = pkg?.sets.find((s) => s.id === sid);
    return pkg && set ? { pkg, set } : null;
  }
  resource(ref: string): { pkg: CwsPackage; res: PackageResource } | null {
    const [pid, ...rest] = ref.split('/'); const rid = rest.join('/');
    const pkg = this.packages.get(pid); const res = pkg?.resources.find((r) => r.id === rid);
    return pkg && res ? { pkg, res } : null;
  }

  /**
   * Sets matching a query + filters, best first. `kind`, `capability`, `minWidth` and `maxWidth` are exact filters;
   * the query words score against kinds (with synonyms), tags, uses and names.
   */
  searchSets(query = '', f: { kind?: SetDef['kind']; capability?: SetDef['capabilities'][number]; access?: string; minWidth?: number; maxWidth?: number; limit?: number } = {}): SetCandidate[] {
    const words = norm(query).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const out: SetCandidate[] = [];
    for (const pkg of this.packages.values()) for (const s of pkg.sets) {
      if (f.kind && s.kind !== f.kind) continue;
      if (f.capability && !s.capabilities.includes(f.capability)) continue;
      if (f.access && !s.connectors.some((c) => c.kind === f.access)) continue;
      const w = s.bounds.max[0] - s.bounds.min[0], d = s.bounds.max[2] - s.bounds.min[2];
      if (f.minWidth && Math.max(w, d) < f.minWidth) continue;
      if (f.maxWidth && Math.min(w, d) > f.maxWidth) continue;
      const hay = norm([s.name, s.kind, ...s.annotations.inferred.tags, ...s.annotations.inferred.uses, ...s.capabilities].join(' '));
      let score = words.length ? 0 : 1;
      for (const word of words) {
        if (hay.includes(word)) score += 2;
        for (const [kind, syn] of Object.entries(SYNONYMS)) if (syn.some((x) => norm(x) === word || word.startsWith(norm(x)))) score += kind === s.kind ? 3 : 0;
      }
      if (words.length && score === 0) continue;
      const accesses: Record<string, number> = {};
      for (const c of s.connectors) accesses[c.kind] = (accesses[c.kind] ?? 0) + 1;
      out.push({ ref: `${pkg.id}/${s.id}`, name: s.name, kind: s.kind, notGta: !!pkg.source.notGta, size: [+w.toFixed(1), +(s.bounds.max[1] - s.bounds.min[1]).toFixed(1), +d.toFixed(1)], accesses, capabilities: s.capabilities, tags: s.annotations.inferred.tags, uses: s.annotations.inferred.uses, score });
    }
    return out.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref)).slice(0, f.limit ?? 12);
  }

  searchResources(query = '', f: { kind?: PackageResource['kind']; limit?: number } = {}): ResourceCandidate[] {
    const words = norm(query).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const out: ResourceCandidate[] = [];
    for (const pkg of this.packages.values()) for (const r of pkg.resources) {
      if (f.kind && r.kind !== f.kind) continue;
      const hay = norm([r.id, r.kind, ...r.tags, ...Object.values(r.inferred).flat().map(String)].join(' '));
      const score = words.length ? words.filter((w) => hay.includes(w)).length : 1;
      if (!score) continue;
      out.push({ ref: `${pkg.id}/${r.id}`, kind: r.kind, tags: r.tags, size: r.measured.size.map((v) => +v.toFixed(2)) as [number, number, number], clips: r.clips, notGta: !!pkg.source.notGta, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, f.limit ?? 20);
  }

  /** full description of one set for planning (connectors with positions, rooms, relations) */
  inspect(ref: string) {
    const hit = this.set(ref);
    if (!hit) return null;
    const { pkg, set: s } = hit;
    return {
      ref, name: s.name, kind: s.kind, package: { id: pkg.id, name: pkg.name, kind: pkg.source.kind, notGta: !!pkg.source.notGta },
      source: s.source, bounds: s.bounds, members: s.members.length, lodMembers: s.members.filter((m) => m.lod === 'LOD' || m.lod === 'SLOD').length,
      connectors: s.connectors.map((c) => ({ id: c.id, kind: c.kind, position: c.position.map((v) => +v.toFixed(2)), normal: c.normal.map((v) => +v.toFixed(2)), width: c.width, origin: c.origin })),
      rooms: s.rooms, roads: s.roads.length, capabilities: s.capabilities, measured: s.annotations.measured, inferred: s.annotations.inferred, related: s.related,
    };
  }
}
