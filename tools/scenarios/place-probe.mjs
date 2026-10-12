// probe: rebuild request A quickly and inspect the café door reachability (test package, not GTA)
export default async ({ run, log, capture, wait }) => {
  const T = (set, tool, args) => run(([s, t, a]) => Promise.resolve(window.studio.tools.callTool(s, t, a)).then((r) => JSON.parse(JSON.stringify(r ?? null))), [set, tool, args]);
  await run(() => window.studio.assembly.importTestPackage());
  const r = await T('assembly', 'apply_plan', { steps: [
    { op: 'place_set', input: { ref: 'fixture.test-city/cross:fx_downtown#10', position: [0, 0, 0] } },
    { op: 'place_set', input: { ref: 'fixture.test-city/bldg:fx_downtown#1', position: [13.1, 0, 0], yaw: 90 } },
  ] });
  log(r.ok);
  await run(() => window.studio.assembly.rebuildGeometry());
  console.log(JSON.stringify(await run(() => {
    const s = window.studio, e = s.store.doc.entities.find((x) => x.id === 'set_building__1');
    const c = s.assembly.runtime.connectorWorld(e, s.assembly.runtime.setOf(e).connectors.find((x) => x.kind === 'door').id);
    const V = c.world.constructor;
    const inside = c.world.clone().addScaledVector(c.worldNormal, -2), outside = c.world.clone().addScaledVector(c.worldNormal, 2);
    const ci = s.nav.closest(inside), co = s.nav.closest(outside);
    const p = ci && co ? s.nav.path(co, ci) : null;
    return { door: c.world.toArray().map((v) => +v.toFixed(2)), n: c.worldNormal.toArray().map((v) => +v.toFixed(2)), width: c.width, inside: ci?.toArray().map((v) => +v.toFixed(2)), outside: co?.toArray().map((v) => +v.toFixed(2)), path: p?.length ?? null };
  })));
  await run(() => { const s = window.studio; s.set({ placePanel: false }); s.setCameraMode('director'); s.ops.setCamera({ position: [1, 2.2, -4], target: [8, 1.2, 0.5], focalLength: 24 }); s.nav.debugObject().visible = true; });
  await wait(500);
  await capture('p01-door');
};
