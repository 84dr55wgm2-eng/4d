export default async ({ run, step, capture, log }) => {
  for (const q of ['high', 'balanced']) {
    await run((q) => window.studio.engine.setQuality(q), q);
    await step(0.2);
    await run(() => window.studio.engine.renderOnce());
    log(q, await run(() => { const i = window.studio.engine.renderer.info; return { calls: i.render.calls, tris: i.render.triangles }; }));
  }
  // shadow-only cost
  await run(() => { const e = window.studio.engine; e.renderer.shadowMap.enabled = false; e.renderOnce(); });
  log('balanced, no shadows', await run(() => { const i = window.studio.engine.renderer.info; return { calls: i.render.calls, tris: i.render.triangles }; }));
  await run(() => { const e = window.studio.engine; e.renderer.shadowMap.enabled = true; e.setQuality('high'); });
  await step(0.1);
  await capture('perf-high');
};
