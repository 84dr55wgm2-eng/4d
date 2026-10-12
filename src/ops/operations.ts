import * as THREE from 'three';
import { addWorkstations, closedDoorBoxes, enlargeRoom, seatChairAt, setTimeOfDay, type TimeOfDay } from '../world/district/DistrictOps';
import { parseCommand } from '../world/district/Commands';
import { uid } from '../core/emitter';
import type { AssetCategory, CameraShot, Capability, Entity, Sequence, SequenceBeat, Vec3, WorldDocument, WorldState } from '../core/types';
import type { CameraMode } from '../runtime/CameraDirector';
import type { Studio } from '../runtime/Studio';

/**
 * Deterministic world operations. This is the future AI tool layer: an LLM will translate
 * language into these calls, so every op validates input and returns a structured result
 * instead of pretending to succeed.
 */
export type OpResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): OpResult<T> => ({ ok: true, value });
const fail = (error: string): OpResult<never> => ({ ok: false, error });

export function createOps(studio: Studio) {
  const store = () => studio.store;
  const entity = (id: string) => store().entity(id);
  const editable = (id: string): Entity | string => {
    const e = entity(id);
    if (!e) return `no entity ${id}`;
    if (e.locked) return `${e.name} is locked`;
    return e;
  };

  const edit = <T,>(label: string, fn: (d: WorldDocument) => T): OpResult<T> => {
    let out: T | undefined, err = '';
    const committed = store().commit(label, (d) => { try { out = fn(d); } catch (e) { err = e instanceof Error ? e.message : String(e); return false; } });
    return committed ? ok(out as T) : fail(err || 'Modification refusée');
  };

  /** a new target joins the start state as it is now, so playback always starts from the same world */
  const captureTarget = (d: WorldDocument, sq: Sequence, target?: string) => {
    if (!target || sq.start.entities[target]) return;
    const e = d.entities.find((x) => x.id === target);
    if (e) sq.start.entities[target] = { transform: structuredClone(e.transform), interaction: structuredClone(e.metadata?.interaction as Record<string, unknown> | undefined) };
  };
  /** actions available from any state (e.g. a seated chair offers « stand »; a sequence can also « sit ») */
  const extraActions = (e: Entity) => {
    const out: { id: string; label: string }[] = [];
    if (e.capabilities.includes('sittable')) out.push({ id: 'sit', label: 'S’asseoir' }, { id: 'stand', label: 'Se lever' });
    if (e.capabilities.includes('openable')) out.push({ id: 'open', label: 'Ouvrir' }, { id: 'close', label: 'Fermer' });
    if (e.capabilities.includes('pickable')) out.push({ id: 'pickup', label: 'Prendre' }, { id: 'putdown', label: 'Poser' });
    if (e.capabilities.includes('toggleable')) out.push({ id: 'toggle', label: 'Allumer / éteindre' });
    return out;
  };
  const validateBeat = (b: Partial<SequenceBeat>): string | null => {
    if (b.kind === 'wait') return b.seconds !== undefined && b.seconds >= 0.2 && b.seconds <= 60 ? null : 'Durée entre 0,2 et 60 s';
    if (b.kind === 'interact') {
      const e = b.target ? store().entity(b.target) : null;
      if (!e) return 'Cible introuvable';
      const ids = new Set([...studio.interactions.actionsFor(e.id), ...extraActions(e)].map((a) => a.id));
      return b.action && ids.has(b.action) ? null : `« ${e.name} » ne propose pas cette action`;
    }
    if (b.kind === 'moveTo' || b.kind === 'turnTo') {
      if (!b.position?.every(Number.isFinite)) return 'Position invalide';
      if (b.kind === 'moveTo') { const p = studio.nav?.closest(new THREE.Vector3(...b.position)); if (!p || p.distanceTo(new THREE.Vector3(...b.position)) > 0.8) return 'Destination hors des zones praticables'; }
      return null;
    }
    return 'Type d’action inconnu';
  };

  const ops = {
    getState() {
      const d = store().doc;
      return {
        world: d.name,
        mode: studio.ui.mode,
        camera: { mode: studio.cameras.mode, ...studio.cameras.currentShot() },
        selection: studio.ui.selection,
        actor: studio.actor ? { position: studio.actor.position.toArray(), heading: studio.actor.heading, state: studio.actor.state } : null,
        entities: d.entities.map((e) => ({ id: e.id, type: e.type, name: e.name, position: e.transform.position, locked: !!e.locked })),
        shots: d.shots.map((s) => ({ id: s.id, name: s.name })),
        zones: d.zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind })),
        worldState: d.worldState,
      };
    },

    selectEntity(id: string | null): OpResult<string | null> {
      if (id && !entity(id)) return fail(`no entity ${id}`);
      studio.select(id);
      return ok(id);
    },

    moveEntity(id: string, position: Vec3, opts: { relative?: boolean; snapToGround?: boolean } = {}): OpResult<Vec3> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      const p = new THREE.Vector3(...position);
      if (opts.relative) p.add(new THREE.Vector3(...e.transform.position));
      if (opts.snapToGround !== false && studio.collision) {
        const g = studio.collision.groundHeight(p, 1.5, 6);
        if (g !== null) p.y = g;
      }
      if (id === studio.actorEntityId && studio.actor) studio.actor.place(p);
      const out = p.toArray() as Vec3;
      if (!store().commit(`Move ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.transform.position = out; })) return fail('Déplacement invalide');
      return ok(out);
    },

    rotateEntity(id: string, yawDegrees: number, opts: { relative?: boolean } = {}): OpResult<number> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      const cur = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...e.transform.rotation), 'YXZ').y;
      const yaw = (opts.relative ? cur : 0) + THREE.MathUtils.degToRad(yawDegrees);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      if (id === studio.actorEntityId && studio.actor) studio.actor.place(studio.actor.position.clone(), yaw);
      if (!store().commit(`Rotate ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.transform.rotation = q.toArray() as Entity['transform']['rotation']; })) return fail('Rotation invalide');
      return ok(THREE.MathUtils.radToDeg(yaw));
    },

    scaleEntity(id: string, scale: number): OpResult<number> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      if (!e.capabilities.includes('scalable')) return fail(`${e.name} is not scalable`);
      if (!(scale > 0.05 && scale < 20)) return fail('scale out of range (0.05..20)');
      if (!store().commit(`Scale ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.transform.scale = [scale, scale, scale]; })) return fail('Échelle invalide');
      return ok(scale);
    },

    duplicateEntity(id: string): OpResult<string> {
      const e = entity(id);
      if (!e) return fail(`no entity ${id}`);
      if (e.type === 'ACTOR') return fail('the hero actor cannot be duplicated in V1');
      const copy: Entity = structuredClone(e);
      copy.id = uid(e.type.toLowerCase());
      copy.name = `${e.name} copy`;
      copy.locked = false;
      copy.transform.position = [e.transform.position[0] + 0.8, e.transform.position[1], e.transform.position[2] + 0.8];
      if (!store().commit(`Duplicate ${e.name}`, (d) => { d.entities.push(copy); })) return fail('Position de la copie invalide');
      studio.select(copy.id);
      return ok(copy.id);
    },

    deleteEntity(id: string): OpResult<string> {
      const e = editable(id);
      if (typeof e === 'string') return fail(e);
      if (e.type === 'ACTOR') return fail('the hero actor cannot be deleted');
      store().commit(`Delete ${e.name}`, (d) => { d.entities = d.entities.filter((x) => x.id !== id); });
      return ok(id);
    },

    lockEntity(id: string, locked: boolean): OpResult<boolean> {
      const e = entity(id);
      if (!e) return fail(`no entity ${id}`);
      store().commit(`${locked ? 'Lock' : 'Unlock'} ${e.name}`, (d) => { d.entities.find((x) => x.id === id)!.locked = locked; });
      return ok(locked);
    },

    findAssets(query = '', category?: AssetCategory) {
      return studio.registry.find(query, category).map((a) => ({ id: a.id, name: a.name, category: a.category, source: a.source, cache: studio.registry.status(a.id) }));
    },

    placeAsset(assetId: string, position: Vec3, yawDegrees = 0): OpResult<string> {
      let rec;
      try { rec = studio.registry.get(assetId); } catch { return fail(`unknown asset ${assetId}`); }
      if (!rec.entityType || rec.category === 'ANIMATIONS' || rec.category === 'ENVIRONMENT' || rec.category === 'CHARACTERS') return fail(`${rec.name} is not placeable`);
      const p = new THREE.Vector3(...position);
      if (studio.collision) {
        const g = studio.collision.groundHeight(p, 1.5, 6);
        if (g !== null) p.y = g;
      }
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDegrees));
      const caps: Capability[] = ['selectable', 'movable', 'rotatable', 'scalable', 'collidable'];
      if (rec.entityType === 'LIGHT') caps.push('interactable', 'toggleable');
      if (rec.entityType === 'DOOR') caps.push('interactable', 'openable');
      if (rec.entityType === 'CHAIR' && rec.runtime?.interaction) caps.push('interactable', 'sittable');
      if ((rec.runtime?.interaction as { pickable?: boolean } | undefined)?.pickable) caps.push('interactable', 'pickable');
      const interaction = rec.runtime?.interaction ? structuredClone(rec.runtime.interaction) : undefined;
      const e: Entity = {
        id: uid(rec.entityType.toLowerCase()), type: rec.entityType, name: rec.name, assetId,
        transform: { position: p.toArray() as Vec3, rotation: q.toArray() as Entity['transform']['rotation'], scale: [1, 1, 1] },
        parentId: null, tags: [...rec.tags], capabilities: caps,
        metadata: interaction ? { interaction } : undefined,
      };
      if (!store().commit(`Place ${rec.name}`, (d) => { d.entities.push(e); })) return fail('Emplacement invalide');
      studio.select(e.id);
      return ok(e.id);
    },

    /** Navmesh-planned walk/run. Resolves when the actor arrives (or fails honestly). */
    moveActorTo(target: Vec3, opts: { run?: boolean } = {}): Promise<OpResult<Vec3>> {
      const a = studio.actor;
      if (!a) return Promise.resolve(fail('no actor'));
      if (!studio.nav) return Promise.resolve(fail('no navigation mesh loaded'));
      if (a.seated) return Promise.resolve(fail('Lève-toi avant de marcher'));
      if (!target.every(Number.isFinite)) return Promise.resolve(fail('invalid destination'));
      const path = studio.nav.path(a.position, new THREE.Vector3(...target));
      if (!path) return Promise.resolve(fail('no walkable path to target'));
      // a closed door is a real obstacle: refuse paths that would cross it (open it first)
      const doors = closedDoorBoxes(studio.store.doc);
      for (let i = 1; i < path.length && doors.length; i++) {
        const seg = new THREE.Ray(path[i - 1].clone().setY(path[i - 1].y + 1), path[i].clone().sub(path[i - 1]).setY(0).normalize());
        const len = path[i].clone().sub(path[i - 1]).setY(0).length();
        for (const d of doors) {
          const hit = seg.intersectBox(d.box.clone().expandByScalar(0.05), new THREE.Vector3());
          if (hit && hit.distanceTo(seg.origin) <= len) return Promise.resolve(fail(`${studio.store.entity(d.id)?.name ?? 'La porte'} est fermée — ouvre-la d’abord`));
        }
      }
      a.cancelPath();
      const points = path.filter((p, i) => i > 0 || p.distanceTo(a.position) > 0.15);
      if (!points.length) return Promise.resolve(ok(a.position.toArray() as Vec3));
      return new Promise((resolve) => {
        let elapsed = 0, stalled = 0;
        let last = a.position.clone();
        const off = studio.engine.onUpdate((dt) => {
          elapsed += dt;
          stalled = a.position.distanceTo(last) < 0.001 ? stalled + dt : 0;
          last.copy(a.position);
          if (elapsed > 120 || stalled > 8) a.cancelPath();
        });
        a.setPath(points, opts.run ? a.runSpeed : a.walkSpeed, () => { off(); resolve(ok(a.position.toArray() as Vec3)); });
        a.onCancel = () => { off(); resolve(fail('Movement interrupted or destination blocked')); };
      });
    },

    getInteractions(id: string) {
      return studio.interactions.actionsFor(id);
    },

    interact(id: string, action?: string) {
      return studio.interactions.execute(id, action);
    },

    stopActor(): OpResult<undefined> {
      if (!studio.actor) return fail('no actor');
      studio.actor.cancelPath();
      return ok(undefined);
    },

    turnActorTo(target: Vec3 | number): OpResult<number> {
      const a = studio.actor;
      if (!a) return fail('no actor');
      const heading = typeof target === 'number' ? THREE.MathUtils.degToRad(target) : Math.atan2(target[0] - a.position.x, target[2] - a.position.z);
      a.cancelPath();
      a.targetHeading = heading;
      return ok(THREE.MathUtils.radToDeg(heading));
    },

    setCamera(opts: { mode?: CameraMode; position?: Vec3; target?: Vec3; focalLength?: number; lookAtActor?: boolean }): OpResult<undefined> {
      if (opts.mode) studio.setCameraMode(opts.mode);
      if (opts.position || opts.target) {
        if (studio.cameras.mode === 'follow') studio.setCameraMode('director');
        const pos = opts.position ? new THREE.Vector3(...opts.position) : studio.cameras.camera.position.clone();
        const tgt = opts.target ? new THREE.Vector3(...opts.target) : studio.cameras.orbitTarget.clone();
        studio.cameras.setPose(pos, tgt);
      }
      if (opts.lookAtActor && studio.actor) studio.cameras.lookAt(studio.actor.headPosition());
      if (opts.focalLength) {
        if (!(opts.focalLength >= 10 && opts.focalLength <= 200)) return fail('focal length out of range (10..200mm)');
        studio.cameras.setLens(opts.focalLength);
      }
      return ok(undefined);
    },

    saveShot(name?: string): OpResult<string> {
      const shots = store().doc.shots;
      const label = name?.trim() || `SHOT_${String.fromCharCode(65 + (shots.length % 26))}${shots.length >= 26 ? Math.floor(shots.length / 26) : ''}`;
      const shot: CameraShot = { id: uid('shot'), name: label, ...studio.cameras.currentShot() };
      store().commit(`Save ${label}`, (d) => { d.shots.push(shot); });
      studio.toast(`Saved ${label}`);
      return ok(shot.id);
    },

    recallShot(idOrName: string, duration = 0.9): OpResult<string> {
      const s = store().doc.shots.find((x) => x.id === idOrName || x.name === idOrName);
      if (!s) return fail(`no shot ${idOrName}`);
      if (studio.ui.mode !== 'direct') studio.set({ mode: 'direct' });
      studio.cameras.goTo(s, duration);
      return ok(s.id);
    },

    deleteShot(id: string): OpResult<string> {
      const s = store().doc.shots.find((x) => x.id === id);
      if (!s) return fail(`no shot ${id}`);
      store().commit(`Delete ${s.name}`, (d) => { d.shots = d.shots.filter((x) => x.id !== id); });
      return ok(id);
    },

    setWorldState(patch: Partial<WorldState>): OpResult<WorldState> {
      store().commit('World state', (d) => { Object.assign(d.worldState, patch); });
      return ok(store().doc.worldState);
    },

    // ------------------------------------------------------------ district edits (targeted, one undo step each)
    enlargeRoom(roomId = 'room.cafe', metres = 3): OpResult<unknown> {
      return edit(`Agrandir la pièce de ${metres} m`, (d) => enlargeRoom(d, roomId, metres));
    },
    addWorkstations(roomId = 'room.cafe', count = 2, wall: 'left' | 'right' | 'back' | 'auto' = 'auto'): OpResult<string[]> {
      const walls = wall === 'auto' ? (['left', 'right', 'back'] as const) : [wall];
      let last = '';
      for (const w of walls) {
        const r = edit(`Ajouter ${count} poste(s)`, (d) => addWorkstations(d, roomId, count, w, studio.registry.manifest.assets));
        if (r.ok) return r;
        last = r.error;
      }
      return fail(last);
    },
    placeChairAt(chairId: string, targetId: string): OpResult<string> {
      return edit('Placer la chaise au poste', (d) => seatChairAt(d, chairId, targetId, studio.registry.manifest.assets));
    },
    setTimeOfDay(time: TimeOfDay): OpResult<TimeOfDay> {
      if (!store().doc.district) return fail('Le changement d’heure ciblé est disponible pour les mondes de quartier');
      return edit(`Heure : ${time}`, (d) => { setTimeOfDay(d, time); return time; });
    },
    /** Deterministic French command → validated operation (see Commands.ts). */
    command(text: string): OpResult<string> {
      const intent = parseCommand(text);
      if ('error' in intent) return fail(intent.error);
      const hist = studio.selectionHistory;
      switch (intent.op) {
        case 'enlargeRoom': { const r = ops.enlargeRoom(intent.room, intent.metres); return r.ok ? ok(`Cybercafé agrandi de ${intent.metres} m vers l’arrière ; la façade et la rue sont inchangées.`) : r; }
        case 'addWorkstations': { const r = ops.addWorkstations(intent.room, intent.count, intent.wall); return r.ok ? ok(`${intent.count} poste(s) ajouté(s) : ${r.value.join(', ')}`) : r; }
        case 'seatChairAt': {
          const chair = [...hist].reverse().find((id) => store().entity(id)?.type === 'CHAIR');
          const target = [...hist].reverse().find((id) => id !== chair && store().entity(id)?.metadata?.workstation && store().entity(id)?.type !== 'CHAIR');
          if (!chair || !target) return fail('Sélectionne d’abord la chaise, puis l’ordinateur ou la table du poste (mode ÉDITION), puis relance la commande.');
          const before = store().doc.entities.filter((e) => e.type === 'CHAIR').map((e) => e.transform.position.join());
          const r = ops.placeChairAt(chair, target);
          if (!r.ok) return r;
          const moved = store().doc.entities.filter((e) => e.type === 'CHAIR' && e.id !== chair && !before.includes(e.transform.position.join()));
          return ok(`${store().entity(chair)?.name} placée au poste ${store().entity(r.value)?.metadata?.workstation}` + (moved.length ? ` ; ${moved[0].name} prend son ancienne place` : ''));
        }
        case 'setTimeOfDay': { const r = ops.setTimeOfDay(intent.time); return r.ok ? ok('Lumière modifiée ; bâtiments et objets inchangés.') : r; }
        case 'toggleLights': { const r = studio.interactions.applyState('light.cafe', 'toggle', intent.on); return r.ok ? ok(intent.on === false ? 'Néons éteints' : 'Néons allumés') : fail(r.error); }
        case 'openDoor': { const r = studio.interactions.applyState('door.cafe', intent.open ? 'open' : 'close'); return r.ok ? ok(intent.open ? 'Porte ouverte' : 'Porte fermée') : fail(r.error); }
      }
    },

    // ------------------------------------------------------------ direction: shots → sequence
    /** « Le personnage marche vers le cybercafé, ouvre la porte, entre, rejoint un poste et s'assoit. » */
    async createReferenceSequence(chairId = 'ws.1.chair'): Promise<OpResult<string>> {
      const d = store().doc;
      const door = d.entities.find((e) => e.type === 'DOOR'), chair = store().entity(chairId);
      if (!door || !chair) return fail('Ce monde n’a pas de porte et de poste pour la scène de référence');
      const seq = studio.sequences;
      const v = (p: Vec3) => new THREE.Vector3(...p);
      const doorP = v(door.transform.position), chairP = v(chair.transform.position);
      const shot = (name: string, position: THREE.Vector3, target: THREE.Vector3, focalLength: number): CameraShot =>
        ({ id: uid('shot'), name, position: position.toArray() as Vec3, target: target.toArray() as Vec3, focalLength });
      // exterior establishing shot from across the street, a human-height interior shot at the workstation
      const outward = new THREE.Vector3(0, 0, Math.sign(-doorP.z) || 1);
      const shots = [
        shot('PLAN_A — ensemble rue', doorP.clone().add(new THREE.Vector3(9, 1.55, 0)).add(outward.clone().multiplyScalar(11.5)), doorP.clone().add(new THREE.Vector3(-1.5, 1.6, 0)), 24),
        shot('PLAN_C — poste intérieur', chairP.clone().add(new THREE.Vector3(2.4, 1.45, 2.1)), chairP.clone().add(new THREE.Vector3(-0.3, 0.95, -0.2)), 35),
      ];
      store().commit('Plans de la séquence', (dd) => { dd.shots.push(...shots); });
      const beats = [
        { id: uid('beat'), kind: 'interact' as const, label: 'Marche vers le cybercafé et ouvre la porte', target: door.id, action: 'open' },
        { id: uid('beat'), kind: 'interact' as const, label: 'Entre, rejoint le poste et s’assoit', target: chair.id, action: 'sit' },
        { id: uid('beat'), kind: 'wait' as const, label: 'Regarde l’écran', seconds: 2.5 },
      ];
      const sq = seq.create('Arrivée au cybercafé', beats, [
        { id: uid('cut'), shotId: shots[0].id, beat: 0, offset: 0 },
        { id: uid('cut'), shotId: 'follow', beat: 0, offset: 3.2 },
        { id: uid('cut'), shotId: shots[1].id, beat: 1, offset: 1.2 },
      ]);
      try { await seq.rehearse(sq); } catch (e) { return fail(`Répétition impossible : ${e instanceof Error ? e.message : String(e)}`); }
      store().commit('Séquence de référence', (dd) => { (dd.sequences ??= []).push(sq); });
      return ok(sq.id);
    },
    /** empty sequence from the current world: one pause, third-person camera; actions are added in the panel */
    createSequence(name = 'Nouvelle séquence'): OpResult<string> {
      if (!studio.actor) return fail('Aucun personnage');
      const sq = studio.sequences.create(name, [{ id: uid('beat'), kind: 'wait', label: 'Pause', seconds: 2 }], [{ id: uid('cut'), shotId: 'follow', beat: 0, offset: 0 }]);
      return edit('Nouvelle séquence', (d) => { (d.sequences ??= []).push(sq); return sq.id; });
    },
    addCut(seqId: string, shotId = 'follow', beat = 0, offset = 0): OpResult<string> {
      const id = uid('cut');
      return edit('Ajouter un plan à la séquence', (d) => {
        const sq = d.sequences?.find((x) => x.id === seqId);
        if (!sq) throw new Error('Séquence introuvable');
        if (shotId !== 'follow' && !d.shots.some((x) => x.id === shotId)) throw new Error('Cadrage inconnu');
        sq.cuts.push({ id, shotId, beat: Math.min(beat, sq.beats.length - 1), offset });
        return id;
      });
    },
    removeCut(seqId: string, cutId: string): OpResult<undefined> {
      return edit('Retirer un plan de la séquence', (d) => {
        const sq = d.sequences?.find((x) => x.id === seqId);
        if (!sq || !sq.cuts.some((c) => c.id === cutId)) throw new Error('Plan introuvable');
        if (sq.cuts.length === 1) throw new Error('Une séquence garde au moins un plan');
        sq.cuts = sq.cuts.filter((c) => c.id !== cutId);
        return undefined;
      });
    },
    sequence(id?: string) {
      const list = store().doc.sequences ?? [];
      return id ? list.find((x) => x.id === id) ?? null : list.at(-1) ?? null;
    },
    async rehearseSequence(id: string): Promise<OpResult<unknown>> {
      const sq = structuredClone(ops.sequence(id));
      if (!sq) return fail('Séquence introuvable');
      try { const timing = await studio.sequences.rehearse(sq); store().commit('Minutage de la séquence', (d) => { const x = d.sequences!.find((y) => y.id === id)!; x.timing = timing; }); return ok(timing); }
      catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
    },
    /** the stored sequence, re-rehearsed first when the world or its actions changed since its timing was measured */
    async timedSequence(id: string): Promise<OpResult<Sequence>> {
      const sq = ops.sequence(id);
      if (!sq) return fail('Séquence introuvable');
      if (studio.sequences.isStale(sq)) {
        const r = await ops.rehearseSequence(id);
        if (!r.ok) return r;
      }
      return ok(structuredClone(ops.sequence(id)!));
    },
    async playSequence(id: string): Promise<OpResult<string>> {
      const r = await ops.timedSequence(id);
      if (!r.ok) return r;
      void studio.sequences.play(r.value);
      return ok(id);
    },
    stopSequence() { studio.sequences.stop(); return ok(undefined); },
    async seekSequence(id: string, t: number): Promise<OpResult<number>> {
      const r = await ops.timedSequence(id);
      if (!r.ok) return r;
      try { const at = await studio.sequences.seek(r.value, t); return ok(at.time); }
      catch (e) { return fail(`Lecture interrompue : ${e instanceof Error ? e.message : String(e)}`); }
    },
    async exportSequence(id: string, onProgress?: (f: number) => void): Promise<OpResult<{ url: string; filename: string; bytes: number; frames: number }>> {
      const r = await ops.timedSequence(id);
      if (!r.ok) return r;
      const sq = r.value;
      try {
        const { blob, mime, frames } = await studio.sequences.export(sq, { onProgress });
        const filename = `${sq.name.replace(/[^\p{L}\p{N}]+/gu, '_')}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`;
        return ok({ url: URL.createObjectURL(blob), filename, bytes: blob.size, frames });
      } catch (e) { return fail(`Export interrompu : ${e instanceof Error ? e.message : String(e)}`); }
    },

    // ---------------------------------------------------------------- action editing (cuts stay anchored to their action)
    /** Add an action; interact needs a target offering that action, wait a duration, moveTo a reachable point. */
    addBeat(seqId: string, beat: Omit<SequenceBeat, 'id'>, index?: number): OpResult<string> {
      const check = validateBeat(beat);
      if (check) return fail(check);
      const id = uid('beat');
      return edit('Ajouter une action', (d) => {
        const sq = d.sequences?.find((x) => x.id === seqId);
        if (!sq) throw new Error('Séquence introuvable');
        const at = Math.max(0, Math.min(index ?? sq.beats.length, sq.beats.length));
        sq.beats.splice(at, 0, { ...beat, id });
        for (const c of sq.cuts) if (c.beat >= at && at < sq.beats.length - 1) c.beat++;
        captureTarget(d, sq, beat.target);
        return id;
      });
    },
    removeBeat(seqId: string, beatId: string): OpResult<undefined> {
      return edit('Supprimer une action', (d) => {
        const sq = d.sequences?.find((x) => x.id === seqId);
        const i = sq?.beats.findIndex((b) => b.id === beatId) ?? -1;
        if (!sq || i < 0) throw new Error('Action introuvable');
        if (sq.beats.length === 1) throw new Error('Une séquence garde au moins une action');
        sq.beats.splice(i, 1);
        // cuts of the removed action move to the action that now takes its place (offset kept), later ones shift
        for (const c of sq.cuts) if (c.beat > i) c.beat--; else if (c.beat === i) c.beat = Math.min(i, sq.beats.length - 1);
        return undefined;
      });
    },
    moveBeat(seqId: string, beatId: string, delta: -1 | 1): OpResult<undefined> {
      return edit('Réordonner les actions', (d) => {
        const sq = d.sequences?.find((x) => x.id === seqId);
        const i = sq?.beats.findIndex((b) => b.id === beatId) ?? -1;
        const j = i + delta;
        if (!sq || i < 0 || j < 0 || j >= sq.beats.length) throw new Error('Déplacement impossible');
        [sq.beats[i], sq.beats[j]] = [sq.beats[j], sq.beats[i]];
        // a cut follows the action it is anchored to
        for (const c of sq.cuts) c.beat = c.beat === i ? j : c.beat === j ? i : c.beat;
        return undefined;
      });
    },
    updateBeat(seqId: string, beatId: string, patch: Partial<Omit<SequenceBeat, 'id'>>): OpResult<undefined> {
      return edit('Modifier une action', (d) => {
        const sq = d.sequences?.find((x) => x.id === seqId);
        const b = sq?.beats.find((x) => x.id === beatId);
        if (!sq || !b) throw new Error('Action introuvable');
        const next = { ...b, ...patch };
        if (patch.target && !patch.action) next.action = studio.interactions.actionsFor(patch.target)[0]?.id;
        const check = validateBeat(next);
        if (check) throw new Error(check);
        Object.assign(b, next);
        captureTarget(d, sq, b.target);
        return undefined;
      });
    },
    /** objects an action can target, with their actions (for the panel) */
    beatTargets() {
      return store().doc.entities.filter((e) => e.capabilities.includes('interactable'))
        .map((e) => {
          const actions = new Map<string, string>();
          for (const a of [...studio.interactions.actionsFor(e.id), ...extraActions(e)]) if (!actions.has(a.id)) actions.set(a.id, a.label);
          return { id: e.id, name: e.name, actions: [...actions].map(([id, label]) => ({ id, label })) };
        });
    },
    setCut(seqId: string, cutId: string, patch: { shotId?: string; beat?: number; offset?: number }): OpResult<undefined> {
      return edit('Modifier un plan de la séquence', (d) => {
        const c = d.sequences?.find((x) => x.id === seqId)?.cuts.find((x) => x.id === cutId);
        if (!c) throw new Error('Plan introuvable');
        if (patch.shotId && patch.shotId !== 'follow' && !d.shots.some((x) => x.id === patch.shotId)) throw new Error('Cadrage inconnu');
        Object.assign(c, patch);
        return undefined;
      });
    },

    undo() { store().undo(); return ok(store().canUndo); },
    redo() { store().redo(); return ok(store().canRedo); },
    save() { return studio.save(); },
  };
  return ops;
}

export type StudioOps = ReturnType<typeof createOps>;
