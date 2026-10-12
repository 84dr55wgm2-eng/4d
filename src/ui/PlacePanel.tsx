import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Studio } from '../runtime/Studio';
import type { SetCandidate } from '../content/Catalog';
import type { StoredPackage, ImportProgress } from '../content/PackageStore';
import type { ServiceHealth, ServiceJob } from '../content/ConversionService';
import type { AgentStatus } from '../agent/Agent';
import type { RunResult } from '../assembly/StudioAssembly';
import { useDocVersion } from './useStudio';

/**
 * Place studio panel: content sources (prepared packages, conversion service), catalogue of world portions,
 * assembly of the open place, and the agent. Every button here runs the same validated operations the agent uses;
 * none of them is AI.
 */
type Tab = 'sources' | 'catalogue' | 'assembly' | 'agent';
const TABS: { id: Tab; label: string }[] = [{ id: 'sources', label: 'Sources' }, { id: 'catalogue', label: 'Catalogue' }, { id: 'assembly', label: 'Assemblage' }, { id: 'agent', label: 'Agent' }];
const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} Mo`;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KIND_FR: Record<string, string> = { map: 'portion de carte', street: 'rue', intersection: 'carrefour', building: 'bâtiment', interior: 'intérieur', courtyard: 'cour' };

export function PlacePanel({ studio, close }: { studio: Studio; close: () => void }) {
  const [tab, setTab] = useState<Tab>(studio.store.doc.assembly?.junctions.length || studio.store.doc.entities.some((e) => e.type === 'SET') ? 'assembly' : studio.assembly.catalog.size ? 'catalogue' : 'sources');
  const [, bump] = useState(0);
  const refresh = () => bump((x) => x + 1);
  return <aside className="glass place-panel" aria-label="Studio de lieux">
    <div className="place-head">
      <div className="seg small" role="tablist">{TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      <button className="place-close" onClick={close} aria-label="Fermer">×</button>
    </div>
    <div className="place-body">
      {tab === 'sources' && <Sources studio={studio} onChange={refresh} />}
      {tab === 'catalogue' && <CatalogueTab studio={studio} />}
      {tab === 'assembly' && <AssemblyTab studio={studio} />}
      {tab === 'agent' && <AgentTab studio={studio} />}
    </div>
  </aside>;
}

// ------------------------------------------------------------------ sources
function Sources({ studio, onChange }: { studio: Studio; onChange: () => void }) {
  const asm = studio.assembly;
  const [list, setList] = useState<StoredPackage[]>([]);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof asm.packages.storage>> | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [url, setUrl] = useState('');
  const load = async () => { setList(await asm.packages.list()); setStorage(await asm.packages.storage()); };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (label: string, f: () => Promise<StoredPackage>) => {
    setBusy(true); setMsg(null); setProgress({ phase: 'checking', bytes: 0 });
    try { const e = await f(); setMsg({ ok: true, text: `${label} : « ${e.name} » importé (${e.sets} ensembles, ${e.resources} ressources, ${mb(e.bytes)}, ${e.backend === 'opfs' ? 'OPFS' : 'IndexedDB'}).` }); }
    catch (e) { setMsg({ ok: false, text: err(e) }); }
    finally { setBusy(false); setProgress(null); await load(); onChange(); }
  };
  const pct = progress?.total ? Math.min(100, (100 * progress.bytes) / progress.total) : undefined;
  return <div className="place-section">
    <div className="pop-title">Paquets dans ce navigateur</div>
    {storage && <div className="world-note">Stockage : {storage.backend === 'opfs' ? 'OPFS (système de fichiers privé du navigateur)' : 'IndexedDB (OPFS indisponible ici)'} · {mb(storage.usage)} utilisés{storage.quota ? ` sur ${mb(storage.quota)}` : ''}{storage.persisted ? ' · persistant' : ' · peut être évincé par le navigateur'}. Rien n’est envoyé au site.</div>}
    {!list.length && <div className="world-note">Aucun paquet importé.</div>}
    {list.map((p) => <div key={p.id} className="pkg-row">
      <div><strong>{p.name}</strong> <span className={`badge ${p.source.notGta ? 'test' : 'private'}`}>{p.source.notGta ? 'test · non GTA' : p.source.kind === 'gta5' ? 'GTA V · import privé' : p.source.kind}</span>
        <small>{p.sets} ensembles · {p.resources} ressources · {mb(p.bytes)} · {p.backend === 'opfs' ? 'OPFS' : 'IndexedDB'}{asm.broken.some((b) => b.id === p.id) ? ' · illisible' : ''}</small></div>
      <button className="mini danger" disabled={busy} onClick={async () => { if (confirm(`Supprimer le paquet ${p.name} de ce navigateur ?`)) { await asm.removePackage(p.id); await load(); onChange(); } }}>Retirer</button>
    </div>)}
    <div className="pop-title">Importer un paquet préparé</div>
    <div className="world-note">Format cws-package (package.json + res/*.glb), produit par la chaîne de préparation (tools/gta) ou le service de conversion. Fichier .cwspkg/.zip, dossier, ou adresse privée.</div>
    <label className="import-file">Fichier .cwspkg / .zip<input type="file" accept=".cwspkg,.zip" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void run('Fichier', () => asm.importFile(f, setProgress)); e.target.value = ''; }} /></label>
    <label className="import-file">Dossier de paquet<input type="file" disabled={busy} {...{ webkitdirectory: '', directory: '' } as Record<string, string>} multiple onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void run('Dossier', () => asm.importFolder(fs, setProgress)); e.target.value = ''; }} /></label>
    <div className="search"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (adresse privée d’un .cwspkg)" aria-label="Adresse d’un paquet" /></div>
    <button className="world-discover" disabled={busy || !/^https?:\/\//.test(url.trim())} onClick={() => run('Adresse', () => asm.importUrl(url.trim(), undefined, setProgress))}>Importer depuis l’adresse</button>
    <button className="world-discover secondary" disabled={busy} onClick={() => run('Paquet de test', () => asm.importTestPackage(setProgress))}>Importer le paquet de test (ville factice, non GTA)</button>
    {progress && <div className="world-note" role="status">{progress.phase === 'checking' ? 'Vérification de l’espace…' : progress.phase === 'indexing' ? 'Validation et indexation…' : `Écriture ${progress.file ?? ''} · ${mb(progress.bytes)}`}{pct !== undefined && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}</div>}
    {msg && <div className={msg.ok ? 'world-note ok' : 'world-error'} role="status">{msg.text}</div>}
    <ConversionSection studio={studio} onImported={async () => { await load(); onChange(); }} />
  </div>;
}

function ConversionSection({ studio, onImported }: { studio: Studio; onImported: () => void }) {
  const svc = studio.conversion;
  const [cfg, setCfg] = useState({ url: '', token: '' });
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [error, setError] = useState('');
  const [region, setRegion] = useState({ name: 'Région', bbox: '-200,-200,200,200' });
  useEffect(() => { void svc.config().then((c) => { if (c) { setCfg(c); void connect(); } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const connect = async () => {
    setError('');
    try { setHealth(await svc.health()); setJobs(await svc.jobs()); } catch (e) { setHealth(null); setError(err(e)); }
  };
  useEffect(() => {
    if (!health || !jobs.some((j) => j.status === 'running' || j.status === 'queued')) return;
    const t = setInterval(() => { void svc.jobs().then(setJobs).catch(() => undefined); }, 3000);
    return () => clearInterval(t);
  }, [health, jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (f: () => Promise<unknown>) => { setError(''); try { await f(); setJobs(await svc.jobs()); } catch (e) { setError(err(e)); } };
  return <>
    <div className="pop-title">Archives brutes du jeu (service de conversion privé)</div>
    <div className="world-note">Le navigateur ne lit pas les archives RPF. L’import brut passe par ton propre service (tools/gta/service) sur la machine qui contient les fichiers du jeu : CodeWalker.Core → Sollumz/Blender → paquet. Aucun fichier du jeu n’est publié.</div>
    <div className="param-grid">
      <label>Adresse du service<input value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="http://127.0.0.1:8787" /></label>
      <label>Jeton<input type="password" value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} /></label>
    </div>
    <button className="world-discover secondary" disabled={!cfg.url.trim() || !cfg.token} onClick={async () => { await svc.setConfig({ url: cfg.url.trim(), token: cfg.token }); await connect(); }}>Enregistrer et tester</button>
    {!health && !error && <div className="world-note">Service non configuré : l’import d’archives brutes n’est pas disponible.</div>}
    {error && <div className="world-error">{error}</div>}
    {health && <>
      <div className={health.canRun.region ? 'world-note ok' : 'world-error'}>{health.canRun.region ? `Prêt : jeu ${health.game?.executable} · ${health.blender} · Sollumz` : `Conversion GTA indisponible. Manque : ${health.missing.join(' ; ')}`}</div>
      {health.canRun.region && <div className="param-grid">
        <label>Nom<input value={region.name} onChange={(e) => setRegion({ ...region, name: e.target.value })} /></label>
        <label>Zone X0,Y0,X1,Y1 (coordonnées du jeu)<input value={region.bbox} onChange={(e) => setRegion({ ...region, bbox: e.target.value })} /></label>
        <button className="world-discover" onClick={() => act(() => svc.createRegion(region.name, region.bbox.split(',').map(Number) as [number, number, number, number]))}>Extraire et convertir cette zone</button>
      </div>}
      {jobs.map((j) => <div key={j.id} className="pkg-row">
        <div><strong>{j.name || j.id}</strong> <span className={`badge ${j.kind === 'fixture' ? 'test' : 'private'}`}>{j.kind === 'fixture' ? 'test · non GTA' : 'GTA V'}</span>
          <small>{j.status} · {j.steps.filter((s) => s.status === 'done').length}/{j.steps.length} étapes{j.progress ? ` · ${j.progress.step}: ${j.progress.line.slice(0, 80)}` : ''}</small>
          {j.error && <small className="bad">{j.error.code} : {j.error.message.slice(0, 200)}</small>}</div>
        <div className="row-actions">
          {j.status === 'done' && <button className="mini" onClick={() => act(async () => { const [u, init] = await svc.packageRequest(j.id); await studio.assembly.importUrl(u, init); onImported(); })}>Importer</button>}
          {(j.status === 'failed' || j.status === 'blocked') && <button className="mini" onClick={() => act(() => svc.resume(j.id))}>Reprendre</button>}
          <button className="mini danger" onClick={() => act(() => svc.remove(j.id))}>Suppr.</button>
        </div>
      </div>)}
    </>}
  </>;
}

// ------------------------------------------------------------------ catalogue
function useRun(studio: Studio) {
  const [res, setRes] = useState<RunResult | null>(null);
  const run = (steps: Parameters<Studio['assembly']['run']>[0], label: string, force = false) => { const r = studio.assembly.run(steps, label, { force }); setRes(r); return r; };
  return { res, run, clear: () => setRes(null) };
}
function RunMessage({ res }: { res: RunResult | null }) {
  if (!res) return null;
  if (!res.ok) return <div className="world-error" role="alert">{res.error}{res.issues?.length ? ` (${res.issues.filter((i) => i.severity === 'blocking').length} problème(s) bloquant(s))` : ''}</div>;
  const warn = res.issues.filter((i) => i.severity !== 'info');
  return <div className="world-note ok" role="status">Fait : {[res.created.length && `${res.created.length} créé(s)`, res.updated.length && `${res.updated.length} modifié(s)`, res.deleted.length && `${res.deleted.length} retiré(s)`].filter(Boolean).join(', ') || 'aucun changement'}. {warn.length ? `${warn.length} point(s) à vérifier.` : 'Aucun problème détecté.'} Annulable (⌘Z).</div>;
}

function NeedPlace({ studio }: { studio: Studio }) {
  const [name, setName] = useState('Nouveau lieu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="place-section">
    <div className="world-note">Le monde ouvert (« {studio.store.doc.name} ») n’est pas un assemblage. Crée un lieu vide pour y placer des ensembles importés.</div>
    <div className="search"><input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du lieu" /></div>
    <button className="world-discover" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); try { await studio.createAssemblyWorld(name.trim()); } catch (e) { setError(err(e)); setBusy(false); } }}>Créer et ouvrir le lieu</button>
    {error && <div className="world-error">{error}</div>}
  </div>;
}

function CatalogueTab({ studio }: { studio: Studio }) {
  const cat = studio.assembly.catalog;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { res, run } = useRun(studio);
  useDocVersion(studio);
  if (!cat.size) return <div className="world-note">Catalogue vide : importe un paquet dans l’onglet Sources.</div>;
  const results: SetCandidate[] = cat.searchSets(q, { kind: (kind || undefined) as SetCandidate['kind'] | undefined, limit: 40 });
  const isPlace = !!studio.store.doc.assembly;
  return <div className="place-section">
    {!isPlace && <NeedPlace studio={studio} />}
    <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="rue commerçante, carrefour, café, cour…" aria-label="Chercher un ensemble" /></div>
    <div className="chips">{['', 'street', 'intersection', 'building', 'interior', 'courtyard', 'map'].map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k ? KIND_FR[k] : 'tout'}</button>)}</div>
    <div className="world-note">{results.length} ensemble(s) · {cat.list().map((p) => `${p.name}${p.notGta ? ' (test, non GTA)' : ''}`).join(', ')}</div>
    {results.map((s) => <div key={s.ref} className="set-row">
      <div className="set-main" onClick={() => setOpen(open === s.ref ? null : s.ref)}>
        <strong>{s.name}</strong> <span className="badge">{KIND_FR[s.kind]}</span>{s.notGta && <span className="badge test">non GTA</span>}
        <small>{s.size[0]} × {s.size[2]} m · accès {Object.entries(s.accesses).map(([k, n]) => `${n} ${k}`).join(', ') || 'aucun'}{s.tags.length ? ` · ${s.tags.slice(0, 4).join(', ')}` : ''}</small>
      </div>
      <button className="mini" disabled={!isPlace} onClick={() => run([{ op: 'place_set', input: { ref: s.ref } }], `Placer ${s.name}`)}>Placer</button>
      {open === s.ref && <SetDetail studio={studio} refId={s.ref} />}
    </div>)}
    <RunMessage res={res} />
  </div>;
}

function SetDetail({ studio, refId }: { studio: Studio; refId: string }) {
  const d = studio.assembly.catalog.inspect(refId);
  if (!d) return null;
  return <div className="set-detail">
    <small>Source : {d.package.name} · {d.source.region ?? d.source.mlo ?? ''} · {d.members} éléments ({d.lodMembers} LOD){d.rooms.length ? ` · pièces : ${d.rooms.map((r) => r.name).join(', ')}` : ''}</small>
    <small>Raccords : {d.connectors.map((c) => `${c.id.split('/').pop()} (${c.kind}, ${c.width ? c.width.toFixed(1) + ' m' : '—'}, ${c.origin === 'inferred' ? 'déduit' : 'mesuré'})`).join(' · ') || 'aucun'}</small>
    {!!d.inferred.uses.length && <small>Usages déduits : {d.inferred.uses.join(', ')}</small>}
  </div>;
}

// ------------------------------------------------------------------ assembly
function AssemblyTab({ studio }: { studio: Studio }) {
  useDocVersion(studio);
  const doc = studio.store.doc;
  const { res, run } = useRun(studio);
  const [issues, setIssues] = useState<ReturnType<Studio['assembly']['verify']> | null>(null);
  const [a, setA] = useState({ placement: '', connector: '' });
  const [b, setB] = useState({ placement: '', connector: '' });
  const [pop, setPop] = useState({ resource: '', count: 3, behavior: 'customer', at: '' });
  if (!doc.assembly) return <NeedPlace studio={studio} />;
  const sets = doc.entities.filter((e) => e.type === 'SET');
  const sel = studio.ui.selection && sets.find((s) => s.id === studio.ui.selection) ? studio.ui.selection : null;
  const connectorsOf = (id: string) => { const e = sets.find((s) => s.id === id); return e ? studio.assembly.runtime.setOf(e)?.connectors ?? [] : []; };
  const people = studio.assembly.catalog.searchResources('', { limit: 60 }).filter((r) => r.kind === 'character' || r.kind === 'vehicle');
  const missing = doc.assembly.packages.filter((p) => !studio.assembly.catalog.list().some((x) => x.id === p));
  const picker = (v: typeof a, set: (x: typeof a) => void, label: string) => <div className="param-grid">
    <label>{label}<select value={v.placement} onChange={(e) => set({ placement: e.target.value, connector: '' })}><option value="">—</option>{sets.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}</select></label>
    <label>Raccord<select value={v.connector} onChange={(e) => set({ ...v, connector: e.target.value })}><option value="">—</option>{connectorsOf(v.placement).map((c) => <option key={c.id} value={c.id}>{c.id.split('/').pop()} · {c.kind}{c.width ? ` · ${c.width.toFixed(1)} m` : ''}</option>)}</select></label>
  </div>;
  return <div className="place-section">
    {missing.length > 0 && <div className="world-error">Paquets absents de ce navigateur : {missing.join(', ')}. Importe-les (Sources) pour voir ces ensembles.</div>}
    <div className="pop-title">Ensembles placés ({sets.length})</div>
    {!sets.length && <div className="world-note">Aucun ensemble : place-en depuis le Catalogue.</div>}
    {sets.map((s) => <div key={s.id} className={`pkg-row ${sel === s.id ? 'on' : ''}`}>
      <div onClick={() => studio.ops.selectEntity(s.id)} style={{ cursor: 'pointer' }}><strong>{s.name}</strong><small>{s.id} · {(s.metadata?.set as { ref: string }).ref.split('/').pop()} · ({s.transform.position.map((v) => v.toFixed(1)).join(', ')})</small></div>
      <div className="row-actions">
        <button className="mini" title="Tourner de 90°" onClick={() => run([{ op: 'move_set', input: { placement: s.id, yaw: Math.round(yaw(s.transform.rotation) + 90) } }], 'Tourner un ensemble')}>⟳ 90°</button>
        <button className="mini danger" onClick={() => run([{ op: 'remove_set', input: { placement: s.id } }], `Retirer ${s.name}`)}>Retirer</button>
      </div>
    </div>)}
    {sets.length >= 2 && <>
      <div className="pop-title">Raccorder (B rejoint A)</div>
      {picker(a, setA, 'Ensemble A')}
      {picker(b, setB, 'Ensemble B')}
      <button className="world-discover" disabled={!a.connector || !b.connector || a.placement === b.placement} onClick={() => run([{ op: 'connect_sets', input: { a, b } }], 'Raccorder deux ensembles')}>Raccorder</button>
    </>}
    {doc.assembly.junctions.length > 0 && <div className="world-note">Jonctions : {doc.assembly.junctions.map((j) => `${j.a.placement}·${j.a.connector.split('/').pop()} ↔ ${j.b.placement}·${j.b.connector.split('/').pop()}`).join(' ; ')}</div>}
    {sets.length > 0 && people.length > 0 && <>
      <div className="pop-title">Population {sel ? `de ${sets.find((s) => s.id === sel)?.name}` : '(sélectionne un ensemble)'}</div>
      <div className="param-grid">
        <label>Ressource<select value={pop.resource} onChange={(e) => setPop({ ...pop, resource: e.target.value })}><option value="">—</option>{people.map((r) => <option key={r.ref} value={r.ref}>{r.ref.split('/').pop()} · {r.kind}{r.notGta ? ' (test)' : ''}</option>)}</select></label>
        <label>Nombre<input type="number" min={1} max={40} value={pop.count} onChange={(e) => setPop({ ...pop, count: Number(e.target.value) })} /></label>
        <label>Comportement<select value={pop.behavior} onChange={(e) => setPop({ ...pop, behavior: e.target.value })}>{['customer', 'wander', 'sit', 'idle', 'drive'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Lieu (pièce / raccord)<select value={pop.at} onChange={(e) => setPop({ ...pop, at: e.target.value })}><option value="">—</option>{sel && [...(studio.assembly.runtime.setOf(sets.find((s) => s.id === sel)!)?.rooms ?? []).map((r) => r.id), ...connectorsOf(sel).map((c) => c.id)].map((x) => <option key={x} value={x}>{x.split('/').pop()}</option>)}</select></label>
      </div>
      <button className="world-discover" disabled={!sel || !pop.resource} onClick={() => run([{ op: 'add_entities', input: { resource: pop.resource, count: pop.count, placement: sel!, behavior: pop.behavior, ...(pop.at ? { at: pop.at } : {}) } }], `Ajouter ${pop.count} × ${pop.resource.split('/').pop()}`)}>Ajouter</button>
    </>}
    <SimLine studio={studio} />
    {people.some((r) => r.kind === 'character' && r.clips?.length) && <>
      <div className="pop-title">Personnage incarné</div>
      <div className="world-note">Actuel : {doc.entities.find((e) => e.type === 'ACTOR')?.name ?? 'aucun (caméra libre seulement)'}. Un personnage de paquet garde son propre squelette et ses animations.</div>
      <div className="chips">{people.filter((r) => r.kind === 'character' && r.clips?.length).map((r) => <button key={r.ref} onClick={() => studio.setPlaceActor(r.ref).catch((e) => studio.toast(err(e)))}>{r.ref.split('/').pop()}{r.notGta ? ' (test)' : ''}</button>)}</div>
    </>}
    <RunMessage res={res} />
    <div className="pop-title">Vérification</div>
    <button className="world-discover secondary" onClick={() => setIssues(studio.assembly.verify())}>Vérifier l’assemblage</button>
    {issues && (issues.length ? issues.map((i, k) => <div key={k} className={i.severity === 'blocking' ? 'world-error' : 'world-note'}>{i.severity === 'blocking' ? '✗' : i.severity === 'warning' ? '△' : 'ℹ'} {i.message}</div>) : <div className="world-note ok">Aucun problème : pas de chevauchement, jonctions fermées, ensembles accessibles à pied.</div>)}
  </div>;
}
const yaw = (q: [number, number, number, number]) => (Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])) * 180) / Math.PI;

// ------------------------------------------------------------------ agent
function AgentTab({ studio }: { studio: Studio }) {
  const agent = studio.agent;
  useSyncExternalStore((cb) => agent.on(cb), () => agent.log);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [cfg, setCfg] = useState({ url: '', token: '' });
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const check = async () => setStatus(await agent.status());
  useEffect(() => { void agent.config().then((c) => c && setCfg(c)); void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [agent.log.length]);
  return <div className="place-section">
    {status?.state === 'ready' ? <div className="world-note ok">Agent connecté au relais · modèle {status.model}. Les outils s’exécutent ici, sur l’état réel du studio.</div>
      : <div className="world-error">{status?.state === 'provider_not_configured' ? <>provider_not_configured — {status.message}</> : status?.message ?? '…'}<br />Les opérations restent utilisables depuis les onglets Catalogue et Assemblage (sans IA).</div>}
    <div className="param-grid">
      <label>Relais d’inférence<input value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="https://ton-relais…/" /></label>
      <label>Jeton du relais<input type="password" value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} /></label>
    </div>
    <button className="world-discover secondary" onClick={async () => { await agent.setConfig(cfg.url.trim() ? { url: cfg.url.trim(), token: cfg.token } : null); await check(); }}>Enregistrer et tester</button>
    <div className="agent-log">
      {agent.log.map((l, i) => <div key={i} className={`agent-line ${l.kind}${l.ok === false ? ' failed' : ''}`}>
        {l.kind === 'tool' ? <details><summary>outil {l.text}</summary><pre>{JSON.stringify(l.input)}{'\n→ '}{JSON.stringify(l.output).slice(0, 1200)}</pre></details> : l.text}
      </div>)}
      <div ref={end} />
    </div>
    <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. : un café dans une rue commerçante, déplacé à l’angle d’un carrefour, avec quelques clients" aria-label="Demande à l’agent" />
    <div className="row-actions">
      <button className="world-discover" disabled={agent.busy || !text.trim()} onClick={() => { const t = text.trim(); setText(''); void agent.ask(t); }}>{agent.busy ? 'En cours…' : 'Envoyer'}</button>
      <button className="mini" onClick={() => agent.reset()}>Effacer</button>
    </div>
  </div>;
}

function SimLine({ studio }: { studio: Studio }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const st = studio.sim?.stats;
  if (!st || (!st.people && !st.vehicles)) return null;
  return <div className="world-note">Simulation · horloge {st.t.toFixed(0)} s · {st.people} piéton(s) ({Object.entries(st.phases).map(([k, n]) => `${n} ${k}`).join(', ')}) · sièges {st.occupied}/{st.seats} · {st.vehicles} véhicule(s){st.stoppedVehicles ? `, ${st.stoppedVehicles} arrêté(s)` : ''}
    <button className="mini" style={{ marginLeft: 8 }} onClick={() => { studio.sim.running = !studio.sim.running; tick((x) => x + 1); }}>{studio.sim.running ? 'Pause' : 'Reprendre'}</button></div>;
}
