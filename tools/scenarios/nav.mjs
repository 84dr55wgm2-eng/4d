// SPAWN → (navmesh) WALK AROUND OBSTACLES → ENTER SHELTERED AREA → RETURN OUTSIDE → RUN TO SQUARE
export default async ({ run, step, capture, log }) => {
  await run(() => window.studio.engine.setQuality('balanced'));
  const sheltered = await run(() => {
    const s = window.studio, a = s.actor, V = a.position.constructor;
    let best = null;
    for (let dx = -10; dx <= 10; dx += 0.5) for (let dz = -10; dz <= 10; dz += 0.5) {
      const p = s.nav.closest(new V(a.position.x + dx, a.position.y, a.position.z + dz));
      if (!p) continue;
      const o = p.clone(); o.y += 1.9;
      const up = s.collision.rayDistance(o, new V(0, 1, 0), 3);
      if (up < 3 && p.distanceTo(a.position) > 3) { const d = p.distanceTo(a.position); if (!best || d < best.d) best = { p: p.toArray(), d, cover: up + 1.9 }; }
    }
    return best;
  });
  log('sheltered target', sheltered);
  const walk = async (target, opts, label, maxSec = 40) => {
    const t0 = await run(() => window.studio.actor.position.toArray());
    const plan = await run(([t, o]) => { const s = window.studio; window.__arr = null; s.ops.moveActorTo(t, o).then((r) => (window.__arr = r)); return s.actor.path.length; }, [target, opts]);
    let t = 0, mid = false;
    while (t < maxSec) {
      await step(0.5); t += 0.5;
      if (!mid && t >= 1.5) { mid = true; await capture(`n-${label}-moving`); }
      if (await run(() => window.__arr)) break;
    }
    const r = await run(() => window.__arr);
    const p = await run(() => window.studio.actor.position.toArray());
    log(label, 'waypoints', plan, 'arrived', !!r?.ok, 'in', t, 's', 'from', t0.map((v) => v.toFixed(1)), 'to', p.map((v) => v.toFixed(2)), 'target', target.map((v) => v.toFixed(2)));
    return r;
  };
  await walk(sheltered.p, {}, 'enter-shelter');
  await run(() => { const s = window.studio; s.resetFollowCamera(); s.cameras.followYaw += 2.4; s.cameras.followPitch = 0.25; });
  await step(0.6);
  await capture('n-in-shelter');
  const outside = await run(() => { const s = window.studio; return s.nav.closest(new s.actor.position.constructor(-6, 0.2, -6)).toArray(); });
  await walk(outside, {}, 'return-outside');
  const square = await run(() => { const s = window.studio; return s.nav.closest(new s.actor.position.constructor(30, 0.3, 42)).toArray(); });
  await walk(square, { run: true }, 'run-to-square', 60);
  await run(() => { const s = window.studio; s.resetFollowCamera(); s.cameras.followYaw += 2.8; s.cameras.followPitch = 0.15; });
  await step(0.6);
  await capture('n-square');
};
