// Interior light on/off (windows open onto the street), then the creator end to end on a generated street.
export default async ({ page, run, step, capture, log }) => {
  const S = (f, a) => run(f, a);
  await S(() => { const s = window.studio; s.engine.setQuality('balanced'); s.interactions.applyState('door.cafe', 'open'); s.setMode('direct'); s.ops.setCamera({ mode: 'director', position: [-6.5, 1.65, -8.3], target: [-7.5, 1.0, -16.5], focalLength: 24 }); });
  await step(0.2); await capture('s1-interior-on');
  await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', false));
  await step(0.1); await capture('s2-interior-off');
  await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', true));
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [-9, 1.6, -15.5], target: [-4.5, 1.5, -7.6], focalLength: 24 }));
  await step(0.1); await capture('s3-front-windows');
  // creator: brief → reading → parameters → composed world
  const summary = await S(() => {
    const r = window.studio.tools.callTool('world', 'plan_district', { brief: 'Une rue étroite de Surulere avec un grand cybercafé de 10 postes côté nord au bout de la rue, immeubles bas, en fin d’après-midi' });
    window.__plan = r;
    return { reading: r.reading, params: r.params, blockers: r.blockers, missing: r.missing, buildings: r.plan.buildings.length, name: r.name };
  });
  log('plan', JSON.stringify(summary));
  await S(async () => { await window.studio.createDistrictWorld(window.__plan); }).catch((e) => log('create (navigation)', String(e).slice(0, 120)));
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(5000);
    const st = await run(() => window.studio?.ui.phase + ' ' + (window.studio?.store.doc.name ?? '')).catch(() => 'loading');
    if (/^ready .*Surulere/.test(st)) { log('opened', st); break; }
    if (i % 12 === 0) log('waiting', st);
  }
  log('new world', await S(() => { const d = window.studio.store.doc; return { id: d.id, ws: d.entities.filter((e) => /^ws\.\d+\.desk$/.test(e.id)).length, street: d.district.street, cafe: d.district.buildings.find((b) => b.id === 'b.cafe').front, sun: d.environment.sun, spawn: d.spawn }; }));
  await S(() => window.studio.engine.setQuality('balanced'));
  await step(1); await capture('s4-generated-follow');
  await S(() => { const s = window.studio, b = s.store.doc.district.buildings.find((x) => x.id === 'b.cafe'); s.setMode('direct'); s.ops.setCamera({ mode: 'director', position: [b.front[0] - 14, 2.2, -1], target: [b.front[0], 2.5, b.front[2]], focalLength: 24 }); });
  for (let i = 0; i < 4; i++) await step(1);
  await capture('s5-generated-street');
};
