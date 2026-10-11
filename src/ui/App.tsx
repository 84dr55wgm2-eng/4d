import { useEffect, useMemo, useState } from 'react';
import type { AssetCategory } from '../core/types';
import type { RemoteAssetResult } from '../assets/AssetRegistry';
import { planWorld, type WorldPlan } from '../world/WorldCreator';
import type { Studio } from '../runtime/Studio';
import { LENSES } from '../runtime/CameraDirector';
import { Icon, type IconName } from './icons';
import { useDocVersion, usePoll, useStudioUI } from './useStudio';

export function App({ studio }: { studio: Studio }) {
  const ui = useStudioUI(studio);
  return (
    <>
      {ui.phase !== 'ready' && <Loading studio={studio} />}
      {ui.phase === 'ready' && (
        <>
          <TopIsland studio={studio} />
          <LibraryRail studio={studio} />
          <Inspector studio={studio} />
          <ActionDock studio={studio} />
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
              <div className="pop-title">Nouveau monde</div>
              <WorldBrief studio={studio} />
            </div>
          )}
        </div>
        <Btn icon="plus" label="Créer un nouveau monde" onClick={() => setMenu(menu === 'world' ? null : 'world')} />
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

function WorldBrief({ studio }: { studio: Studio }) {
  const [brief, setBrief] = useState('Une cour arborée avec quatre immeubles, des chaises et des lumières, au coucher du soleil');
  const [plan, setPlan] = useState<WorldPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = (p: Partial<WorldPlan>) => setPlan((old) => old ? { ...old, ...p } : old);
  return <div className="world-brief">
    <textarea value={brief} onChange={(e) => { setBrief(e.target.value); setPlan(null); }} aria-label="Décrire le nouveau monde" />
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
      <div className="world-note">Kit urbain européen · bâtiments détaillés, sol pavé, chaise, lanterne et objet à prendre. Enveloppes extérieures.</div>
      <div className="kit-options">{studio.registry.manifest.assets.filter((a) => a.entityType === 'BUILDING' && a.bounds).map((a) => <label key={a.id}><input type="checkbox" checked={plan.buildingAssets.includes(a.id)} onChange={(e) => patch({ buildingAssets: e.target.checked ? [...plan.buildingAssets, a.id] : plan.buildingAssets.filter((id) => id !== a.id) })} />{a.name}</label>)}</div>
      {plan.missing.map((m) => <div className="world-error" key={m}>{m}</div>)}
      <button className="world-discover" disabled={busy || !plan.buildingAssets.length} onClick={async () => {
        setBusy(true); setError('');
        try { await studio.createWorld(plan); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
      }}>{busy ? 'Composition et navigation…' : 'Créer et ouvrir ce monde'}</button>
    </div>}
    {error && <div className="world-error" role="alert">{error}</div>}
  </div>;
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
      <span className="hint">Click a destination for the actor</span>
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
      <span className="hint">{actorSelected ? 'Actor selected · tap the ground to move · tap an object to interact' : 'Touche le personnage puis une destination · caméra automatique'}</span>
      {contextId && <span className="context-actions">{studio.interactions.actionsFor(contextId).map((action) => <Btn key={action.id} text={action.label} label={action.label} onClick={async () => { const r = await studio.interactions.execute(contextId, action.id); if (!r.ok) studio.toast(r.error); else studio.toast(action.label); }} />)}</span>}
      {actorSelected && <Btn text="Stop" label="Arrêter le personnage" onClick={() => studio.ops.stopActor()} />}
      {actorSelected && <Btn text="Done" label="Stop directing actor" onClick={() => studio.select(null)} />}
    </>;
  }
  return <div className="dock-wrap"><div className="glass dock">{content}</div></div>;
}

// ------------------------------------------------------------------ diagnostics + toast
function Diagnostics({ studio }: { studio: Studio }) {
  const s = usePoll(() => ({ ...studio.engine.stats, q: studio.engine.effective, cache: { ...studio.registry.cache.stats } }), 500);
  const assets = usePoll(() => studio.registry.manifest.assets.filter((a) => studio.registry.status(a.id) === 'cached').length, 1000);
  return (
    <div className="glass diag mono" aria-label="Diagnostics">
      <div><b>{s.fps}</b> fps · {s.frameMs} ms</div>
      <div>{s.calls} draws · {(s.triangles / 1e6).toFixed(2)}M tris</div>
      <div>{s.geometries} geo · {s.textures} tex · {s.q}</div>
      <div>cached {assets} assets · OPFS {s.cache.opfs ? 'on' : 'off'}</div>
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
