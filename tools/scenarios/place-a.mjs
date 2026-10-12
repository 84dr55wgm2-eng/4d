// Place studio, request A (test package — NOT GTA content):
// default home → import the test package → "un café à l'angle d'un carrefour, avec des clients" through the
// studio tools (same calls as the agent) → embodied package character → save, reload, reopen → captures.
export default async ({ page, run, wait, log, capture, shot, step }) => {
  const waitReady = async () => {
    for (let i = 0; i < 120; i++) {
      const p = await run(() => window.studio?.ui.phase).catch(() => null);
      if (p === 'ready' || p === 'error') return p;
      await wait(3000);
    }
    throw new Error('ready timeout');
  };
  const T = (set, tool, args) => run(([s, t, a]) => Promise.resolve(window.studio.tools.callTool(s, t, a)).then((r) => JSON.parse(JSON.stringify(r ?? null))), [set, tool, args]);

  log('home', await run(() => ({ name: window.studio.store.doc.name, assembly: !!window.studio.store.doc.assembly, entities: window.studio.store.doc.entities.length, actor: !!window.studio.actor })));
  await shot('a00-home');

  const t0 = Date.now();
  log('import', await run(() => window.studio.assembly.importTestPackage().then((e) => ({ id: e.id, sets: e.sets, bytes: e.bytes, backend: e.backend }))), `${Date.now() - t0} ms`);
  log('packages', await T('catalog', 'list_packages', {}));
  const cross = (await T('catalog', 'search_sets', { query: 'carrefour', kind: 'intersection' }))[0];
  const cafe = (await T('catalog', 'search_sets', { query: 'café accessible', kind: 'building' }))[0];
  const street = (await T('catalog', 'search_sets', { query: 'rue', kind: 'street' })).find((s) => !/downtown/.test(s.ref));
  log('candidates', cross.ref, cafe.ref, cafe.accesses, street.ref);
  const X = await T('catalog', 'inspect_set', { ref: cross.ref });
  const S = await T('catalog', 'inspect_set', { ref: street.ref });
  const C = await T('catalog', 'inspect_set', { ref: cafe.ref });
  const r = await T('assembly', 'apply_plan', { label: 'Café à l’angle du carrefour', steps: [
    { op: 'place_set', input: { ref: cross.ref, position: [0, 0, 0], yaw: 0 } },
    { op: 'place_set', input: { ref: street.ref } },
    { op: 'connect_sets', input: { a: { placement: '$0', connector: X.connectors.find((c) => c.normal[0] < -0.9).id }, b: { placement: '$1', connector: S.connectors.find((c) => c.kind === 'road' && c.normal[0] > 0.9).id } } },
    // the café closes the east arm, door onto the crossroads (door normal −z, yaw 90 → faces −x)
    { op: 'place_set', input: { ref: cafe.ref, position: [13.0, 0, 0], yaw: 90, name: 'Café du carrefour' } },
    { op: 'add_entities', input: { resource: 'fixture.test-city/cesiumman', count: 3, placement: '$3', at: C.connectors.find((c) => c.kind === 'door').id, behavior: 'customer', name: 'Client' } },
    { op: 'add_entities', input: { resource: 'fixture.test-city/cesiumman', count: 2, placement: '$1', behavior: 'wander', name: 'Passant' } },
    { op: 'add_entities', input: { resource: 'fixture.test-city/fx_car', count: 1, placement: '$1', behavior: 'drive', name: 'Voiture' } },
  ] });
  log('apply_plan', JSON.stringify(r).slice(0, 900));
  if (!r.ok) throw new Error('plan refused');
  log('undo/redo', await run(() => { const s = window.studio.store; const n0 = s.doc.entities.length; s.undo(); const n1 = s.doc.entities.length; s.redo(); return [n0, n1, s.doc.entities.length]; }));
  await run(() => window.studio.assembly.rebuildGeometry());
  log('verify', JSON.stringify(await T('assembly', 'verify', {})));
  await T('population', 'set_actor', { resource: 'fixture.test-city/cesiumman' }).catch((e) => log('set_actor (reload)', String(e).slice(0, 80)));
  await wait(4000);
  log('after reload', await waitReady());
  await run(() => window.studio.assembly.waitForSets());
  await wait(1500);
  const st = await T('assembly', 'state', {});
  log('state', JSON.stringify({ placements: st.placements, junctions: st.junctions.length, population: st.population.length, issues: st.issues }));
  log('actor', await run(() => ({ actor: !!window.studio.actor, pos: window.studio.actor?.position.toArray().map((v) => +v.toFixed(2)), nav: !!window.studio.nav, url: location.search })));
  log('verify after reopen', JSON.stringify(await T('assembly', 'verify', {})));
  await capture('a01-follow');
  // camera: manual orbit while following, kept while the actor walks, then explicit recentre
  log('orbit', await run(() => { const c = window.studio.cameras; c.orbitFollow(1.4, 0.15); return { manualYaw: +c.manualYaw.toFixed(2) }; }));
  await run(() => { void window.studio.ops.moveActorTo([-12, 0, -2]); });
  await step(3);
  log('after walk', await run(() => { const c = window.studio.cameras; return { manualYaw: +c.manualYaw.toFixed(2), followYaw: +c.followYaw.toFixed(2), actor: window.studio.actor.position.toArray().map((v) => +v.toFixed(1)) }; }));
  await capture('a01b-orbit-kept');
  await run(() => window.studio.cameras.recenter());
  await step(1.5);
  log('recentred', await run(() => window.studio.cameras.manualYaw));
  await capture('a01c-recentred');
  // population on the shared clock
  for (let i = 0; i < 6; i++) { await step(5); log('sim', JSON.stringify(await T('population', 'sim_state', {}))); }
  log('save', await run(() => window.studio.save()));
  await run(() => { const s = window.studio; s.setCameraMode('director'); s.ops.setCamera({ position: [-38, 34, 30], target: [2, 0, 0], focalLength: 24 }); });
  await capture('a02-overview');
  await run(() => { const s = window.studio; s.ops.setCamera({ position: [-2, 1.7, 3], target: [10, 1.4, 0], focalLength: 28 }); });
  await capture('a03-cafe-door');
  await run(() => window.studio.set({ placePanel: true }));
  await wait(500);
  await shot('a04-panel');
};

