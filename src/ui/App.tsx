import * as THREE from 'three';
import { useEffect, useMemo, useState } from 'react';
import type { AssetCategory, DistrictParams, DistrictPlan } from '../core/types';
import type { RemoteAssetResult } from '../assets/AssetRegistry';
import { planWorld, type WorldPlan } from '../world/WorldCreator';
import { matchesDistrictKit, planDistrict, type DistrictBriefPlan } from '../world/district/Commands';
import { PARAM_LIMITS } from '../world/district/YabaPlan';
import type { Studio } from '../runtime/Studio';
import { LENSES } from '../runtime/CameraDirector';
import { Icon, type IconName } from './icons';
import { useDocVersion, usePoll, useStudioUI } from './useStudio';
import { PlacePanel } from './PlacePanel';

export function App({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  return (
    <>
      {ui.phase !== 'ready' && <Loading studio={studio} />}
      {ui.phase === 'ready' && (
        <>
          <TopIsland studio={studio} />
          {!!studio.store.doc.composition?.missing.length && <div className="glass incomplete-world" role="status">Assemblage incomplet : ce décor ne respecte pas tout le brief. Ouvre le menu des mondes pour voir le contenu manquant.</div>}
          {(ui.placePanel ?? !!studio.store.doc.assembly) ? <PlacePanel studio={studio} close={() => studio.set({ placePanel: false })} /> : <LibraryRail studio={studio} />}
          <div className={ui.mode === 'direct' && ui.sequencePanel ? 'seq-open' : undefined}><Inspector studio={studio} /></div>
          <ActionDock studio={studio} />
          {ui.mode === 'direct' && ui.sequencePanel && <SequencePanel studio={studio} />}
          {ui.diagnostics && <Diagnostics studio={studio} />}
          <Toast studio={studio} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ loading
function Loading({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  const mb = (b: number) => (b / 1e6).toFixed(1);
  return (
    <div className="loading">
      <div className="glass loading-card">
        <div className="brand">Cinematic World Studio</div>
        {ui.phase === 'error' ? (
          <div className="error">Could not open the world: {ui.error}</div>
        ) : (
          <>
            <div className="loading-title">Ouverture du monde…</div>
            {ui.loading.map((l) => (
              <div className="load-row" key={l.label}>
                <span>{l.label}</span>
                <span className="mono">{l.total ? `${mb(l.loaded)} / ${mb(l.total)} MB` : l.loaded ? `${mb(l.loaded)} MB` : '…'}</span>
                <div className="bar"><i style={{ width: l.total ? `${(100 * l.loaded) / l.total}%` : l.loaded ? '100%' : '6%' }} /></div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ top island
function Btn({ icon, label, onClick, active, disabled, text }: { icon?: IconName; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; text?: string }) {
  return (
    <button className={`btn ${active ? 'active' : ''} ${text ? 'with-text' : ''}`} onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={active}>
      {icon && <Icon name={icon} />}
      {text && <span>{text}</span>}
    </button>
  );
}

function TopIsland({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  useDocVersion(studio);
  const [menu, setMenu] = useState<'world' | 'camera' | 'settings' | null>(null);
  const shots = studio.store.doc.shots;
  const camLabel = ui.cameraMode === 'follow' ? 'Follow' : ui.cameraMode === 'free' ? 'Free' : 'Director';
  return (
    <div className="top">
      <div className="glass island" role="toolbar" aria-label="Studio">
        <div className="menu-anchor">
          <button className="world-name" onClick={() => setMenu(menu === 'world' ? null : 'world')} title="Worlds">
            <span className={`dot ${ui.saveState}`} title={ui.saveState === 'error' ? `Save failed: ${ui.saveError}` : ui.saveState === 'saved' ? 'All changes saved in this browser' : 'Saving…'} />
            {studio.store.doc.name}
          </button>
          {menu === 'world' && (
            <div className="glass popover world-pop">
              <div className="pop-title">World packages</div>
              {studio.worlds.map((w) => (
                <button key={w.id} className={`row ${w.id === studio.store.doc.id ? 'on' : ''}`} onClick={() => studio.switchWorld(w.id)}>
                  {w.name}{w.id === studio.store.doc.id && <Icon name="check" size={16} />}
                </button>
              ))}
              {studio.store.doc.district && <><div className="pop-title">Modifier ce monde</div><WorldCommand studio={studio} /></>}
              <div className="pop-title">Nouveau lieu assemblé</div>
              <button className="row" onClick={() => studio.createAssemblyWorld('Nouveau lieu').catch((e) => studio.toast(String(e)))}>Créer un lieu vide (contenu importé)</button>
              <div className="pop-title">Kits précédents (Bistro, Yaba)</div>
              <WorldBrief studio={studio} />
              <WorldImport studio={studio} />
            </div>
          )}
        </div>
        <Btn icon="plus" label="Créer un nouveau monde" onClick={() => setMenu(menu === 'world' ? null : 'world')} />
        <Btn text="Lieux" label="Sources, catalogue, assemblage et agent" active={ui.placePanel ?? !!studio.store.doc.assembly} onClick={() => studio.set({ placePanel: !(ui.placePanel ?? !!studio.store.doc.assembly) })} />
        <div className="seg" role="tablist" aria-label="Mode">
          {(['explore', 'edit', 'direct'] as const).map((m, i) => (
            <button key={m} role="tab" aria-selected={ui.mode === m} className={ui.mode === m ? 'on' : ''} onClick={() => studio.setMode(m)} title={`${m[0].toUpperCase() + m.slice(1)} (${i + 1})`}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="menu-anchor">
          <Btn icon="camera" text={`${camLabel} · ${ui.focalLength}mm`} label="Camera" onClick={() => setMenu(menu === 'camera' ? null : 'camera')} active={menu === 'camera'} />
          {menu === 'camera' && (
            <div className="glass popover">
              <div className="pop-title">Camera</div>
              {(['follow', 'free', 'director'] as const).map((m) => (
                <button key={m} className={`row ${ui.cameraMode === m ? 'on' : ''}`} onClick={() => { studio.setCameraMode(m); setMenu(null); }}>
                  {m === 'follow' ? 'Follow (third-person)' : m === 'free' ? 'Free camera' : 'Director camera'}
                  {ui.cameraMode === m && <Icon name="check" size={16} />}
                </button>
              ))}
              <div className="pop-title">Shots</div>
              {shots.length === 0 && <div className="muted row">No saved shots yet</div>}
              {shots.map((s) => (
                <button key={s.id} className="row" onClick={() => { studio.ops.recallShot(s.id); setMenu(null); }}>
                  {s.name} <span className="mono muted">{s.focalLength}mm</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sep" />
        <Btn icon="undo" label={ui.canUndo ? `Undo ${ui.undoLabel}` : 'Undo'} onClick={() => studio.store.undo()} disabled={!ui.canUndo} />
        <Btn icon="redo" label={ui.canRedo ? `Redo ${ui.redoLabel}` : 'Redo'} onClick={() => studio.store.redo()} disabled={!ui.canRedo} />
        <div className="menu-anchor">
          <Btn icon="gear" label="Settings" onClick={() => setMenu(menu === 'settings' ? null : 'settings')} active={menu === 'settings'} />
          {menu === 'settings' && <Settings studio={studio} close={() => setMenu(null)} />}
        </div>
      </div>
    </div>
  );
}

function WorldCommand({ studio }: { studio: Studio }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (t: string) => { const r = studio.ops.command(t); setMsg(r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error }); };
  const examples = ['Agrandis le cybercafé de 3 m en conservant la rue', 'Ajoute deux postes le long du mur du fond', 'Déplace cette chaise devant cet ordinateur', 'Passe en fin d’après-midi sans changer les bâtiments'];
  return <div className="world-brief">
    <div className="search"><input id="world-command" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && run(text)} placeholder="Modification ciblée" aria-label="Modification ciblée du monde" /></div>
    <div className="chips">{examples.map((x) => <button key={x} onClick={() => { setText(x); run(x); }}>{x}</button>)}</div>
    <button className="world-discover" disabled={!text.trim()} onClick={() => run(text)}>Appliquer</button>
    {msg && <div className={msg.ok ? 'world-note' : 'world-error'} role="status">{msg.text}</div>}
    <div className="world-note">Analyseur de commandes déterministe (pas un modèle de langue) : chaque phrase reconnue devient une opération validée et annulable. « Cette chaise / cet ordinateur » = les deux dernières sélections en mode ÉDITION.</div>
  </div>;
}

function DistrictBrief({ studio, brief }: { studio: Studio; brief: string }) {
  const [plan, setPlan] = useState<DistrictBriefPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [acceptKit, setAcceptKit] = useState(false);
  useEffect(() => { setPlan(null); setAcceptKit(false); }, [brief]);
  const assets = studio.registry.manifest.assets;
  const replan = (params: DistrictParams, accept = acceptKit) => setPlan((old) => old ? { ...planDistrict(brief, assets, params, { acceptKitPlace: accept }), name: old.name, time: old.time } : old);
  if (!plan) return <button className="world-discover" onClick={() => { try { setPlan(planDistrict(brief, assets)); setError(''); } catch (e) { setError(String(e)); } }}>Préparer le plan de quartier</button>;
  const P = plan.params;
  const set = (f: (p: DistrictParams) => void) => { const n = structuredClone(P); f(n); replan(n); };
  const num = (label: string, value: number, [min, max]: readonly [number, number], step: number, f: (p: DistrictParams, v: number) => void) =>
    <label>{label}<input type="number" min={min} max={max} step={step} value={value} onChange={(e) => set((p) => f(p, Number(e.target.value)))} /></label>;
  const r = plan.reading;
  return <div className="world-plan">
    <div className="pop-title">1 · Lecture du brief</div>
    <div className="world-note">Lieu : {r.place ?? '— (non précisé)'}{r.place && !r.placeSupported ? ' — non couvert par le kit' : ''} · Époque : {r.era ?? '— (non précisée)'}{r.era && !r.eraSupported ? ' — hors période du kit' : ''}<br />
      Contraintes reconnues : {r.constraints.length ? r.constraints.join(', ') : 'aucune (valeurs par défaut du kit)'}</div>
    <div className="pop-title">2 · Besoins</div>
    {plan.needs.map((n) => <div key={n.label} className={n.satisfied ? 'world-note' : n.required ? 'world-error' : 'world-note'}>
      {n.satisfied ? '✓' : n.required ? '✗' : '△'} {n.label}{n.mode === 'any' ? '' : ''} : {n.items.map((i) => `${i.present ? '✓' : '✗'} ${i.label}`).join(' · ')}</div>)}
    <div className="pop-title">3 · Plan spatial (modifiable)</div>
    <PlanMap plan={plan.plan} />
    <div className="param-grid">
      {num('Longueur de rue (m)', P.street.length, PARAM_LIMITS.length, 4, (p, v) => { p.street.length = v; })}
      {num('Chaussée (m)', P.street.carriageway, PARAM_LIMITS.carriageway, 0.5, (p, v) => { p.street.carriageway = v; })}
      {num('Trottoirs (m)', P.street.sidewalk, PARAM_LIMITS.sidewalk, 0.2, (p, v) => { p.street.sidewalk = v; })}
      <label>Côté du café<select value={P.cafe.side} onChange={(e) => set((p) => { p.cafe.side = e.target.value as 'south' | 'north'; })}><option value="south">Sud</option><option value="north">Nord</option></select></label>
      <label>Position du café<input type="range" min={0} max={1} step={0.05} value={P.cafe.position} onChange={(e) => set((p) => { p.cafe.position = Number(e.target.value); })} /></label>
      {num('Largeur du café (m)', P.cafe.width, PARAM_LIMITS.cafeWidth, 0.5, (p, v) => { p.cafe.width = v; })}
      {num('Profondeur du café (m)', P.cafe.depth, PARAM_LIMITS.cafeDepth, 0.5, (p, v) => { p.cafe.depth = v; })}
      {num('Postes', P.cafe.workstations, PARAM_LIMITS.workstations, 1, (p, v) => { p.cafe.workstations = v; })}
      <label>Disposition des postes<select value={P.cafe.layout} onChange={(e) => set((p) => { p.cafe.layout = e.target.value as DistrictParams['cafe']['layout']; })}><option value="sides">Murs latéraux</option><option value="back">Mur du fond</option><option value="sides+back">Trois murs</option></select></label>
      {num('Étages min.', P.storeys[0], PARAM_LIMITS.storeys, 1, (p, v) => { p.storeys = [v, Math.max(v, p.storeys[1])]; })}
      {num('Étages max.', P.storeys[1], PARAM_LIMITS.storeys, 1, (p, v) => { p.storeys = [Math.min(v, p.storeys[0]), v]; })}
      <label>Lumière<select value={plan.time} onChange={(e) => setPlan({ ...plan, time: e.target.value as DistrictBriefPlan['time'] })}><option value="morning">Matin</option><option value="midday">Midi</option><option value="late_afternoon">Fin d’après-midi</option><option value="dusk">Crépuscule</option></select></label>
      <label>Nom<input value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></label>
    </div>
    <div className="world-note">{plan.spatial.buildings} bâtiments, rue de {plan.spatial.streetLength} m. Chaque réglage régénère le plan (géométrie, collisions et navigation viennent de ce même plan).</div>
    {plan.blockers.map((m) => <div className="world-error" key={m}>{m}</div>)}
    {!r.placeSupported && <label className="world-note"><input type="checkbox" checked={acceptKit} onChange={(e) => { setAcceptKit(e.target.checked); replan(P, e.target.checked); }} /> Composer quand même une rue de Lagos (le monde restera nommé et décrit comme Lagos)</label>}
    {plan.missing.map((m) => <div className="world-note" key={m}>△ {m}</div>)}
    <button className="world-discover" disabled={busy || plan.blockers.length > 0} onClick={async () => {
      setBusy(true); setError('');
      try { await studio.createDistrictWorld(plan); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
    }}>{busy ? 'Composition et navigation…' : plan.blockers.length ? 'Brief non composable tel quel' : 'Composer et ouvrir ce quartier'}</button>
    {error && <div className="world-error" role="alert">{error}</div>}
  </div>;
}

/** Top view of a district plan: street, buildings, the café and its room (updates with every parameter). */
function PlanMap({ plan }: { plan: DistrictPlan }) {
  const L = plan.street.length + 20, fz = plan.street.carriageway / 2 + 0.7 + plan.street.sidewalk, H = 2 * (fz + 17);
  const rect = (b: DistrictPlan['buildings'][number]) => {
    const r = (b.yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const pts = [[-b.width / 2, 0], [b.width / 2, 0], [b.width / 2, -b.depth], [-b.width / 2, -b.depth]].map(([x, z]) => [b.front[0] + x * c + z * s, b.front[2] - x * s + z * c]);
    return pts.map((p) => p.join(',')).join(' ');
  };
  // world +z is north: flip vertically so north is up on the map
  return <svg className="plan-map" viewBox={`${-L / 2} ${-H / 2} ${L} ${H}`} role="img" aria-label="Plan du quartier vu du dessus (nord en haut)"><g transform="scale(1,-1)">
    <rect x={-plan.street.length / 2} y={-plan.street.carriageway / 2} width={plan.street.length} height={plan.street.carriageway} fill="#4a4d55" />
    <rect x={-plan.street.length / 2} y={-fz} width={plan.street.length} height={fz - plan.street.carriageway / 2} fill="#9c8a74" opacity={0.6} />
    <rect x={-plan.street.length / 2} y={plan.street.carriageway / 2} width={plan.street.length} height={fz - plan.street.carriageway / 2} fill="#9c8a74" opacity={0.6} />
    {plan.buildings.map((b) => <polygon key={b.id} points={rect(b)} fill={b.rooms.length ? '#e9c46a' : '#d9d4c7'} stroke="#333" strokeWidth={0.15} />)}
  </g><text x={L / 2 - 4} y={-H / 2 + 5} fontSize={4} fill="#ddd">N ↑</text></svg>;
}

function WorldBrief({ studio }: { studio: Studio }) {
  const [brief, setBrief] = useState('Une rue commerçante de Yaba, Lagos, vers 2003, avec un cybercafé de 6 postes, en fin d’après-midi');
  const [plan, setPlan] = useState<WorldPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = (p: Partial<WorldPlan>) => setPlan((old) => old ? { ...old, ...p } : old);
  return <div className="world-brief">
    <textarea value={brief} onChange={(e) => { setBrief(e.target.value); setPlan(null); }} aria-label="Décrire le nouveau monde" />
    {matchesDistrictKit(brief) ? <DistrictBrief studio={studio} brief={brief} /> : <>
    <div className="world-note">Sans cybercafé ni rue de Lagos dans le brief, ce mode assemble le kit Bistro (rues et cours européennes, sans intérieur accessible).</div>
    <button className="world-discover" disabled={busy || brief.trim().length < 3} onClick={() => {
      try { setPlan(planWorld(brief, studio.registry.manifest.assets)); setError(''); } catch (e) { setError(String(e)); }
    }}>Préparer le plan</button>
    {plan && <div className="world-plan">
      <label>Nom<input value={plan.name} onChange={(e) => patch({ name: e.target.value })} /></label>
      <label>Disposition<select value={plan.layout} onChange={(e) => patch({ layout: e.target.value as WorldPlan['layout'] })}><option value="street">Rue</option><option value="courtyard">Cour / place</option></select></label>
      <label>Taille (m)<input type="number" min="60" max="140" value={plan.size} onChange={(e) => patch({ size: Number(e.target.value) })} /></label>
      <label>Bâtiments<input type="number" min="2" max={plan.layout === 'courtyard' ? 4 : 8} value={plan.count} onChange={(e) => patch({ count: Number(e.target.value) })} /></label>
      <label>Ambiance<select value={plan.lighting} onChange={(e) => patch({ lighting: e.target.value as WorldPlan['lighting'] })}><option value="day">Jour</option><option value="golden">Coucher du soleil</option><option value="overcast">Couvert</option></select></label>
      <label><input type="checkbox" checked={plan.vegetation} onChange={(e) => patch({ vegetation: e.target.checked })} /> Arbres</label>
      <div className="world-note">Ce mode assemble uniquement le kit Bistro disponible. Il ne génère pas une ville arbitraire. Pour un autre décor, utilise un monde complet ci-dessous.</div>
      <div className="kit-options">{studio.registry.manifest.assets.filter((a) => a.entityType === 'BUILDING' && a.bounds).map((a) => <label key={a.id}><input type="checkbox" checked={plan.buildingAssets.includes(a.id)} onChange={(e) => patch({ buildingAssets: e.target.checked ? [...plan.buildingAssets, a.id] : plan.buildingAssets.filter((id) => id !== a.id) })} />{a.name}</label>)}</div>
      {plan.missing.map((m) => <div className="world-error" key={m}>{m}</div>)}
      <button className="world-discover" disabled={busy || !plan.buildingAssets.length || plan.missing.length > 0} onClick={async () => {
        setBusy(true); setError('');
        try { await studio.createWorld(plan); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
      }}>{busy ? 'Composition et navigation…' : plan.missing.length ? 'Contenu manquant pour ce brief' : 'Assembler et ouvrir ce décor'}</button>
    </div>}
    </>}
    {error && <div className="world-error" role="alert">{error}</div>}
  </div>;
}

function WorldImport({ studio }: { studio: Studio }) {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(1);
  const [query, setQuery] = useState('');
  const [url, setURL] = useState('');
  const [results, setResults] = useState<RemoteAssetResult[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const execute = async (label: string, run: () => Promise<unknown>) => {
    setBusy(label); setError('');
    try { await run(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  return <section className="world-import">
    <div className="pop-title">Partir d’un monde complet</div>
    <div className="world-note">Le décor, les textures et les proportions viennent du fichier. Le studio prépare ses collisions et sa navigation ; aucun bâtiment du Bistro n’est ajouté.</div>
    <label className="import-file">Fichier GLB ou ZIP glTF<input type="file" accept=".glb,.zip" aria-label="Fichier de monde" disabled={!!busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
    <label className="import-scale">Unités du fichier<select value={scale} onChange={(e) => setScale(Number(e.target.value))}><option value="1">Mètres</option><option value="0.01">Centimètres</option><option value="0.001">Millimètres</option></select></label>
    <button className="world-discover" disabled={!file || !!busy} onClick={() => execute('Préparation du monde…', () => studio.importWorldFile(file!, scale))}>Importer et ouvrir le monde</button>
    <div className="search"><input value={url} onChange={(e) => setURL(e.target.value)} placeholder="Ou URL directe d’un monde GLB/glTF" aria-label="URL de monde" /></div>
    <button className="world-discover" disabled={!url.trim() || !!busy} onClick={() => execute('Acquisition du monde…', () => studio.importWorldURL(url.trim(), scale))}>Ouvrir ce monde depuis son URL</button>
    <div className="pop-title">Acquérir des environnements</div>
    <div className="search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom du décor ou environnement" aria-label="Chercher des environnements" /></div>
    <button className="world-discover" disabled={!!busy || query.trim().length < 2} onClick={() => execute('Recherche des sources…', async () => { setResults(await studio.registry.searchRemote(query, 12)); })}>Chercher du contenu réel</button>
    <div className="world-results">{results.map((r) => <div className="import-candidate" key={r.id}>
      {r.thumbnail && <img src={r.thumbnail} alt="" loading="lazy" />}
      <strong>{r.title}</strong><small>{r.license?.name ?? 'Licence à vérifier'} · {r.formats?.join(', ') || 'Format selon la source'}</small>
      <p>{r.description}</p>
      <button disabled={!!busy} onClick={() => execute('Acquisition et navigation…', async () => { const rec = await studio.registry.registerRemote(r); await studio.importWorldAsset(rec.id); })}>Utiliser comme monde</button>
    </div>)}</div>
    <div className="world-note">Choisis un environnement avec un sol praticable. Un asset isolé reste un objet ; il ne devient pas automatiquement une ville.</div>
    {busy && <div className="world-note" role="status">{busy}</div>}
    {error && <div className="world-error" role="alert">{error}</div>}
  </section>;
}

function Settings({ studio, close }: { studio: Studio; close: () => void }) {
  const ui = useStudioUI(studio);
  const [usage, setUsage] = useState<{ entries: number; bytes: number } | null>(null);
  const [debug, setDebug] = useState({ collision: !!studio.collision?.debugMesh.visible, nav: false });
  useEffect(() => { studio.registry.cache.usage().then(setUsage); }, [studio]);
  return (
    <div className="glass popover right" onMouseLeave={close}>
      <div className="pop-title">Quality</div>
      <div className="seg small">
        {(['auto', 'high', 'balanced'] as const).map((q) => (
          <button key={q} className={ui.quality === q ? 'on' : ''} onClick={() => { studio.engine.setQuality(q); studio.set({ quality: q }); }}>{q.toUpperCase()}</button>
        ))}
      </div>
      <div className="pop-title">Developer</div>
      <label className="row toggle"><input type="checkbox" checked={ui.diagnostics} onChange={(e) => studio.set({ diagnostics: e.target.checked })} /> Diagnostics HUD <kbd>`</kbd></label>
      <label className="row toggle"><input type="checkbox" checked={debug.collision} onChange={(e) => { if (studio.collision) studio.collision.debugMesh.visible = e.target.checked; setDebug({ ...debug, collision: e.target.checked }); }} /> Show collision</label>
      <label className="row toggle"><input type="checkbox" checked={debug.nav} onChange={(e) => { if (studio.nav) studio.nav.debugObject().visible = e.target.checked; setDebug({ ...debug, nav: e.target.checked }); }} /> Show navmesh</label>
      <div className="pop-title">Browser storage</div>
      <div className="row muted">{usage ? `${usage.entries} cached files · ${(usage.bytes / 1e6).toFixed(0)} MB (OPFS)` : studio.registry.cache.stats.opfs ? '…' : 'OPFS unavailable — network only'}</div>
      <button className="row" onClick={async () => { await studio.registry.cache.clear(); setUsage(await studio.registry.cache.usage()); }}>Clear content cache</button>
      <button className="row danger" onClick={() => { if (confirm('Discard all saved changes to this world?')) studio.resetWorld(); }}>Reset world to package</button>
    </div>
  );
}

// ------------------------------------------------------------------ library
const CATS: { id: AssetCategory; label: string }[] = [
  { id: 'VEHICLES', label: 'Vehicles' },
  { id: 'FURNITURE', label: 'Furniture' },
  { id: 'PROPS', label: 'Props' },
  { id: 'VEGETATION', label: 'Vegetation' },
  { id: 'CHARACTERS', label: 'Characters' },
  { id: 'ARCHITECTURE', label: 'Architecture' },
];

function LibraryRail({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<AssetCategory | undefined>();
  const [q, setQ] = useState('');
  const [source, setSource] = useState<'project' | 'web'>('project');
  const [remote, setRemote] = useState<RemoteAssetResult[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [, tick] = useState(0);
  useEffect(() => studio.registry.cache.on('status', () => tick((x) => x + 1)), [studio]);
  const items = useMemo(() => studio.registry.find(q, cat).filter((a) => !['ANIMATIONS', 'ENVIRONMENT'].includes(a.category)), [studio, q, cat]);
  useEffect(() => {
    if (source !== 'web') return;
    const query = q.trim();
    if (query.length < 2) { setRemote([]); setRemoteError(''); return; }
    let live = true;
    const t = setTimeout(() => {
      setRemoteBusy(true);
      setRemoteError('');
      studio.registry.searchRemote(query)
        .then((items) => { if (live) setRemote(items); })
        .catch((e) => { if (live) { setRemote([]); setRemoteError(e instanceof Error ? e.message : String(e)); } })
        .finally(() => { if (live) setRemoteBusy(false); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [studio, source, q]);
  if (!open)
    return (
      <button className="glass rail-pill" onClick={() => setOpen(true)} title="Asset library" aria-label="Open asset library">
        <Icon name="grid" />
        <span>Library</span>
      </button>
    );
  return (
    <aside className="glass library" aria-label="Asset library">
      <div className="lib-head">
        <div className="search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets" aria-label="Search assets" />
        </div>
        <Btn icon="close" label="Close library" onClick={() => setOpen(false)} />
      </div>
      <div className="source-tabs">
        <button className={source === 'project' ? 'on' : ''} onClick={() => setSource('project')}>PROJECT</button>
        <button className={source === 'web' ? 'on' : ''} onClick={() => { setSource('web'); setCat(undefined); }}>WEB</button>
      </div>
      {source === 'project' && <div className="chips">
        <button className={!cat ? 'on' : ''} onClick={() => setCat(undefined)}>All</button>
        {CATS.map((c) => (
          <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(cat === c.id ? undefined : c.id)}>{c.label}</button>
        ))}
      </div>}
      <div className="lib-list">
        {source === 'project' && items.map((a) => {
          const status = studio.registry.status(a.id);
          const placeable = !!a.entityType && !['CHARACTERS', 'ENVIRONMENT', 'ANIMATIONS'].includes(a.category);
          return (
            <button
              key={a.id}
              className={`asset ${ui.placing === a.id ? 'on' : ''}`}
              disabled={!placeable}
              title={placeable ? `Place ${a.name}: click in the world` : 'In use by the world'}
              onClick={() => {
                if (ui.mode === 'explore') studio.setMode('edit');
                studio.set({ placing: ui.placing === a.id ? null : a.id, walkTargeting: false });
                if (status !== 'cached') studio.registry.loadGLTF(a.id).catch(() => studio.toast(`Could not download ${a.name}`));
              }}
            >
              <span className={`thumb cat-${a.category.toLowerCase()}`}>{(() => { const t = a.thumbnail ?? studio.thumbnails.get(a.id); return t ? <img src={t} alt="" /> : a.name.slice(0, 1); })()}</span>
              <span className="asset-text">
                <span className="asset-name">{a.name}</span>
                <span className="asset-src">{a.source}</span>
              </span>
              <span className={`cache ${status}`} title={status === 'cached' ? 'Stored in this browser' : status === 'downloading' ? 'Downloading' : status === 'error' ? 'Download failed' : 'Remote — downloads on first use'}>
                <Icon name={status === 'cached' ? 'check' : status === 'downloading' ? 'down' : 'cloud'} size={15} />
              </span>
            </button>
          );
        })}
        {source === 'web' && remoteBusy && <div className="lib-status">Searching 3D sources…</div>}
        {source === 'web' && remoteError && <div className="lib-status error-inline">Web search failed: {remoteError}</div>}
        {source === 'web' && !remoteBusy && q.trim().length < 2 && <div className="lib-status">Search real buildings, props, furniture, vehicles or vegetation.</div>}
        {source === 'web' && remote.map((r) => (
          <button
            key={r.id}
            className="asset"
            title={`Import and place ${r.title}`}
            onClick={async () => {
              try {
                const rec = await studio.registry.registerRemote(r);
                if (ui.mode === 'explore') studio.setMode('edit');
                studio.set({ placing: rec.id, walkTargeting: false });
                studio.registry.loadGLTF(rec.id).catch(() => studio.toast(`Could not load ${rec.name} as GLB`));
              } catch (e) {
                studio.toast(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <span className="thumb remote-thumb">{r.thumbnail ? <img src={r.thumbnail} alt="" /> : '3D'}</span>
            <span className="asset-text">
              <span className="asset-name">{r.title}</span>
              <span className="asset-src">{r.id} · {r.license?.name ?? 'licence in source'}</span>
            </span>
            <span className="cache remote" title="Import from web"><Icon name="cloud" size={15} /></span>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ inspector
function NumberField({ label, value, onCommit, step = 0.1 }: { label: string; value: number; onCommit: (v: number) => void; step?: number }) {
  const [v, setV] = useState(value.toFixed(2));
  useEffect(() => setV(value.toFixed(2)), [value]);
  return (
    <label className="num">
      <span>{label}</span>
      <input inputMode="decimal" value={v} step={step} onChange={(e) => setV(e.target.value)} onBlur={() => { const n = parseFloat(v); if (Number.isFinite(n) && n !== value) onCommit(n); else setV(value.toFixed(2)); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function Inspector({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  useDocVersion(studio);
  const e = ui.selection ? studio.store.entity(ui.selection) : null;
  if (!e || ui.mode === 'explore') return null;
  const rec = e.assetId ? studio.registry.get(e.assetId) : null;
  const [x, y, z] = e.transform.position;
  const q = e.transform.rotation;
  const yaw = (Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])) * 180) / Math.PI;
  const move = (i: number, n: number) => { const p = [...e.transform.position] as [number, number, number]; p[i] = n; studio.ops.moveEntity(e.id, p, { snapToGround: i !== 1 }); };
  return (
    <aside className="glass inspector" aria-label="Inspector">
      <div className="insp-head">
        <div>
          <div className="insp-name">{e.name}</div>
          <div className="insp-type">{e.type}{e.locked ? ' · LOCKED' : ''}</div>
        </div>
        <Btn icon="close" label="Deselect (Esc)" onClick={() => studio.select(null)} />
      </div>
      <div className="insp-sec">Position (m)</div>
      <div className="nums">
        <NumberField label="X" value={x} onCommit={(n) => move(0, n)} />
        <NumberField label="Y" value={y} onCommit={(n) => move(1, n)} />
        <NumberField label="Z" value={z} onCommit={(n) => move(2, n)} />
      </div>
      <div className="insp-sec">Rotation</div>
      <div className="nums">
        <NumberField label="Yaw°" value={yaw} step={5} onCommit={(n) => studio.ops.rotateEntity(e.id, n)} />
        {e.capabilities.includes('scalable') && <NumberField label="Scale" value={e.transform.scale[0]} onCommit={(n) => studio.ops.scaleEntity(e.id, n)} />}
      </div>
      {rec && (
        <>
          <div className="insp-sec">Asset</div>
          <div className="insp-meta">
            <div>{rec.source}</div>
            <div className="muted">{rec.license.id}{rec.license.verified ? '' : ' (unverified)'}</div>
          </div>
        </>
      )}
      <div className="insp-tags">{e.tags.map((t) => <span key={t}>{t}</span>)}</div>
    </aside>
  );
}

// ------------------------------------------------------------------ action dock
function ActionDock({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  useDocVersion(studio);
  const sel = ui.selection ? studio.store.entity(ui.selection) : null;
  const [track, setTrack] = useState(studio.cameras.trackTarget);
  const actorId = studio.actorEntityId;
  const contextId = ui.interactionTarget ?? studio.store.doc.entities.find((e) => {
    const inter = e.metadata?.interaction as { occupiedBy?: string; heldBy?: string } | undefined;
    return inter?.occupiedBy === actorId || inter?.heldBy === actorId;
  })?.id ?? null;

  let content: React.ReactNode;
  if (ui.placing) {
    content = <>
      <span className="hint">Click in the world to place <b>{studio.registry.get(ui.placing).name}</b></span>
      <Btn text="Cancel" label="Cancel placing (Esc)" onClick={() => studio.set({ placing: null })} />
    </>;
  } else if (ui.walkTargeting) {
    content = <>
      <span className="hint">Touche une destination pour le personnage</span>
      <Btn text="Cancel" label="Cancel (Esc)" onClick={() => studio.set({ walkTargeting: false })} />
    </>;
  } else if (sel && ui.mode !== 'explore') {
    content = <>
      <span className="dock-label">{sel.name}</span>
      <div className="seg small">
        {([['translate', 'move', 'Move'], ['rotate', 'rotate', 'Rotate'], ['scale', 'scale', 'Scale']] as const).map(([m, ic, l]) => (
          <button key={m} className={ui.gizmo === m ? 'on' : ''} onClick={() => studio.setGizmo(m)} title={l} aria-label={l} disabled={m === 'scale' && !sel.capabilities.includes('scalable')}><Icon name={ic} /></button>
        ))}
      </div>
      <div className="sep" />
      <Btn icon="copy" label="Duplicate (Ctrl+D)" onClick={() => studio.ops.duplicateEntity(sel.id)} disabled={sel.type === 'ACTOR'} />
      <Btn icon={sel.locked ? 'unlock' : 'lock'} label={sel.locked ? 'Unlock' : 'Lock'} onClick={() => studio.ops.lockEntity(sel.id, !sel.locked)} active={sel.locked} />
      <Btn icon="trash" label="Delete (Del)" onClick={() => studio.ops.deleteEntity(sel.id)} disabled={sel.type === 'ACTOR' || sel.locked} />
      {sel.type === 'ACTOR' && <><div className="sep" /><Btn icon="walk" text="Walk to…" label="Walk the actor to a point" onClick={() => studio.set({ walkTargeting: true })} /></>}
    </>;
  } else if (ui.mode === 'direct') {
    content = <>
      <div className="seg small" aria-label="Lens">
        {LENSES.map((mm) => (
          <button key={mm} className={ui.focalLength === mm ? 'on' : ''} onClick={() => studio.cameras.setLens(mm)} title={`${mm}mm lens`}>{mm}</button>
        ))}
      </div>
      <Btn icon="target" text="Frame actor" label="Look at the actor" onClick={() => studio.ops.setCamera({ lookAtActor: true })} />
      <Btn icon="pulse" text="Track" label="Keep the actor framed" active={track} onClick={() => { studio.cameras.trackTarget = !track; setTrack(!track); }} />
      <Btn icon="walk" text="Walk to…" label="Direct the actor to walk to a point" onClick={() => studio.set({ walkTargeting: true })} />
      <div className="sep" />
      <Btn icon="plus" text="Save shot" label="Save the current camera as a shot" onClick={() => studio.ops.saveShot()} />
      <Btn icon="pulse" text="Séquence" label="Ouvrir la séquence (plans + actions)" active={!!ui.sequencePanel} onClick={() => studio.set({ sequencePanel: !ui.sequencePanel })} />
      <div className="shots">
        {studio.store.doc.shots.map((s) => (
          <button key={s.id} className="shot" onClick={() => studio.ops.recallShot(s.id)} title={`Recall ${s.name} (${s.focalLength}mm)`}>{s.name}</button>
        ))}
      </div>
    </>;
  } else if (ui.mode === 'edit') {
    content = <span className="hint">Tap an object to select · drag to look · use the on-screen gizmo to move, rotate or scale</span>;
  } else {
    const actorSelected = ui.selection === studio.actorEntityId;
    content = <>
      <span className={`state-pill s-${ui.actorState}`}>{ui.actorState.toUpperCase()}</span>
      <span className="hint">{actorSelected ? 'Personnage sélectionné · touche le sol pour marcher · touche un objet pour agir' : 'Touche le personnage puis une destination · caméra automatique'}</span>
      {contextId && <span className="context-actions">{studio.interactions.actionsFor(contextId).map((action) => <Btn key={action.id} text={action.label} label={action.label} onClick={async () => { const r = await studio.interactions.execute(contextId, action.id); if (!r.ok) studio.toast(r.error); else studio.toast(action.label); }} />)}</span>}
      {actorSelected && <Btn text="Stop" label="Arrêter le personnage" onClick={() => studio.ops.stopActor()} />}
      {ui.cameraMode === 'follow' && <><div className="sep" />
        <Btn text="−" label="Éloigner la caméra" onClick={() => studio.cameras.zoomFollow(1.15)} />
        <Btn text="+" label="Rapprocher la caméra" onClick={() => studio.cameras.zoomFollow(1 / 1.15)} />
        <Btn text={studio.cameras.manualYaw !== null ? 'Recentrer ●' : 'Recentrer'} label="Revenir derrière le personnage (glisser pour orienter la caméra)" active={studio.cameras.manualYaw !== null} onClick={() => studio.cameras.recenter()} /></>}
      {actorSelected && <Btn text="Done" label="Stop directing actor" onClick={() => studio.select(null)} />}
    </>;
  }
  return <div className="dock-wrap"><div className="glass dock">{content}</div></div>;
}

// ------------------------------------------------------------------ diagnostics + toast
function Diagnostics({ studio }: { studio: Studio }) {
  const s = usePoll(() => ({ ...studio.engine.stats, q: studio.engine.effective, cache: { ...studio.registry.cache.stats }, stream: { ...studio.entities.stats } }), 500);
  const assets = usePoll(() => studio.registry.manifest.assets.filter((a) => studio.registry.status(a.id) === 'cached').length, 1000);
  return (
    <div className="glass diag mono" aria-label="Diagnostics">
      <div><b>{s.fps}</b> fps · {s.frameMs} ms</div>
      <div>{s.calls} draws · {(s.triangles / 1e6).toFixed(2)}M tris</div>
      <div>{s.geometries} geo · {s.textures} tex · {s.q}</div>
      <div>cached {assets} assets · OPFS {s.cache.opfs ? 'on' : 'off'}</div>
      <div>secteurs : {s.stream.resident}/{s.stream.total} entités chargées{Number.isFinite(studio.entities.radius) ? ` · rayon ${studio.entities.radius} m` : ''}</div>
      <div>net {(s.cache.bytesFromNetwork / 1e6).toFixed(0)}MB · cache {(s.cache.bytesFromCache / 1e6).toFixed(0)}MB</div>
    </div>
  );
}

function Toast({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ui.toast) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(id);
  }, [ui.toast]);
  return <div className={`glass toast ${visible ? 'show' : ''}`} role="status">{ui.toast?.text}</div>;
}

// ------------------------------------------------------------------ sequence (shots + actions on one clock)
function SequencePanel({ studio }: { studio: Studio }) {
  useDocVersion(studio);
  const seqs = studio.store.doc.sequences ?? [];
  const [id, setId] = useState<string | null>(seqs.at(-1)?.id ?? null);
  const [tick, setTick] = useState({ time: 0, duration: 0, playing: false, beat: -1 });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [video, setVideo] = useState<{ url: string; filename: string; bytes: number } | null>(null);
  const [performer, setPerformer] = useState('');
  useEffect(() => studio.sequences.on('tick', setTick), [studio]);
  const seq = seqs.find((x) => x.id === id) ?? seqs.at(-1) ?? null;
  const shotName = (sid: string) => sid === 'follow' ? 'Suivi (3e personne)' : studio.store.doc.shots.find((x) => x.id === sid)?.name ?? '—';
  const dur = seq?.timing?.duration ?? 0;
  const stale = seq ? studio.sequences.isStale(seq) : false;
  const targets = studio.ops.beatTargets();
  const run = async (label: string, f: () => Promise<{ ok: boolean; error?: string } | unknown>) => {
    setBusy(label); setMsg('');
    try { const r = await f() as { ok?: boolean; error?: string }; if (r && r.ok === false) setMsg(r.error ?? 'Échec'); } finally { setBusy(''); }
  };
  const report = (r: { ok: boolean; error?: string }) => { setMsg(r.ok ? '' : r.error ?? 'Échec'); };
  const labelFor = (target: string, action?: string) => {
    const t = targets.find((x) => x.id === target);
    return `${t?.actions.find((a) => a.id === action)?.label ?? 'Agir'} — ${t?.name ?? target}`;
  };
  return <aside className="glass sequence" aria-label="Séquence">
    <div className="seq-head">
      <strong>Séquence</strong>
      {seqs.length > 0 && <select value={seq?.id} onChange={(e) => setId(e.target.value)} aria-label="Séquence">{seqs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
      <button className="row-btn" disabled={!!busy} onClick={() => { const r = studio.ops.createSequence(); if (r.ok) setId(r.value); report(r); }}>Nouvelle</button>
      <button className="row-btn" disabled={!!busy} onClick={() => run('Création et répétition…', async () => { const r = await studio.ops.createReferenceSequence(); if (r.ok) setId(r.value); return r; })}>Scène de référence</button>
    </div>
    {!seq && <div className="world-note">« Scène de référence » crée : marche vers le cybercafé, ouvre la porte, entre, rejoint un poste et s’assoit — avec trois plans. « Nouvelle » part de l’état actuel du monde ; ajoute ensuite tes actions et tes plans.</div>}
    {seq && <>
      <div className="timeline" aria-label="Chronologie">
        {seq.beats.map((b, i) => { const t0 = seq.timing?.beatStarts[i] ?? 0, t1 = seq.timing?.beatStarts[i + 1] ?? dur; return <div key={b.id} className={`beat ${tick.playing && tick.beat === i ? 'on' : ''}`} style={{ left: `${(100 * t0) / (dur || 1)}%`, width: `${(100 * (t1 - t0)) / (dur || 1)}%` }} title={b.label}>{b.label}</div>; })}
        {studio.sequences.cutTimes(seq).map((c) => <div key={c.id} className="cut" style={{ left: `${(100 * c.at) / (dur || 1)}%` }} title={`${shotName(c.shotId)} @ ${c.at.toFixed(1)} s`}><span>{shotName(c.shotId).split(' — ')[0]}</span></div>)}
        <div className="playhead" style={{ left: `${(100 * Math.min(tick.time, dur)) / (dur || 1)}%` }} />
      </div>
      <input type="range" min={0} max={dur} step={0.1} value={Math.min(tick.time, dur)} aria-label="Position dans la séquence" disabled={!!busy || tick.playing}
        onChange={(e) => { const t = Number(e.target.value); setTick({ ...tick, time: t }); }}
        onPointerUp={(e) => run('Positionnement…', () => studio.ops.seekSequence(seq.id, Number((e.target as HTMLInputElement).value)))} />
      <div className="seq-controls">
        {tick.playing ? <button className="row-btn" onClick={() => studio.ops.stopSequence()}>■ Arrêter</button> : <button className="row-btn" disabled={!!busy} onClick={() => run(stale ? 'Répétition puis lecture…' : 'Lecture…', () => studio.ops.playSequence(seq.id))}>▶ Lire</button>}
        {!tick.playing && tick.time > 0.05 && tick.time < dur - 0.05 && <button className="row-btn" disabled={!!busy} onClick={() => run('Reprise…', () => studio.sequences.resume(seq))}>⏵ Reprendre</button>}
        <span className="mono">{tick.time.toFixed(1)} / {dur.toFixed(1)} s</span>
        <button className="row-btn" disabled={!!busy} onClick={() => run('Répétition…', () => studio.ops.rehearseSequence(seq.id))}>Re-minuter</button>
        <button className="row-btn" disabled={!!busy} onClick={() => run('Export vidéo…', async () => { setVideo(null); const r = await studio.ops.exportSequence(seq.id, (f) => setBusy(`Export vidéo… ${Math.round(f * 100)} %`)); if (r.ok) setVideo(r.value); return r; })}>Exporter la vidéo</button>
        {video && <a className="row-btn" href={video.url} download={video.filename}>Télécharger ({(video.bytes / 1e6).toFixed(1)} Mo)</a>}
      </div>
      {stale && <div className="world-note" role="status">Minutage à refaire : le décor ou les actions ont changé. Il sera refait automatiquement avant la lecture ou l’export.</div>}

      <div className="pop-title">Actions</div>
      <div className="beats">{seq.beats.map((b, i) => <div key={b.id} className="beat-row">
        <span className="mono">{i + 1}</span>
        <select value={b.kind} aria-label="Type d’action" onChange={(e) => {
          const kind = e.target.value as 'wait' | 'interact';
          const t = targets[0];
          report(kind === 'wait' ? studio.ops.updateBeat(seq.id, b.id, { kind, seconds: b.seconds ?? 2, label: 'Pause', target: undefined, action: undefined })
            : studio.ops.updateBeat(seq.id, b.id, { kind, target: t?.id, action: t?.actions[0]?.id, label: t ? labelFor(t.id, t.actions[0]?.id) : 'Agir' }));
        }}>
          <option value="interact">Agir sur…</option><option value="wait">Pause</option>
          {b.kind !== 'interact' && b.kind !== 'wait' && <option value={b.kind}>{b.kind === 'moveTo' ? 'Marcher' : 'Se tourner'}</option>}
        </select>
        {b.kind === 'interact' && <>
          <select value={b.target} aria-label="Cible" onChange={(e) => { const t = targets.find((x) => x.id === e.target.value); report(studio.ops.updateBeat(seq.id, b.id, { target: e.target.value, action: t?.actions[0]?.id, label: labelFor(e.target.value, t?.actions[0]?.id) })); }}>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={b.action} aria-label="Action" onChange={(e) => report(studio.ops.updateBeat(seq.id, b.id, { action: e.target.value, label: labelFor(b.target!, e.target.value) }))}>
            {(targets.find((t) => t.id === b.target)?.actions ?? []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </>}
        {b.kind === 'wait' && <label><input type="number" min={0.2} max={60} step={0.5} value={b.seconds ?? 1} aria-label="Durée en secondes" onChange={(e) => report(studio.ops.updateBeat(seq.id, b.id, { seconds: Number(e.target.value), label: `Pause ${Number(e.target.value)} s` }))} /> s</label>}
        <span className="beat-tools">
          <button className="icon-mini" disabled={i === 0} aria-label="Monter" onClick={() => report(studio.ops.moveBeat(seq.id, b.id, -1))}>↑</button>
          <button className="icon-mini" disabled={i === seq.beats.length - 1} aria-label="Descendre" onClick={() => report(studio.ops.moveBeat(seq.id, b.id, 1))}>↓</button>
          <button className="icon-mini" disabled={seq.beats.length === 1} aria-label="Supprimer l’action" onClick={() => report(studio.ops.removeBeat(seq.id, b.id))}>✕</button>
        </span>
      </div>)}</div>
      <div className="seq-controls">
        <button className="row-btn" onClick={() => { const t = targets[0]; if (!t) return setMsg('Aucun objet interactif dans ce monde'); report(studio.ops.addBeat(seq.id, { kind: 'interact', target: t.id, action: t.actions[0]?.id, label: labelFor(t.id, t.actions[0]?.id) })); }}>+ Action</button>
        <button className="row-btn" onClick={() => report(studio.ops.addBeat(seq.id, { kind: 'wait', seconds: 2, label: 'Pause 2 s' }))}>+ Pause</button>
        {studio.store.doc.assembly && <>
          <select value={performer} onChange={(e) => setPerformer(e.target.value)} aria-label="Qui se déplace">
            <option value="">Personnage incarné</option>
            {studio.store.doc.entities.filter((e) => (e.metadata?.sim as { kind?: string } | undefined)?.kind === 'person').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="row-btn" title="Destination : le sol au centre de la vue" onClick={() => {
            const cam = studio.cameras.camera, dir = cam.getWorldDirection(new THREE.Vector3());
            const d = studio.collision?.rayDistance(cam.position, dir, 400) ?? Infinity;
            const p = Number.isFinite(d) && d < 400 ? studio.nav?.closest(cam.position.clone().addScaledVector(dir, d)) : null;
            if (!p) return setMsg('Vise un sol praticable au centre de la vue');
            const who = performer ? studio.store.entity(performer)?.name : 'Personnage';
            report(studio.ops.addBeat(seq.id, { kind: 'moveTo', position: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], label: `${who} → (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`, ...(performer ? { actor: performer } : {}) }));
          }}>+ Marche vers le centre de la vue</button>
        </>}
      </div>

      <div className="pop-title">Plans</div>
      <div className="cuts">{seq.cuts.map((c) => <div key={c.id} className="cut-row">
        <select value={c.shotId} onChange={(e) => report(studio.ops.setCut(seq.id, c.id, { shotId: e.target.value }))} aria-label="Cadrage">
          <option value="follow">Suivi (3e personne)</option>
          {studio.store.doc.shots.map((s2) => <option key={s2.id} value={s2.id}>{s2.name}</option>)}
        </select>
        <select value={c.beat} onChange={(e) => report(studio.ops.setCut(seq.id, c.id, { beat: Number(e.target.value) }))} aria-label="Action d’ancrage">{seq.beats.map((b, i) => <option key={b.id} value={i}>{i + 1}. {b.label}</option>)}</select>
        <label>+<input type="number" step={0.5} value={c.offset} onChange={(e) => report(studio.ops.setCut(seq.id, c.id, { offset: Number(e.target.value) }))} aria-label="Décalage en secondes" />s</label>
        <button className="icon-mini" disabled={seq.cuts.length === 1} aria-label="Retirer le plan" onClick={() => report(studio.ops.removeCut(seq.id, c.id))}>✕</button>
      </div>)}</div>
      <div className="seq-controls">
        <button className="row-btn" onClick={() => report(studio.ops.addCut(seq.id, studio.store.doc.shots.at(-1)?.id ?? 'follow', Math.max(0, seq.beats.length - 1), 0))}>+ Plan (dernier cadrage enregistré)</button>
      </div>
      <div className="world-note">Les plans sont ancrés sur les actions : si une action dure plus longtemps, le plan suit. Enregistre un cadrage avec « Save shot » puis ajoute-le ici.</div>
    </>}
    {busy && <div className="world-note" role="status">{busy}</div>}
    {msg && <div className="world-error" role="alert">{msg}</div>}
  </aside>;
}
