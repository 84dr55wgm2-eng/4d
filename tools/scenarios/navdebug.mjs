export default async ({ run, capture, log }) => {
  log(await run(() => {
    const s = window.studio, V = s.actor.position.constructor;
    const q = (x, y, z) => { const c = s.nav.closest(new V(x, y, z)); return c ? c.toArray().map((v) => +v.toFixed(2)) : null; };
    const door = s.store.entity('door.cafe').transform.position;
    const out = { door, outside: q(-10.5, 0.1, -6.3), threshold: q(-10.5, 0.27, -7.5), inside: q(-10.5, 0.21, -9.5), center: q(-6.6, 0.21, -13) };
    const p = s.nav.path(new V(-10.5, 0.1, -6.3), new V(-6.6, 0.21, -13));
    out.path = p ? p.length : null;
    const g = s.collision.groundHeight(new V(-10.5, 0.21, -9.5), 0.5, 3);
    out.ground = g;
    return JSON.stringify(out);
  }));
  await run(() => { const s = window.studio; s.nav.debugObject().visible = true; s.ops.setCamera({ mode: 'director', position: [-6.6, 22, -6], target: [-6.6, 0, -11], focalLength: 24 }); s.engine.setQuality('balanced'); });
  await capture('navdebug');
};
