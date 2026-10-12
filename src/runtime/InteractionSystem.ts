import * as THREE from 'three';
import type { Entity, Vec3 } from '../core/types';
import type { Studio } from './Studio';

export interface InteractionAction { id: 'open' | 'close' | 'toggle' | 'sit' | 'stand' | 'pickup' | 'putdown'; label: string }
type Config = { enabled?: boolean; state?: string; closedYaw?: number; openYaw?: number; seat?: Vec3; approach?: Vec3; facing?: number; occupiedBy?: string | null; heldBy?: string | null; hinge?: Vec3; closedPosition?: Vec3 };

/** Capability + anchors + preconditions + state transitions, shared by placed and composed objects. */
export class InteractionSystem {
  private active = 0;
  constructor(private studio: Studio) {}
  actionsFor(id: string): InteractionAction[] {
    const e = this.studio.store.entity(id);
    if (!e || e.type === 'ACTOR') return [];
    const cfg = (e.metadata?.interaction ?? {}) as Config;
    const out: InteractionAction[] = [];
    if (e.capabilities.includes('openable') && cfg.hinge) out.push({ id: cfg.state === 'open' ? 'close' : 'open', label: cfg.state === 'open' ? 'Fermer' : 'Ouvrir' });
    if (e.capabilities.includes('toggleable')) out.push({ id: 'toggle', label: cfg.enabled === false ? 'Allumer' : 'Éteindre' });
    if (e.capabilities.includes('sittable') && cfg.seat) out.push({ id: cfg.occupiedBy ? 'stand' : 'sit', label: cfg.occupiedBy ? 'Se lever' : 'S’asseoir' });
    if (e.capabilities.includes('pickable')) out.push({ id: cfg.heldBy ? 'putdown' : 'pickup', label: cfg.heldBy ? 'Poser' : 'Prendre' });
    return out;
  }

  async execute(id: string, action?: string): Promise<{ ok: true; action: string } | { ok: false; error: string }> {
    const e = this.studio.store.entity(id), actor = this.studio.actor;
    if (!e || !actor) return { ok: false, error: 'Objet ou acteur absent' };
    const chosen = this.actionsFor(id).find((a) => !action || a.id === action);
    if (!chosen) return { ok: false, error: 'Action indisponible' };
    const token = ++this.active;
    const cfg = (e.metadata?.interaction ?? {}) as Config;
    const actorId = this.studio.actorEntityId!;
    if (chosen.id === 'stand') {
      if (cfg.occupiedBy !== actorId) return { ok: false, error: 'Cette chaise est occupée' };
      const point = this.anchor(e, cfg.approach ?? [0, 0, 1]);
      const onNav = this.studio.nav?.closest(point);
      if (!onNav || onNav.distanceTo(point) > 0.7) return { ok: false, error: 'Sortie de la chaise inaccessible' };
      actor.place(onNav);
      this.commit(id, 'Se lever', (inter) => { inter.occupiedBy = null; });
      return { ok: true, action: chosen.id };
    }
    if (actor.seated) return { ok: false, error: 'Lève-toi avant cette action' };
    if (chosen.id === 'pickup' && this.studio.store.doc.entities.some((x) => (x.metadata?.interaction as Config)?.heldBy === actorId))
      return { ok: false, error: 'Pose d’abord l’objet que tu portes' };
    if (chosen.id !== 'putdown') {
      const moved = await this.approach(e);
      if (!moved.ok) return moved;
    }
    if (token !== this.active) return { ok: false, error: 'Action remplacée' };
    // Re-read after navigation. Deletion, occupancy or a mode change must not execute stale actions.
    const current = this.studio.store.entity(id);
    if (!current || !this.actionsFor(id).some((a) => a.id === chosen.id)) return { ok: false, error: 'Objet modifié pendant le déplacement' };
    if (chosen.id === 'toggle') {
      this.commit(id, chosen.label, (inter) => { inter.enabled = inter.enabled === false; });
    } else if (chosen.id === 'sit') {
      if (!cfg.seat || cfg.occupiedBy) return { ok: false, error: 'Chaise indisponible' };
      const heading = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...current.transform.rotation), 'YXZ').y + (cfg.facing ?? 0) * Math.PI / 180;
      actor.sit(this.anchor(current, cfg.seat), heading);
      this.commit(id, chosen.label, (inter) => { inter.occupiedBy = actorId; });
    } else if (chosen.id === 'pickup') {
      this.commit(id, chosen.label, (inter) => { inter.heldBy = actorId; });
    } else if (chosen.id === 'putdown') {
      const p = actor.position.clone().add(new THREE.Vector3(Math.sin(actor.heading), 0, Math.cos(actor.heading)).multiplyScalar(0.85));
      const ground = this.studio.collision?.groundHeight(p);
      if (ground === null || ground === undefined) return { ok: false, error: 'Aucune surface pour poser l’objet' };
      p.y = ground;
      this.studio.store.commit(chosen.label, (d) => {
        const t = d.entities.find((x) => x.id === id)!;
        t.transform.position = p.toArray() as Vec3;
        (t.metadata!.interaction as Config).heldBy = null;
      });
    } else {
      // Doors require an authored single-door object; do not turn a whole building.
      const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...current.transform.rotation), 'YXZ').y * 180 / Math.PI;
      const closed = cfg.closedYaw ?? yaw, open = cfg.openYaw ?? closed + 90;
      this.studio.store.commit(chosen.label, (d) => {
        const t = d.entities.find((x) => x.id === id)!;
        const closedPosition = cfg.closedPosition ?? current.transform.position;
        const closedRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), closed * Math.PI / 180);
        const newRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (chosen.id === 'open' ? open : closed) * Math.PI / 180);
        const hinge = new THREE.Vector3(...cfg.hinge!).multiply(new THREE.Vector3(...current.transform.scale));
        const pivot = hinge.clone().applyQuaternion(closedRotation).add(new THREE.Vector3(...closedPosition));
        t.transform.position = pivot.sub(hinge.applyQuaternion(newRotation)).toArray() as Vec3;
        t.transform.rotation = newRotation.toArray() as Entity['transform']['rotation'];
        const inter = ((t.metadata ??= {}).interaction ??= {}) as Config;
        Object.assign(inter, { state: chosen.id === 'open' ? 'open' : 'closed', closedYaw: closed, openYaw: open, closedPosition: cfg.closedPosition ?? current.transform.position });
      });
    }
    return { ok: true, action: chosen.id };
  }

  /** Apply a door/light state change directly (editing / sequence restore) — no approach walk. */
  applyState(id: string, action: 'open' | 'close' | 'toggle', enabled?: boolean) {
    const current = this.studio.store.entity(id);
    if (!current) return { ok: false as const, error: 'Objet introuvable' };
    const cfg = (current.metadata?.interaction ?? {}) as Config;
    if (action === 'toggle') {
      if (!current.capabilities.includes('toggleable')) return { ok: false as const, error: `${current.name} ne s’allume pas` };
      this.commit(id, enabled === false ? 'Éteindre' : 'Allumer', (inter) => { inter.enabled = enabled ?? inter.enabled === false; });
      return { ok: true as const, action };
    }
    if (!current.capabilities.includes('openable') || !cfg.hinge) return { ok: false as const, error: `${current.name} ne s’ouvre pas` };
    if ((cfg.state === 'open') === (action === 'open')) return { ok: true as const, action };
    const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...current.transform.rotation), 'YXZ').y * 180 / Math.PI;
    const closed = cfg.closedYaw ?? yaw, open = cfg.openYaw ?? closed + 90;
    this.studio.store.commit(action === 'open' ? 'Ouvrir' : 'Fermer', (d) => {
      const t = d.entities.find((x) => x.id === id)!;
      const closedPosition = cfg.closedPosition ?? current.transform.position;
      const closedRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), closed * Math.PI / 180);
      const newRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (action === 'open' ? open : closed) * Math.PI / 180);
      const hinge = new THREE.Vector3(...cfg.hinge!).multiply(new THREE.Vector3(...current.transform.scale));
      const pivot = hinge.clone().applyQuaternion(closedRotation).add(new THREE.Vector3(...closedPosition));
      t.transform.position = pivot.sub(hinge.applyQuaternion(newRotation)).toArray() as Vec3;
      t.transform.rotation = newRotation.toArray() as Entity['transform']['rotation'];
      Object.assign(((t.metadata ??= {}).interaction ??= {}) as Config, { state: action === 'open' ? 'open' : 'closed', closedYaw: closed, openYaw: open, closedPosition });
    });
    return { ok: true as const, action };
  }

  private commit(id: string, label: string, change: (cfg: Config) => void) {
    this.studio.store.commit(label, (d) => {
      const target = d.entities.find((x) => x.id === id)!;
      change(((target.metadata ??= {}).interaction ??= {}) as Config);
    });
  }

  private anchor(e: Entity, local: Vec3) {
    return new THREE.Vector3(...local).multiply(new THREE.Vector3(...e.transform.scale))
      .applyQuaternion(new THREE.Quaternion(...e.transform.rotation)).add(new THREE.Vector3(...e.transform.position));
  }

  private async approach(e: Entity): Promise<{ ok: true; action: string } | { ok: false; error: string }> {
    const actor = this.studio.actor!;
    const cfg = (e.metadata?.interaction ?? {}) as Config;
    const target = new THREE.Vector3(...e.transform.position);
    const away = actor.position.clone().sub(target).setY(0);
    if (away.lengthSq() < 0.01) away.set(0, 0, 1);
    const candidate = cfg.approach ? this.anchor(e, cfg.approach) : target.clone().addScaledVector(away.normalize(), 1.05);
    const navPoint = this.studio.nav?.closest(candidate);
    if (!navPoint || navPoint.distanceTo(candidate) > 0.8) return { ok: false, error: 'Point d’interaction inaccessible' };
    const result = await this.studio.ops.moveActorTo(navPoint.toArray() as Vec3);
    if (!result.ok) return { ok: false, error: result.error };
    if (actor.position.distanceTo(navPoint) > 0.45) return { ok: false, error: 'Objet hors de portée' };
    this.studio.ops.turnActorTo(target.toArray() as Vec3);
    return { ok: true, action: 'approach' };
  }

  /** Runtime representation of held objects follows the same saved semantic state. */
  update() {
    const actor = this.studio.actor;
    if (!actor) return;
    actor.root.updateMatrixWorld(true);
    const hand = actor.root.getObjectByName('RightHand');
    for (const e of this.studio.store.doc.entities) {
      if ((e.metadata?.interaction as Config)?.heldBy !== this.studio.actorEntityId) continue;
      const obj = this.studio.entities.objects.get(e.id);
      if (!obj) continue;
      const position = hand ? hand.getWorldPosition(new THREE.Vector3()) : actor.position.clone().add(new THREE.Vector3(0.3, 0.8, 0));
      obj.position.copy(position); obj.rotation.set(0, actor.heading, 0);
    }
  }

  restoreSeat() {
    const e = this.studio.store.doc.entities.find((x) => (x.metadata?.interaction as Config)?.occupiedBy === this.studio.actorEntityId);
    const actor = this.studio.actor;
    if (!e || !actor) { actor?.stand(); return; }
    const cfg = e.metadata!.interaction as Config;
    if (!cfg.seat) return;
    const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...e.transform.rotation), 'YXZ').y;
    actor.sit(this.anchor(e, cfg.seat), yaw + (cfg.facing ?? 0) * Math.PI / 180);
  }
}
