import * as THREE from 'three';
import type { Entity, Vec3 } from '../core/types';
import type { Studio } from './Studio';

export interface InteractionAction {
  id: 'approach' | 'open' | 'close' | 'toggle';
  label: string;
}

/**
 * Semantic interaction layer. Objects expose capabilities/state in WorldDocument;
 * the actor navigates to a valid approach point before the action is applied.
 */
export class InteractionSystem {
  constructor(private studio: Studio) {}

  actionsFor(id: string): InteractionAction[] {
    const e = this.studio.store.entity(id);
    if (!e || e.type === 'ACTOR') return [];
    const out: InteractionAction[] = [{ id: 'approach', label: 'Approach' }];
    const state = (e.metadata?.interaction ?? {}) as { state?: string; enabled?: boolean };
    if (e.capabilities.includes('openable')) out.push({ id: state.state === 'open' ? 'close' : 'open', label: state.state === 'open' ? 'Close' : 'Open' });
    if (e.capabilities.includes('toggleable')) out.push({ id: 'toggle', label: state.enabled === false ? 'Turn on' : 'Turn off' });
    return out;
  }

  async execute(id: string, action?: string): Promise<{ ok: true; action: string } | { ok: false; error: string }> {
    const e = this.studio.store.entity(id);
    if (!e) return { ok: false, error: `No entity ${id}` };
    if (e.type === 'ACTOR') return { ok: false, error: 'Select the actor, then tap a destination or object.' };
    const actions = this.actionsFor(id);
    const chosen = action ? actions.find((a) => a.id === action) : actions.find((a) => a.id !== 'approach') ?? actions[0];
    if (!chosen) return { ok: false, error: `${e.name} has no interaction` };

    const moved = await this.approach(e);
    if (!moved.ok) return moved;
    if (chosen.id === 'approach') return { ok: true, action: 'approach' };

    if (chosen.id === 'toggle') {
      this.studio.store.commit(`Toggle ${e.name}`, (d) => {
        const target = d.entities.find((x) => x.id === id)!;
        const meta = (target.metadata ??= {});
        const inter = (meta.interaction ??= {}) as Record<string, unknown>;
        inter.enabled = inter.enabled === false;
      });
      return { ok: true, action: 'toggle' };
    }

    if (chosen.id === 'open' || chosen.id === 'close') {
      const cfg = (e.metadata?.interaction ?? {}) as { state?: string; closedYaw?: number; openYaw?: number };
      const currentYaw = yawDegrees(e);
      const closedYaw = cfg.closedYaw ?? currentYaw;
      const openYaw = cfg.openYaw ?? closedYaw + 90;
      const yaw = chosen.id === 'open' ? openYaw : closedYaw;
      this.studio.ops.rotateEntity(id, yaw);
      this.studio.store.commit(`${chosen.id === 'open' ? 'Open' : 'Close'} ${e.name}`, (d) => {
        const target = d.entities.find((x) => x.id === id)!;
        const meta = (target.metadata ??= {});
        const inter = (meta.interaction ??= {}) as Record<string, unknown>;
        inter.state = chosen.id === 'open' ? 'open' : 'closed';
        if (inter.closedYaw === undefined) inter.closedYaw = closedYaw;
        if (inter.openYaw === undefined) inter.openYaw = openYaw;
      });
      return { ok: true, action: chosen.id };
    }

    return { ok: false, error: `Unsupported interaction ${chosen.id}` };
  }

  private async approach(e: Entity): Promise<{ ok: true; action: string } | { ok: false; error: string }> {
    const actor = this.studio.actor;
    if (!actor) return { ok: false, error: 'No actor loaded' };
    const target = new THREE.Vector3(...e.transform.position);
    const away = actor.position.clone().sub(target);
    away.y = 0;
    if (away.lengthSq() < 0.01) away.set(0, 0, 1);
    away.normalize();
    const candidate = target.clone().addScaledVector(away, interactionDistance(e));
    const navPoint = this.studio.nav?.closest(candidate) ?? candidate;
    const result = await this.studio.ops.moveActorTo(navPoint.toArray() as Vec3);
    if (!result.ok) return { ok: false, error: result.error };
    this.studio.ops.turnActorTo(target.toArray() as Vec3);
    return { ok: true, action: 'approach' };
  }
}

function interactionDistance(e: Entity) {
  if (e.type === 'VEHICLE' || e.type === 'BUILDING') return 1.8;
  if (e.type === 'DOOR') return 0.8;
  return 1.05;
}

function yawDegrees(e: Entity) {
  const q = new THREE.Quaternion(...e.transform.rotation);
  return THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(q, 'YXZ').y);
}
